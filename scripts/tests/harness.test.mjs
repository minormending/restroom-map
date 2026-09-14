/**
 * The harness testing itself.
 *
 * These run first (alphabetically) because every other suite assumes them: if
 * impersonation silently does nothing, a gating test proves nothing, and it
 * passes while proving nothing.
 */
import { suite, eq, ok } from '../lib/testkit.mjs'

suite('harness', (test) => {
  test('signing up creates a profile through the real trigger', async (t) => {
    const user = await t.newUser({ name: 'Ada Lovelace' })
    const profile = await t.one('select id, display_name from profiles where id = $1', [user.id])
    ok(profile, 'a profile row should exist')
    eq(profile.display_name, 'Ada Lovelace', 'display name comes from the signup metadata')
  })

  test('as() actually changes who auth.uid() reports', async (t) => {
    const alice = await t.newUser()
    const bob = await t.newUser()

    eq(await t.val('select auth.uid()'), null, 'nobody is signed in by default')

    await t.as(alice, async () => {
      eq(await t.val('select auth.uid()'), alice.id, 'inside as(alice)')

      await t.as(bob, async () => {
        eq(await t.val('select auth.uid()'), bob.id, 'nesting switches user')
      })

      eq(await t.val('select auth.uid()'), alice.id, 'and switches back on the way out')
    })

    eq(await t.val('select auth.uid()'), null, 'back to signed out')
  })

  test('each caller gets their own rate-limit fingerprint', async (t) => {
    const alice = await t.newUser()
    const bob = await t.newUser()

    const a = await t.as(alice, () => t.val('select client_fingerprint()'))
    const b = await t.as(bob, () => t.val('select client_fingerprint()'))
    const again = await t.as(alice, () => t.val('select client_fingerprint()'))

    ok(a !== b, 'two callers must not share a bucket')
    eq(again, a, 'the same caller keeps their fingerprint')
  })

  test('an expected failure does not poison the rest of the test', async (t) => {
    const owner = await t.newUser()
    const place = await t.place({ owner })

    await t.raises(() => t.report(owner, place, 'works'), '42501',
      'reporting your own place is refused')

    // The point of the savepoint. Without one, every statement from here on
    // comes back 25P02 and the test fails for a reason that has nothing to
    // do with what it was checking.
    eq(await t.balance(owner), 5, 'the session still works afterwards')
    ok(await t.one('select 1 as n'), 'and still answers queries')
  })

  test('writes leave nothing behind', async (t) => {
    // Everything this test creates carries the marker the canary hunts for.
    // The assertion is not in here — it is the canary that runs after the
    // rollback. If any of this survives, the whole run stops.
    const owner = await t.newUser()
    const place = await t.place({ owner, code: '1234' })
    await t.place({ code: '5678' })
    await t.report(await t.newUser(), place, 'works', { geo: true })

    eq(await t.val('select count(*) from bathrooms where name like $1',
      [`TEST/harness.invalid/%`]), 2, 'the rows exist while the test is running')
  })
})
