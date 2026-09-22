/**
 * Does every call the browser makes name something the browser can reach?
 *
 * This is the gap the rest of the suite structurally cannot cover. Every other
 * test here talks to Postgres over a connection whose `search_path` is
 * `restroom, public, extensions`, so `select submit_feedback(...)` finds the
 * shared function and passes. The browser has no search path. It has a
 * **schema**, set once on the client, and PostgREST resolves strictly inside
 * the one a request names — no fallback.
 *
 * So the database can be entirely correct and the app still unable to call it.
 * That is not hypothetical: the move onto the shared database left three call
 * sites pointing at `restroom` for things that live in `public`, and the two
 * forms and the notes list were broken in production for a day with 92 tests
 * green over the top of them.
 *
 * This reads the source rather than the database's opinion of it: which client
 * each call site uses, what it asks for, and whether that object exists in the
 * schema that client is pinned to. It is a lint with a database attached.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from '../lib/connect.mjs'
import { suite, eq, ok } from '../lib/testkit.mjs'

const LIB = join(ROOT, 'src', 'lib')

const sources = readdirSync(LIB)
  .filter((f) => f.endsWith('.ts'))
  .map((f) => ({ file: `src/lib/${f}`, text: readFileSync(join(LIB, f), 'utf8') }))

/**
 * Which schema each exported client handle is pinned to, read out of
 * supabase.ts rather than repeated here.
 *
 * Repeating them would mean this test keeps passing after somebody changes the
 * client and forgets the call sites, which is the exact failure it exists to
 * catch.
 */
function handles() {
  const text = readFileSync(join(LIB, 'supabase.ts'), 'utf8')
  const dflt = /db:\s*\{\s*schema:\s*'([^']+)'/.exec(text)
  const shared = /export const shared = supabase\?\.schema\('([^']+)'\)/.exec(text)

  ok(dflt, 'supabase.ts still sets db.schema on the default client')
  ok(shared, 'supabase.ts still exports `shared` as a .schema() view')
  return { supabase: dflt[1], shared: shared[1] }
}

/** Every `<handle>.rpc('name'` and `<handle>.from('name'` in src/lib. */
function callSites(names) {
  const pattern = new RegExp(`\\b(${names.join('|')})\\s*\\.\\s*(rpc|from)\\(\\s*'([^']+)'`, 'g')
  const found = []
  for (const { file, text } of sources) {
    for (const m of text.matchAll(pattern)) {
      found.push({ file, handle: m[1], kind: m[2] === 'rpc' ? 'function' : 'relation', name: m[3] })
    }
  }
  return found
}

/**
 * Embedded resources: the `profiles(display_name)` inside a select string.
 *
 * PostgREST will not embed across schemas — it answers PGRST200 "no
 * relationship found" however real the foreign key is — so an embed naming
 * something outside its own base table's schema is broken the same way a
 * mis-routed rpc is, and looks just as correct in a diff.
 */
function embeds(names) {
  const pattern = new RegExp(
    `\\b(${names.join('|')})\\s*\\.\\s*from\\(\\s*'([^']+)'\\s*\\)\\s*\\.\\s*select\\(\\s*'([^']*)'`, 'g')
  const found = []
  for (const { file, text } of sources) {
    for (const m of text.matchAll(pattern)) {
      for (const e of m[3].matchAll(/(\w+)\s*\(/g)) {
        found.push({ file, handle: m[1], base: m[2], embedded: e[1] })
      }
    }
  }
  return found
}

/** Everything callable or selectable, by schema. */
async function catalogue(t, schemas) {
  const rows = await t.sql(
    `select n.nspname as schema, p.proname as name, 'function' as kind
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = any($1)
      union all
     select schemaname, tablename, 'relation' from pg_tables where schemaname = any($1)
      union all
     select schemaname, viewname, 'relation' from pg_views where schemaname = any($1)`,
    [schemas])

  const by = new Map()
  for (const r of rows) by.set(`${r.schema}.${r.kind}.${r.name}`, true)
  return by
}

suite('client routing', (test) => {
  test('every rpc names a function in the schema its client talks to', async (t) => {
    const schemas = handles()
    const have = await catalogue(t, [...new Set(Object.values(schemas))])
    const calls = callSites(Object.keys(schemas)).filter((c) => c.kind === 'function')

    ok(calls.length > 0, 'found no rpc call sites at all — the scan is broken, not the app')

    for (const c of calls) {
      const schema = schemas[c.handle]
      ok(have.has(`${schema}.function.${c.name}`),
        `${c.file}: ${c.handle}.rpc('${c.name}') resolves to ${schema}.${c.name}, which does not exist` +
        (have.has(`${otherSchema(schemas, c.handle)}.function.${c.name}`)
          ? ` — it is in ${otherSchema(schemas, c.handle)}, so this wants the other client`
          : ''))
    }
  })

  test('every table and view read from is in that schema too', async (t) => {
    const schemas = handles()
    const have = await catalogue(t, [...new Set(Object.values(schemas))])
    const calls = callSites(Object.keys(schemas)).filter((c) => c.kind === 'relation')

    ok(calls.length > 0, 'found no from() call sites at all — the scan is broken')

    for (const c of calls) {
      const schema = schemas[c.handle]
      ok(have.has(`${schema}.relation.${c.name}`),
        `${c.file}: ${c.handle}.from('${c.name}') resolves to ${schema}.${c.name}, which does not exist` +
        (have.has(`${otherSchema(schemas, c.handle)}.relation.${c.name}`)
          ? ` — it is in ${otherSchema(schemas, c.handle)}, so this wants the other client`
          : ''))
    }
  })

  test('nothing embeds a relation from another schema', async (t) => {
    const schemas = handles()
    const have = await catalogue(t, [...new Set(Object.values(schemas))])

    for (const e of embeds(Object.keys(schemas))) {
      const schema = schemas[e.handle]
      // Only complain when the embedded name is a real relation somewhere
      // else: a select can also carry casts and json paths that look like this.
      const elsewhere = otherSchema(schemas, e.handle)
      const isForeign = have.has(`${elsewhere}.relation.${e.embedded}`) &&
                        !have.has(`${schema}.relation.${e.embedded}`)
      eq(isForeign, false,
        `${e.file}: selecting '${e.embedded}(...)' from ${schema}.${e.base}, but ` +
        `${e.embedded} is in ${elsewhere} — PostgREST does not embed across schemas`)
    }
  })

  test('the shared functions really are only in the shared layer', async (t) => {
    // The premise of `shared` existing. If these ever gain a copy in this
    // app's schema, the indirection above is dead weight and should go.
    const schemas = handles()
    for (const fn of ['submit_flag', 'submit_feedback']) {
      const rows = await t.sql(
        `select n.nspname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where p.proname = $1 and n.nspname = any($2)`,
        [fn, [...new Set(Object.values(schemas))]])
      eq(rows.map((r) => r.nspname).sort().join(','), schemas.shared,
        `${fn} should exist in ${schemas.shared} and nowhere else this app addresses`)
    }
  })
})

function otherSchema(schemas, handle) {
  const mine = schemas[handle]
  return Object.values(schemas).find((s) => s !== mine) ?? mine
}
