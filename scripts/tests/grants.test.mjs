/**
 * Which tables the API roles may write to directly.
 *
 * This is the test the flags bypass needed and did not have. A rate limit
 * inside a security-definer function protects nothing if the table also takes
 * writes from the outside, and the two look identical from the client: both
 * are "the insert worked". The difference only shows in a role the app
 * actually runs as.
 *
 * So the rule, stated once: **a table with a submit_* function in front of it
 * has no write grant.** The function is the door and its limits are not
 * optional. The exceptions are listed here rather than left to be discovered,
 * because an exception nobody wrote down is how the last one survived.
 *
 * asRole, not become. become sets the JWT claims and leaves the connection as
 * the owner, which grants and RLS do not apply to — every assertion here would
 * pass against a wide-open schema if written that way.
 */
import { suite, eq, ok } from '../lib/testkit.mjs'

/**
 * Tables the API roles may not write to.
 *
 * Six because a submit_* function owns them and a direct write would skip its
 * limits. profiles for a different reason: it has no function in front of it,
 * so there is no path to a display name at all — derived at signup and fixed
 * after, until somebody adds set_display_name() and grants execute on that
 * rather than putting the table grant back.
 */
/*
 * flags, feedback and profiles are no longer this app's tables. They moved to
 * the shared `public` layer when this database started hosting several apps,
 * and the platform migrations own their grants and their tests. What is left
 * here is what this app actually owns.
 */
const CLOSED = [
  'bathrooms', 'bathroom_codes', 'reports', 'access_claims',
]

/**
 * And the one that is deliberately open, with the reason.
 *
 * comments is the only table the client writes to directly — see
 * lib/submissions.ts — so its policy is the access control rather than a
 * decoration, and it is the only write grant left anywhere in public.
 */
const OPEN = [
  ['comments', 'INSERT', 'the client inserts notes directly'],
  ['comments', 'DELETE', 'and deletes its own'],
]

/**
 * Everything an API role is allowed to hold in this schema, as an allowlist.
 *
 * Stated this way round on purpose. The checks below used to name the three
 * privileges worth worrying about — INSERT, UPDATE, DELETE — and ask whether
 * any had appeared, which is only as good as that list of three. Migration 028
 * re-granted the schema from a generated list and handed anon TRUNCATE,
 * REFERENCES, TRIGGER and MAINTAIN on every table in it, including the four
 * above. The suite was green: none of the four was one of the three.
 *
 * So: nothing but SELECT, plus the exceptions in OPEN. A privilege nobody has
 * thought of yet fails this by default, which is the only version of this test
 * that could have caught the thing that got past it.
 */
const ALLOWED = new Set(['SELECT'])

/**
 * Roles the app can actually arrive as, plus service_role.
 *
 * service_role is in the list because nothing in this project runs as it —
 * docs/security.md says so — and a role nobody uses quietly accumulating
 * privileges is exactly how that sentence stops being true.
 */
const API_ROLES = ['anon', 'authenticated', 'service_role']

/**
 * The real ACL, not information_schema's view of it.
 *
 * information_schema.role_table_grants does not report MAINTAIN at all, so a
 * check built on it is blind to one of the four privileges 028 handed out —
 * which is worth knowing before writing the next permission test on top of it.
 * aclexplode reads what Postgres actually stored.
 */
const acl = (t, table) =>
  t.sql(`select r.rolname as grantee, a.privilege_type
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         cross join lateral aclexplode(c.relacl) a
         join pg_roles r on r.oid = a.grantee
         where n.nspname = 'restroom' and c.relname = $1
           and r.rolname = any($2)
         order by r.rolname, a.privilege_type`, [table, API_ROLES])

const grants = (t, table) =>
  t.sql(`select grantee, privilege_type from information_schema.role_table_grants
         where table_schema = 'restroom' and table_name = $1
           and grantee in ('anon','authenticated')
           and privilege_type in ('INSERT','UPDATE','DELETE')
         order by grantee, privilege_type`, [table])

