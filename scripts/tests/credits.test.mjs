/**
 * The credit ledger.
 *
 * Two properties are worth more than the rest, and most of these tests exist
 * to pin one of them down:
 *
 *   Nothing pays out at submission time. Awards sit in escrow until
 *   independent people confirm the place is real — that is what makes a fake
 *   submission cost effort and return nothing.
 *
 *   The ledger is append-only and pays exactly once. ledger_dedupe is the
 *   single most important constraint in the schema; a retry, a race or a
 *   replay must not pay twice.
 */
import { suite, eq, ok } from '../lib/testkit.mjs'

/** Someone standing outside the place, confirming it works. */
const confirm = (t, who, place) => t.report(who, place, 'works', { geo: true })

/** Same, from someone who only tapped the button at home. */
const confirmRemotely = (t, who, place) => t.report(who, place, 'works')

suite('credits', (test) => {
  // --- the bonus -----------------------------------------------------------

  test('signing up is worth five credits, once', async (t) => {
    const user = await t.newUser()

    eq(await t.balance(user), 5, 'a new account starts with the signup bonus')
    eq(await t.entries(user, 'signup_bonus'), 1, 'exactly one bonus entry')

    // Migration 010 backfilled everyone who signed up before the bonus
    // existed. Running that backfill again must not pay a second time.
    await t.sql(`insert into credit_ledger (user_id, delta, reason, ref_type, ref_id)
                 select p.id, 5, 'signup_bonus', 'profile', p.id from profiles p
                 where p.id = $1 on conflict do nothing`, [user.id])

    eq(await t.balance(user), 5, 'the backfill is idempotent')
  })

  // --- escrow --------------------------------------------------------------

  test('submitting a place pays nothing on its own', async (t) => {
    const owner = await t.newUser()
    await t.place({ owner, code: '4242' })

    eq(await t.balance(owner), 5, 'still just the signup bonus')
    eq(await t.entries(owner, 'submission_verified'), 0, 'nothing has been verified yet')
  })

  test('two confirmations are not enough to release escrow', async (t) => {
    const owner = await t.newUser()
    const place = await t.place({ owner })

    await confirm(t, await t.newUser(), place)
    await confirm(t, await t.newUser(), place)

    eq(await t.entries(owner, 'submission_verified'), 0, 'three people are required')
    eq(await t.balance(owner), 5, 'and nothing is paid before then')
  })

  test('three confirmations from one spot are not enough either', async (t) => {
    const owner = await t.newUser()
    const place = await t.place({ owner })

    // Three people, but only one of them actually went there.
    await confirm(t, await t.newUser(), place)
    await confirmRemotely(t, await t.newUser(), place)
    await confirmRemotely(t, await t.newUser(), place)

    eq(await t.entries(owner, 'submission_verified'), 0,
      'two of the three confirmations must be geo-verified')
  })

  test('three confirmations, two of them on the spot, release ten credits', async (t) => {
    const owner = await t.newUser()
    const place = await t.place({ owner })

    await confirm(t, await t.newUser(), place)
    await confirm(t, await t.newUser(), place)
    eq(await t.entries(owner, 'submission_verified'), 0, 'not yet')

    await confirmRemotely(t, await t.newUser(), place)

    eq(await t.entries(owner, 'submission_verified'), 1, 'escrow releases on the third')
    eq(await t.balance(owner), 15, '5 signup + 10 verified')

    const entry = (await t.ledger(owner)).find((e) => e.reason === 'submission_verified')
    eq(entry.delta, 10, 'the award is ten')
    eq(entry.ref_type, 'bathroom', 'and it points at the place it paid for')
    eq(entry.ref_id, place.id, 'specifically this one')
  })

  test('a fourth confirmation does not pay a second time', async (t) => {
    const owner = await t.newUser()
    const place = await t.place({ owner })

    for (let i = 0; i < 3; i++) await confirm(t, await t.newUser(), place)
    eq(await t.balance(owner), 15, 'paid once')

    await confirm(t, await t.newUser(), place)
    await confirm(t, await t.newUser(), place)

    eq(await t.entries(owner, 'submission_verified'), 1, 'ledger_dedupe holds the line')
    eq(await t.balance(owner), 15, 'a popular place is not a salary')
  })

  test('accounts minted this morning cannot release escrow', async (t) => {
    const owner = await t.newUser()
    const place = await t.place({ owner })

    // The whole sockpuppet attack: sign up three accounts, confirm your own
    // submission from all of them, collect.
    for (let i = 0; i < 3; i++) {
      await confirm(t, await t.newUser({ ageDays: 0 }), place)
    }

    eq(await t.entries(owner, 'submission_verified'), 0,
      'confirmations only count from accounts older than a day')
    eq(await t.balance(owner), 5, 'the attack returns nothing')
  })

  test('a day-old account does count', async (t) => {
    const owner = await t.newUser()
    const place = await t.place({ owner })

    // The boundary either side: the sockpuppet test above would also pass if
    // the trigger simply never paid anyone.
    await confirm(t, await t.newUser({ ageDays: 2 }), place)
    await confirm(t, await t.newUser({ ageDays: 2 }), place)
    await confirm(t, await t.newUser({ ageDays: 2 }), place)

    eq(await t.entries(owner, 'submission_verified'), 1, 'aged accounts release escrow')
  })

  test('anonymous confirmations never move credits', async (t) => {
    const owner = await t.newUser()
    const place = await t.place({ owner })

    for (let i = 0; i < 4; i++) {
      const result = await confirm(t, t.anonVisitor(), place)
      ok(result.ok, 'an anonymous report is still accepted')
    }

    eq(await t.entries(owner, 'submission_verified'), 0,
      'a cleared cookie must not be worth anything')
    eq(await t.balance(owner), 5, 'anonymous reports inform freshness, not payouts')
  })

  test('you cannot confirm your own submission', async (t) => {
    const owner = await t.newUser()
    const place = await t.place({ owner })

    await t.raises(() => confirm(t, owner, place), '42501',
      'reporting your own place is refused outright')
  })

  test('an imported place pays nobody', async (t) => {
    const place = await t.place({ code: '9000' })   // no owner: a bulk-loaded row

    const confirmers = []
    for (let i = 0; i < 3; i++) {
      const who = await t.newUser()
      confirmers.push(who)
      await confirm(t, who, place)
    }

    eq(await t.val('select count(*) from credit_ledger where ref_id = $1', [place.id]), 0,
      'there is nobody to pay for an imported row')
    for (const who of confirmers) {
      eq(await t.balance(who), 5, 'and confirming is not itself paid work')
    }
  })

  // --- codes ---------------------------------------------------------------

  test('the first independent confirmation of a code pays its author five', async (t) => {
    const owner = await t.newUser()
    const author = await t.newUser()
    const place = await t.place({ owner })

    await t.as(author, () => t.val('select submit_code($1,$2)', [place.id, '8080']))
    eq(await t.balance(author), 5, 'submitting a code pays nothing by itself')

    await confirm(t, await t.newUser(), place)

    eq(await t.entries(author, 'code_verified'), 1, 'the code has been tested by someone else')
    const entry = (await t.ledger(author)).find((e) => e.reason === 'code_verified')
    eq(entry.delta, 5, 'worth five')
    eq(entry.ref_type, 'code', 'and it points at the code row, not the place')
  })

  test('a code author confirming their own code is paid nothing', async (t) => {
    const owner = await t.newUser()
    const author = await t.newUser()
    const place = await t.place({ owner })

    await t.as(author, () => t.val('select submit_code($1,$2)', [place.id, '8080']))
    await confirm(t, author, place)

    eq(await t.entries(author, 'code_verified'), 0, 'you cannot vouch for yourself')
    eq(await t.entries(author, 'passive_confirmation'), 0, 'nor trickle to yourself')
    eq(await t.balance(author), 5, 'still just the signup bonus')
  })

  test('code_verified is paid once however many people confirm', async (t) => {
    const owner = await t.newUser()
    const author = await t.newUser()
    const place = await t.place({ owner })
    await t.as(author, () => t.val('select submit_code($1,$2)', [place.id, '8080']))

    for (let i = 0; i < 4; i++) await confirm(t, await t.newUser(), place)

    eq(await t.entries(author, 'code_verified'), 1, 'one payout per code row')
  })

  test('the passive trickle stops at ten a day', async (t) => {
    const owner = await t.newUser()
    const author = await t.newUser()
    const place = await t.place({ owner })
    await t.as(author, () => t.val('select submit_code($1,$2)', [place.id, '8080']))

    // Eleven separate people confirm the same code in one day.
    for (let i = 0; i < 11; i++) await confirm(t, await t.newUser(), place)

    eq(await t.entries(author, 'passive_confirmation'), 10,
      'a popular code is capped, not a salary')
    eq(await t.balance(author), 20, '5 signup + 5 code_verified + 10 trickle')
  })

  test('a rotated code moves the reward to whoever wrote the live one', async (t) => {
    const owner = await t.newUser()
    const first = await t.newUser()
    const second = await t.newUser()
    const place = await t.place({ owner })

    await t.as(first, () => t.val('select submit_code($1,$2)', [place.id, '1111']))
    await t.as(second, () => t.val('select submit_code($1,$2)', [place.id, '2222']))

    await confirm(t, await t.newUser(), place)

    eq(await t.entries(first, 'code_verified'), 0,
      'the superseded code is not what anyone just tested')
    eq(await t.entries(second, 'code_verified'), 1,
      'confirmations attach to the code currently on offer')
  })

  // --- clawback ------------------------------------------------------------

  test('an auto-hidden place takes its award back', async (t) => {
    const owner = await t.newUser()
    const place = await t.place({ owner })

    for (let i = 0; i < 3; i++) await confirm(t, await t.newUser(), place)
    eq(await t.balance(owner), 15, 'paid out first')

    // Four separate people say it is gone: enough to outweigh the
    // confirmations and to clear the three-distinct-reporters bar.
    for (let i = 0; i < 4; i++) {
      await t.report(await t.newUser(), place, 'gone', { geo: true })
    }

    eq(await t.val('select status from bathrooms where id = $1', [place.id]), 'hidden',
      'the place comes off the map')
    eq(await t.entries(owner, 'fraud_clawback'), 1, 'and the award is reversed')
    eq(await t.balance(owner), 5, 'back to the signup bonus')
  })

  test('a clawback can only take back what was actually paid', async (t) => {
    const owner = await t.newUser()
    const place = await t.place({ owner })

    // Never confirmed by anyone, so escrow never released. Three complaints
    // are enough to hide it: there are no confirmations to outweigh.
    for (let i = 0; i < 3; i++) {
      await t.report(await t.newUser(), place, 'gone', { geo: true })
    }

    eq(await t.val('select status from bathrooms where id = $1', [place.id]), 'hidden',
      'still auto-hidden')
    eq(await t.entries(owner, 'fraud_clawback'), 0, 'but there is nothing to claw back')
    eq(await t.balance(owner), 5, 'a bogus submission cannot push a balance negative')
  })

  test('one person with several complaints is not three people', async (t) => {
    const owner = await t.newUser()
    const place = await t.place({ owner })
    const critic = await t.newUser()

    // 'gone' and 'code_bad' are separate rate-limit buckets, so one person can
    // file both against the same place. That is two rows and one reporter.
    await t.report(critic, place, 'gone', { geo: true })
    await t.report(critic, place, 'code_bad', { geo: true })
    await t.report(await t.newUser(), place, 'gone', { geo: true })

    const row = await t.one(
      `select troubles_90d, trouble_reporters_90d from bathroom_confidence
       where bathroom_id = $1`, [place.id])

    eq(row.troubles_90d, 3, 'three rows of trouble')
    eq(row.trouble_reporters_90d, 2, 'from two people')
    eq(await t.val('select status from bathrooms where id = $1', [place.id]), 'active',
      'and two people cannot delete a place off the map')
  })
})
