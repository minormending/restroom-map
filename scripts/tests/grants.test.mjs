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

/** Everything the function owns. A direct write to any of these is a bypass. */
const CLOSED = ['bathrooms', 'bathroom_codes', 'reports', 'flags', 'feedback', 'access_claims']

/**
 * And the ones that are deliberately open, with the reason.
 *
 * comments is the only table the client writes to directly, so its policy is
 * doing the work. profiles has no function behind it at all — revoking would
 * leave a display name with no way to be edited, so it is a decision somebody
 * should make rather than a door to shut quietly.
 */
const OPEN = [
  ['comments', 'INSERT', 'the client inserts notes directly'],
  ['comments', 'DELETE', 'and deletes its own'],
  ['profiles', 'UPDATE', 'no function behind it; display names would have no path'],
]

const grants = (t, table) =>
  t.sql(`select grantee, privilege_type from information_schema.role_table_grants
         where table_schema = 'public' and table_name = $1
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

  test('the deliberate exceptions are still the only ones', async (t) => {
    const found = []
    const rows = await t.sql(
      `select table_name, grantee, privilege_type
       from information_schema.role_table_grants
       where table_schema = 'public' and grantee in ('anon','authenticated')
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
      flags: [`insert into flags (target_type, target_id, reason)
               values ('bathroom', $1, 'direct')`, [place.id]],
      feedback: [`insert into feedback (kind, message) values ('bug', 'direct')`, []],
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
    ok((await t.val('select submit_flag($1,$2,$3,$4)',
      ['bathroom', place.id, 'still works', null])).ok, 'submit_flag')
    ok((await t.val('select submit_feedback($1,$2,$3,$4)',
      ['bug', 'still works', null, 'v1'])).ok, 'submit_feedback')

    // And a place created through submit_bathroom, which t.place already does
    // for every fixture in this suite.
    ok(place.id, 'submit_bathroom')
  })
})