suite('write grants', (test) => {
  test('nothing with a submit function takes writes from outside it', async (t) => {
    for (const table of CLOSED) {
      const rows = await grants(t, table)
      eq(rows.length, 0,
        `${table} should have no write grant, found ${rows.map((r) => `${r.grantee}:${r.privilege_type}`).join(', ')}`)
    }
  })

  test('the API roles hold nothing but SELECT, plus the listed exceptions', async (t) => {
    // Every relation in the schema, not just the closed four: a view carrying
    // TRUNCATE is harmless and a table carrying it is not, and the way to stop
    // having to tell them apart is to allow neither.
    const relations = await t.sql(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'restroom' and c.relkind in ('r','v','m','p')
        order by c.relname`)

    ok(relations.length > 0, 'found no relations in restroom — the query is wrong, not the schema')

    const allowed = new Set(OPEN.map(([tbl, priv]) => `${tbl}/authenticated/${priv}`))
    const extra = []

    for (const { relname } of relations) {
      for (const row of await acl(t, relname)) {
        const held = `${relname}/${row.grantee}/${row.privilege_type}`
        if (ALLOWED.has(row.privilege_type) || allowed.has(held)) continue
        extra.push(held)
      }
    }

    eq(extra.join('\n      '), '',
      `these roles hold a privilege nothing asked them to have.\n` +
      `      Add it to OPEN with a reason, or revoke it`)
  })

  test('service_role holds nothing in this schema at all', async (t) => {
    // Separate from the check above because the reason is different: this is
    // not "no writes", it is "no reason to be here". Nothing in this project
    // connects as service_role, and the moderation path runs as the owner.
    const rows = await t.sql(
      `select c.relname, a.privilege_type
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       cross join lateral aclexplode(c.relacl) a
       join pg_roles r on r.oid = a.grantee
       where n.nspname = 'restroom' and r.rolname = 'service_role'
       order by 1, 2`)

    eq(rows.map((r) => `${r.relname}:${r.privilege_type}`).join(' '), '',
      'service_role picked up a grant in restroom')
  })

  test('the deliberate exceptions are still the only ones', async (t) => {
    const found = []
    const rows = await t.sql(
      `select table_name, grantee, privilege_type
       from information_schema.role_table_grants
       where table_schema = 'restroom' and grantee in ('anon','authenticated')
         and privilege_type in ('INSERT','UPDATE','DELETE')
       order by table_name, privilege_type`)
    for (const r of rows) found.push(`${r.table_name}:${r.privilege_type}`)

    const expected = [...new Set(OPEN.map(([tbl, priv]) => `${tbl}:${priv}`))].sort()
    eq([...new Set(found)].sort().join(' '), expected.join(' '),
      'a new write grant appeared, or an expected one went away')
  })

  test('the closed tables refuse a direct insert in both roles', async (t) => {
    const place = await t.place({ owner: await t.newUser() })

    // One representative write per table.
    //
    // The message matters as much as the code here. A missing grant and a
    // policy that says no are BOTH 42501, so asserting only the code would
    // pass against the old schema: these inserts leave user_id and created_by
    // null, which the policies that used to exist would have refused anyway.
    // "permission denied for table" is the grant; RLS says "violates
    // row-level security policy" instead.
    const writes = {
      bathrooms: [`insert into bathrooms (geog, name, venue_type, access_kind)
                   values (st_setsrid(st_makepoint(0,0),4326)::geography,
                           'direct', 'cafe', 'open')`, []],
      bathroom_codes: [`insert into bathroom_codes (bathroom_id, code) values ($1, '1234')`, [place.id]],
      reports: [`insert into reports (bathroom_id, kind, geo_verified) values ($1, 'works', false)`, [place.id]],
    }

    for (const [table, [sql, args]] of Object.entries(writes)) {
      for (const role of ['anon', 'authenticated']) {
        const err = await t.raises(
          () => t.asRole(role, () => t.sql(sql, args)),
          '42501', `${role} writing to ${table} directly`)
        ok(err.message.includes('permission denied for table'),
          `${role}/${table} refused for want of a grant, not by a policy — got: ${err.message}`)
      }
    }
  })

  test('the functions themselves still work', async (t) => {
    // The other half of the check: closing the door must not have taken the
    // key with it. Every one of these is security definer.
    const owner = await t.newUser()
    const place = await t.place({ owner })

    await t.become(await t.anonVisitor())
    ok((await t.val('select submit_flag($1,$2,$3,$4,$5)',
      ['restroom-map', 'bathroom', place.id, 'still works', null])).ok, 'submit_flag')
    ok((await t.val('select submit_feedback($1,$2,$3,$4,$5)',
      ['restroom-map', 'bug', 'still works', null, 'v1'])).ok, 'submit_feedback')

    // And a place created through submit_bathroom, which t.place already does
    // for every fixture in this suite.
    ok(place.id, 'submit_bathroom')
  })
})
