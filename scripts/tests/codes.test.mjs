/**
 * The code gate.
 *
 * can_view_code() has been the single gate since the first migration, which is
 * what let M4 put a price on codes without touching data, policies or the
 * client — and what let 013 take it back off again the same way. Right now it
 * is off: codes are open to everyone.
 *
 * So these tests do both. A few pin the open behaviour that is actually live.
 * The rest pull the lever inside their own transaction — installing the M4
 * body of can_view_code() — and check that the paid path still works, because
 * the whole argument for that design is that the lever can be pulled again.
 *
 * Replacing the function takes a lock on it for the length of one test. That
 * is milliseconds, and the canary in scripts/test.mjs checks every function
 * body in `public` against its pre-run hash after every rollback.
 */
import { suite, eq, ok } from '../lib/testkit.mjs'

const getCode = (t, place) => t.one(
  'select code, locked, cost, confirms from get_code($1)', [place.id])

const unlock = (t, place) => t.val('select unlock_code($1)', [place.id])

suite('codes', (test) => {
  // --- as it stands today --------------------------------------------------

  test('codes are open to everyone right now', async (t) => {
    const owner = await t.newUser()
    const place = await t.place({ owner, code: '4242' })

    const anon = await t.as(t.anonVisitor(), () => getCode(t, place))
    eq(anon.code, '4242', 'a passer-by can read the code')
    eq(anon.locked, false, 'and nothing says otherwise')

    const stranger = await t.as(await t.newUser(), () => getCode(t, place))
    eq(stranger.code, '4242', 'so can a signed-in stranger')
  })

  test('a place with no code recorded returns no row at all', async (t) => {
    const owner = await t.newUser()
    const place = await t.place({ owner, access: 'open' })

    eq(await getCode(t, place), null, 'there is nothing to lock or reveal')
  })

  test('get_code reports the live code and how often it has been confirmed', async (t) => {
    const owner = await t.newUser()
    const place = await t.place({ owner, code: '1111' })

    await t.as(await t.newUser(), () => t.val('select submit_code($1,$2)', [place.id, '2222']))
    await t.report(await t.newUser(), place, 'works', { geo: true })

    const row = await getCode(t, place)
    eq(row.code, '2222', 'the rotated code, not the retired one')
    eq(row.confirms, 1, 'counted against the code that is live')
  })

  // --- with the gate back on -----------------------------------------------

  test('gated: a stranger sees a price, not a code', async (t) => {
    await t.enableGating()
    const owner = await t.newUser()
    const place = await t.place({ owner, code: '4242' })

    const anon = await t.as(t.anonVisitor(), () => getCode(t, place))
    eq(anon.code, null, 'no code for someone not signed in')
    eq(anon.locked, true, 'and it says so')
    eq(anon.cost, 2, 'with the price, so the UI can offer the trade')

    const stranger = await t.as(await t.newUser(), () => getCode(t, place))
    eq(stranger.code, null, 'signing in alone buys nothing')
    eq(stranger.locked, true, 'still locked')
  })

  test('gated: unlocking costs two credits and hands over the code', async (t) => {
    await t.enableGating()
    const owner = await t.newUser()
    const buyer = await t.newUser()
    const place = await t.place({ owner, code: '4242' })

    const result = await t.as(buyer, () => unlock(t, place))

    ok(result.ok, 'the unlock succeeds')
    eq(result.charged, 2, 'charged the advertised price')
    eq(result.code, '4242', 'and the code comes back with it')
    eq(result.balance, 3, '5 signup - 2 spent')
    eq(await t.balance(buyer), 3, 'which the ledger agrees with')
    eq(await t.entries(buyer, 'spend_unlock'), 1, 'one spend entry')

    const after = await t.as(buyer, () => getCode(t, place))
    eq(after.code, '4242', 'and the code is readable from then on')
    eq(after.locked, false, 'no longer locked for them')
  })

  test('gated: an empty balance buys nothing', async (t) => {
    await t.enableGating()
    const owner = await t.newUser()
    const broke = await t.newUser()
    const place = await t.place({ owner, code: '4242' })

    // Spend the signup bonus down below the price.
    await t.sql(`insert into credit_ledger (user_id, delta, reason)
                 values ($1, -4, 'manual_adjustment')`, [broke.id])
    eq(await t.balance(broke), 1, 'one credit, and the door costs two')

    const result = await t.as(broke, () => unlock(t, place))

    eq(result.ok, false, 'refused')
    eq(result.reason, 'insufficient', 'and says why')
    eq(result.balance, 1, 'reporting what they have')
    eq(result.cost, 2, 'against what it costs')
    eq(await t.balance(broke), 1, 'nothing was taken')
    eq(await t.val('select count(*) from code_unlocks where user_id = $1', [broke.id]), 0,
      'and no door was opened')
  })

  test('gated: you never pay twice for the same door', async (t) => {
    await t.enableGating()
    const owner = await t.newUser()
    const buyer = await t.newUser()
    const place = await t.place({ owner, code: '4242' })

    await t.as(buyer, () => unlock(t, place))
    eq(await t.balance(buyer), 3, 'paid once')

    const again = await t.as(buyer, () => unlock(t, place))
    eq(again.ok, true, 'still works')
    eq(again.charged, 0, 'but free the second time')
    eq(again.code, '4242', 'and still hands over the code')
    eq(await t.balance(buyer), 3, 'balance untouched')
    eq(await t.entries(buyer, 'spend_unlock'), 1, 'one spend, however many visits')
  })

  test('gated: an unlock survives the code changing', async (t) => {
    await t.enableGating()
    const owner = await t.newUser()
    const buyer = await t.newUser()
    const place = await t.place({ owner, code: '4242' })

    await t.as(buyer, () => unlock(t, place))

    // The code rotates. You paid for the door, not for a string.
    await t.as(await t.newUser(), () => t.val('select submit_code($1,$2)', [place.id, '9999']))

    const after = await t.as(buyer, () => getCode(t, place))
    eq(after.locked, false, 'still unlocked')
    eq(after.code, '9999', 'and you get the new code without paying again')
    eq(await t.balance(buyer), 3, 'no second charge')
  })

  test('gated: your own place is free to you', async (t) => {
    await t.enableGating()
    const owner = await t.newUser()
    const place = await t.place({ owner, code: '4242' })

    const view = await t.as(owner, () => getCode(t, place))
    eq(view.locked, false, 'never locked out of what you added')
    eq(view.code, '4242', 'the code is there')

    const result = await t.as(owner, () => unlock(t, place))
    eq(result.charged, 0, 'and unlocking it costs nothing')
    eq(await t.balance(owner), 5, 'the bonus is untouched')
  })

  test('gated: a code you contributed is free to you', async (t) => {
    await t.enableGating()
    const owner = await t.newUser()
    const author = await t.newUser()
    const place = await t.place({ owner })

    await t.as(author, () => t.val('select submit_code($1,$2)', [place.id, '7777']))

    const view = await t.as(author, () => getCode(t, place))
    eq(view.locked, false, 'you are not charged for your own contribution')
    eq(view.code, '7777', 'on someone else’s place')
    eq(await t.balance(author), 5, 'and nothing is spent')
  })

  test('gated: unlocking refuses what it cannot sell', async (t) => {
    await t.enableGating()
    const owner = await t.newUser()
    const buyer = await t.newUser()
    const codeless = await t.place({ owner, access: 'open' })

    await t.raises(() => t.as(buyer, () => unlock(t, codeless)), 'P0002',
      'there is no code to hand over')

    await t.raises(() => t.as(t.anonVisitor(), () => unlock(t, codeless)), '42501',
      'and signing in comes first')

    eq(await t.balance(buyer), 5, 'no charge either way')
  })

  test('gated: the price lives in one function', async (t) => {
    await t.enableGating()
    const owner = await t.newUser()
    const buyer = await t.newUser()
    const place = await t.place({ owner, code: '4242' })

    await t.sql(`create or replace function unlock_cost()
                 returns int language sql immutable as $fn$ select 4; $fn$`)

    const quoted = await t.as(buyer, () => getCode(t, place))
    eq(quoted.cost, 4, 'the quote follows unlock_cost()')

    const result = await t.as(buyer, () => unlock(t, place))
    eq(result.charged, 4, 'and so does the charge')
    eq(await t.balance(buyer), 1, '5 - 4')
  })

  test('gated: a balance can only be spent down to nothing', async (t) => {
    await t.enableGating()
    const owner = await t.newUser()
    const buyer = await t.newUser()

    const doors = []
    for (const code of ['1111', '2222', '3333']) {
      doors.push(await t.place({ owner, code }))
    }

    // Five credits, doors at two: two doors, and then no more.
    eq((await t.as(buyer, () => unlock(t, doors[0]))).charged, 2, 'first door')
    eq((await t.as(buyer, () => unlock(t, doors[1]))).charged, 2, 'second door')

    const third = await t.as(buyer, () => unlock(t, doors[2]))
    eq(third.ok, false, 'the third is refused')
    eq(third.reason, 'insufficient', 'for the reason you would expect')
    eq(await t.balance(buyer), 1, 'and the leftover credit stays put')
    eq(await t.entries(buyer, 'spend_unlock'), 2, 'two doors, two charges')

    // NOT TESTED, and worth knowing: the same two unlocks issued
    // concurrently. unlock_code takes a row lock on the buyer’s profile
    // before reading their balance precisely so that two sessions cannot
    // both read 2 and both charge. Proving that needs a second session that
    // can see this buyer — which needs a commit, and nothing here commits.
    // The lock is load-bearing; this suite covers what it protects, not the
    // race it protects against.
  })
  // --- what the client is allowed to touch directly ------------------------

  test('an unlock cannot be granted by asking for one', async (t) => {
    const owner = await t.newUser()
    const buyer = await t.newUser()
    const place = await t.place({ owner, code: '4242' })

    // unlock_code() is the only way into this table. A client that could write
    // to it directly would simply help itself.
    await t.as(buyer, () => t.asRole('authenticated', () =>
      t.raises(() => t.sql(
        'insert into code_unlocks (user_id, bathroom_id) values ($1,$2)',
        [buyer.id, place.id]), '42501', 'no insert privilege for a client')))

    eq(await t.val('select count(*) from code_unlocks where user_id = $1', [buyer.id]), 0,
      'nothing was written')
  })

  test('you cannot read anyone else’s unlocks', async (t) => {
    await t.enableGating()
    const owner = await t.newUser()
    const buyer = await t.newUser()
    const nosy = await t.newUser()
    const place = await t.place({ owner, code: '4242' })

    await t.as(buyer, () => unlock(t, place))

    const own = await t.as(buyer, () => t.asRole('authenticated', () =>
      t.sql('select bathroom_id from code_unlocks')))
    eq(own.length, 1, 'you see your own')

    const theirs = await t.as(nosy, () => t.asRole('authenticated', () =>
      t.sql('select bathroom_id from code_unlocks')))
    eq(theirs.length, 0, 'and only your own')
  })

  test('the ledger is not writable by the people it pays', async (t) => {
    const user = await t.newUser()

    await t.as(user, () => t.asRole('authenticated', () =>
      t.raises(() => t.sql(
        `insert into credit_ledger (user_id, delta, reason)
         values ($1, 1000, 'manual_adjustment')`, [user.id]),
        '42501', 'credits are minted by functions, never by clients')))

    eq(await t.balance(user), 5, 'still just the signup bonus')
  })
})
