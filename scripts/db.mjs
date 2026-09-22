#!/usr/bin/env node
/**
 * Run SQL against the project database.
 *
 *   node scripts/db.mjs status              list applied and pending migrations
 *   node scripts/db.mjs migrate             apply pending migrations
 *   node scripts/db.mjs migrate --baseline  record existing files as applied
 *                                           without running them
 *   node scripts/db.mjs file <path.sql>     run one SQL file
 *   node scripts/db.mjs query "<sql>"       run ad-hoc SQL
 *   node scripts/db.mjs query -             read SQL from stdin
 *
 *   node scripts/db.mjs queue               open moderation flags
 *   node scripts/db.mjs triage              the same queue as JSON, for a
 *                                           process rather than a person
 *   node scripts/db.mjs hide <id> "<why>"   take a place off the map now
 *   node scripts/db.mjs unhide <id>         put it back
 *   node scripts/db.mjs resolve <queue-id>  mark a flag or feedback dealt with
 *
 * Needs SUPABASE_DB_PASSWORD in .env — just the password. Host, port and user
 * are derived from VITE_SUPABASE_URL. Set SUPABASE_DB_URL instead if you'd
 * rather supply a full connection string. .env is gitignored either way.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, basename } from 'node:path'
import { ROOT, withClient } from './lib/connect.mjs'
import { hide, openQueue, resolve, triageItems, unhide } from './lib/moderation.mjs'

const MIGRATIONS = join(ROOT, 'supabase', 'migrations')

// --- output ----------------------------------------------------------------

function printResult(res) {
  const results = Array.isArray(res) ? res : [res]
  for (const r of results) {
    if (!r) continue
    if (!r.rows || r.rows.length === 0) {
      console.log(`${r.command ?? 'OK'}${r.rowCount != null ? ` ${r.rowCount}` : ''}`)
      continue
    }
    const cols = r.fields.map((f) => f.name)
    const cell = (v) =>
      v === null ? 'NULL' : v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v)
    const widths = cols.map((c, i) =>
      Math.max(c.length, ...r.rows.map((row) => cell(row[cols[i]]).length)))
    const line = (chars) => chars.map((c, i) => c.padEnd(widths[i])).join('  ')
    console.log(line(cols))
    console.log(widths.map((w) => '-'.repeat(w)).join('  '))
    for (const row of r.rows) console.log(line(cols.map((c) => cell(row[c]))))
    console.log(`(${r.rows.length} row${r.rows.length === 1 ? '' : 's'})`)
  }
}

// --- migrations ------------------------------------------------------------

const TRACKING = `
create table if not exists schema_migrations (
  version    text primary key,
  checksum   text not null,
  applied_at timestamptz not null default now()
);`

const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16)

function migrationFiles() {
  if (!existsSync(MIGRATIONS)) return []
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => {
      const sql = readFileSync(join(MIGRATIONS, f), 'utf8')
      return { version: basename(f, '.sql'), file: f, sql, checksum: sha(sql) }
    })
}

async function appliedMap(client) {
  await client.query(TRACKING)
  const { rows } = await client.query('select version, checksum from schema_migrations')
  return new Map(rows.map((r) => [r.version, r.checksum]))
}

async function status(client) {
  const applied = await appliedMap(client)
  const files = migrationFiles()
  if (files.length === 0) return console.log('no migration files found')
  for (const m of files) {
    const known = applied.get(m.version)
    const state = known === undefined ? 'PENDING'
      : known === m.checksum ? 'applied'
      : 'applied (FILE CHANGED SINCE)'
    console.log(`  ${state.padEnd(28)} ${m.file}`)
  }
  const pending = files.filter((m) => !applied.has(m.version)).length
  console.log(`\n${files.length} migration${files.length === 1 ? '' : 's'}, ${pending} pending`)
}

async function migrate(client, { baseline }) {
  const applied = await appliedMap(client)
  const pending = migrationFiles().filter((m) => !applied.has(m.version))

  if (pending.length === 0) return console.log('nothing to apply')

  if (baseline) {
    for (const m of pending) {
      await client.query(
        'insert into schema_migrations (version, checksum) values ($1, $2) on conflict do nothing',
        [m.version, m.checksum])
      console.log(`  recorded (not run)  ${m.file}`)
    }
    console.log(`\nbaselined ${pending.length} migration${pending.length === 1 ? '' : 's'}`)
    return
  }

  for (const m of pending) {
    process.stdout.write(`  applying ${m.file} ... `)
    // Each migration is one transaction: it lands whole or not at all.
    await client.query('begin')
    try {
      await client.query(m.sql)
      await client.query(
        'insert into schema_migrations (version, checksum) values ($1, $2)',
        [m.version, m.checksum])
      await client.query('commit')
      console.log('ok')
    } catch (err) {
      await client.query('rollback')
      console.log('FAILED')
      console.error(`\n${err.message}`)
      if (err.position) console.error(`  at character ${err.position}`)
      if (err.hint) console.error(`  hint: ${err.hint}`)
      process.exit(1)
    }
  }
  console.log(`\napplied ${pending.length} migration${pending.length === 1 ? '' : 's'}`)
}

// --- moderation ------------------------------------------------------------
//
// The bodies live in lib/moderation.mjs so the test harness can call them
// inside its transaction. What is left here is the part a person sees: the
// wording, and which failures are worth a non-zero exit.

async function queue(client) {
  const rows = await openQueue(client)
  if (rows.length === 0) return console.log('queue is empty')

  for (const r of rows) {
    const age = Math.round((Date.now() - new Date(r.created_at)) / 3600000)
    console.log(`${r.awaiting_reply ? '! ' : '  '}${r.id}`)
    console.log(`    ${r.subject}${r.bathroom_status ? ` [${r.bathroom_status}]` : ''}  ${age}h ago`)
    console.log(`    ${r.reason}`)
    if (r.contact_email) console.log(`    reply to: ${r.contact_email}`)
  }
  const waiting = rows.filter((r) => r.awaiting_reply).length
  console.log(`\n${rows.length} open${waiting ? `, ${waiting} awaiting a reply (!)` : ''}`)
}

async function triage(client) {
  console.log(JSON.stringify(await triageItems(client), null, 2))
}

async function hideCommand(client, id, why) {
  const { name } = await hide(client, id, why)
  console.log(`hidden: ${name}\n  reason: ${why}\n  reversible with: db.mjs unhide ${id}`)
}

async function unhideCommand(client, id) {
  console.log(`back on the map: ${(await unhide(client, id)).name}`)
}

async function resolveCommand(client, id) {
  console.log(`resolved: ${(await resolve(client, id)).what}`)
}

// --- entry -----------------------------------------------------------------

const [cmd, ...rest] = process.argv.slice(2)

const commands = {
  status: (c) => status(c),
  migrate: (c) => migrate(c, { baseline: rest.includes('--baseline') }),
  file: async (c) => {
    const path = rest[0]
    if (!path) throw new Error('usage: db.mjs file <path.sql>')
    printResult(await c.query(readFileSync(path, 'utf8')))
  },
  query: async (c) => {
    const sql = rest[0] === '-' ? readFileSync(0, 'utf8') : rest.join(' ')
    if (!sql?.trim()) throw new Error('usage: db.mjs query "<sql>"')
    printResult(await c.query(sql))
  },
  queue: (c) => queue(c),
  triage: (c) => triage(c),
  hide: (c) => {
    const [id, ...why] = rest
    if (!id || why.length === 0) {
      throw new Error('usage: db.mjs hide <bathroom-id> "<reason>"')
    }
    return hideCommand(c, id, why.join(' '))
  },
  unhide: (c) => {
    if (!rest[0]) throw new Error('usage: db.mjs unhide <bathroom-id>')
    return unhideCommand(c, rest[0])
  },
  resolve: (c) => {
    if (!rest[0]) throw new Error('usage: db.mjs resolve <flag-id>')
    return resolveCommand(c, rest[0])
  },
}

if (!cmd || !(cmd in commands)) {
  console.error(`usage: db.mjs <status|migrate|file|query> [...]

  status                  list applied and pending migrations
  migrate                 apply pending migrations
  migrate --baseline      record pending files as applied WITHOUT running them
  file <path.sql>         run one SQL file
  query "<sql>"           run ad-hoc SQL ("-" reads stdin)

  queue                   open moderation flags, takedowns first
  hide <id> "<reason>"    take a place off the map immediately
  unhide <id>             put it back
  resolve <flag-id>       mark a flag dealt with`)
  process.exit(1)
}

withClient(commands[cmd], { applicationName: 'restroom-map/scripts/db.mjs' }).catch((err) => {
  console.error(err.message)
  if (err.hint) console.error(`hint: ${err.hint}`)
  process.exit(1)
})
