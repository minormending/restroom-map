/**
 * Accessibility claims, and what it takes to believe one.
 *
 * The rule under test is short enough to state in a sentence — two people who
 * agree settle a field — and every interesting case is a way that sentence can
 * go wrong: the same person counted twice, two people who disagree, a third
 * who breaks the tie, a field an import already answered.
 *
 * It is worth the same care as the credit ledger. Somebody reads "there is a
 * hoist" and crosses a city on it.
 */
import { suite, eq, ok } from '../lib/testkit.mjs'

const claim = (t, who, place, field, value) =>
  t.as(who, () => t.val('select submit_access_claim($1,$2,$3)', [place.id, field, value]))

const settled = (t, place, field) =>
  t.val(`select ${field}::text from bathrooms where id = $1`, [place.id])

const state = (t, place) =>
  t.sql(`select field::text as field, value, claims, disputed
         from access_claim_state where bathroom_id = $1 order by field, value`, [place.id])

suite('access claims', (test) => {
  test('one person is an account, not a fact', async (t) => {
    const owner = await t.newUser()
    const place = await t.place({ owner })

    const res = await claim(t, await t.newUser(), place, 'grab_bars', 'true')
    ok(res.ok, 'the claim is accepted')
    eq(res.settled, false, 'but it does not settle anything')
    eq(await settled(t, place, 'grab_bars'), null, 'the column stays empty')

    const rows = await state(t, place)
    eq(rows.length, 1, 'one claim on record')
    eq(rows[0].claims, 1, 'from one person')
    eq(rows[0].disputed, false, 'nobody has contradicted it')
  })

  test('two people who agree settle it', async (t) => {
    const owner = await t.newUser()
    const place = await t.place({ owner })

    await claim(t, await t.newUser(), place, 'grab_bars', 'true')
    const second = await claim(t, await t.newUser(), place, 'grab_bars', 'true')

    eq(second.settled, true, 'the second claim settles the field')
    eq(await settled(t, place, 'grab_bars'), 'true', 'and the column now holds it')
    eq((await state(t, place)).length, 0, 'settled fields leave the work-in-progress view')
  })

  test('one person saying it twice is still one person', async (t) => {
    const owner = await t.newUser()
    const place = await t.place({ owner })
    const keen = await t.newUser()

    await claim(t, keen, place, 'shelf', 'true')
    await claim(t, keen, place, 'shelf', 'true')

    eq(await settled(t, place, 'shelf'), null, 'repeating yourself is not corroboration')
    const rows = await state(t, place)
    eq(rows.length, 1, 'still one row')
    eq(rows[0].claims, 1, 'still one claimant')
  })

  test('you can correct your own answer', async (t) => {
    const owner = await t.newUser()
    const place = await t.place({ owner })
    const who = await t.newUser()

    await claim(t, who, place, 'shelf', 'true')
    await claim(t, who, place, 'shelf', 'false')

    const rows = await state(t, place)
    eq(rows.length, 1, 'the old answer is replaced, not added to')
    eq(rows[0].value, 'false', 'the new one stands')
    eq(rows[0].disputed, false, 'and changing your mind is not a dispute')
  })

  test('two people who disagree settle nothing', async (t) => {
    const owner = await t.newUser()
    const place = await t.place({ owner })

    await claim(t, await t.newUser(), place, 'turning_space', 'true')
    await claim(t, await t.newUser(), place, 'turning_space', 'false')

    eq(await settled(t, place, 'turning_space'), null, 'the column stays empty')
    const rows = await state(t, place)
    eq(rows.length, 2, 'both answers are on record')
    ok(rows.every((r) => r.disputed), 'and both are marked disputed')
  })

  test('a third voice breaks the tie', async (t) => {
    const owner = await t.newUser()
    const place = await t.place({ owner })

    await claim(t, await t.newUser(), place, 'turning_space', 'true')
    await claim(t, await t.newUser(), place, 'turning_space', 'false')
    await claim(t, await t.newUser(), place, 'turning_space', 'true')

    eq(await settled(t, place, 'turning_space'), 'true',
      'two agreeing beats one disagreeing')
  })

  test('a settled field stops taking claims', async (t) => {
    const owner = await t.newUser()
    const place = await t.place({ owner })

    await claim(t, await t.newUser(), place, 'sink_in_stall', 'true')
    await claim(t, await t.newUser(), place, 'sink_in_stall', 'true')

    const late = await claim(t, await t.newUser(), place, 'sink_in_stall', 'false')
    eq(late.ok, false, 'refused')
    eq(late.reason, 'already_settled', 'and says why')
    eq(await settled(t, place, 'sink_in_stall'), 'true', 'the settled answer is untouched')
  })

  test('an imported answer cannot be contradicted', async (t) => {
    // Fill-only means exactly this: the official data is not up for a vote
    // until correcting settled facts has a design of its own.
    const place = await t.place({ code: null })
    await t.sql(`update bathrooms set wheelchair = 'full' where id = $1`, [place.id])

    const res = await claim(t, await t.newUser(), place, 'wheelchair', 'none')
    eq(res.ok, false, 'refused')
    eq(res.reason, 'already_settled', 'for the same reason as any settled field')
    eq(await settled(t, place, 'wheelchair'), 'full', 'and the import stands')
  })

  test('enum fields settle to their own type, not to a string', async (t) => {
    const owner = await t.newUser()
    const place = await t.place({ owner })

    await claim(t, await t.newUser(), place, 'adult_changing', 'changing_places')
    await claim(t, await t.newUser(), place, 'adult_changing', 'changing_places')

    eq(await settled(t, place, 'adult_changing'), 'changing_places', 'promoted')
    // The cast in the trigger is chosen per field; a boolean cast here would
    // have thrown, and a text column would have taken anything at all.
    eq(await t.val(`select pg_typeof(adult_changing)::text from bathrooms where id = $1`,
      [place.id]), 'adult_changing_kind', 'into the column its own type')
  })

  test('a value the column could not hold is refused', async (t) => {
    const owner = await t.newUser()
    const place = await t.place({ owner })
    const who = await t.newUser()

    await t.raises(() => claim(t, who, place, 'adult_changing', 'yes'), '22023',
      'not one of the three answers that field has')
    await t.raises(() => claim(t, who, place, 'grab_bars', 'maybe'), '22023',
      'a boolean field takes true or false')
    await t.raises(() => claim(t, who, place, 'bidet', 'true'), '22023',
      'and an unknown field is not quietly created')
  })

  test('claiming needs an account', async (t) => {
    const owner = await t.newUser()
    const place = await t.place({ owner })

    await t.raises(() => claim(t, t.anonVisitor(), place, 'grab_bars', 'true'), '42501',
      'an anonymous claim would be unaccountable, and two of them would settle a fact')
  })

  test('a client cannot write the tally directly', async (t) => {
    const owner = await t.newUser()
    const place = await t.place({ owner })
    const who = await t.newUser()

    // Two rows inserted by hand would settle any field instantly.
    await t.as(who, () => t.asRole('authenticated', () =>
      t.raises(() => t.sql(
        `insert into access_claims (bathroom_id, field, value, user_id)
         values ($1, 'grab_bars', 'true', $2)`, [place.id, who.id]),
        '42501', 'submit_access_claim is the only way in')))

    eq(await t.val('select count(*) from access_claims where bathroom_id = $1',
      [place.id]), 0, 'nothing written')
  })

  test('anyone can read what has been claimed', async (t) => {
    const owner = await t.newUser()
    const place = await t.place({ owner })
    await claim(t, await t.newUser(), place, 'shelf', 'true')

    // A reader has to be able to tell one account from a corroborated fact,
    // which means the tally is public even though writing it is not.
    const seen = await t.asRole('anon', () =>
      t.sql('select value, claims from access_claim_state where bathroom_id = $1', [place.id]))
    eq(seen.length, 1, 'visible to a signed-out reader')
    eq(seen[0].claims, 1, 'including how thin the evidence is')
  })
})

suite('hours', (test) => {
  const claim = (t, who, place, value) =>
    t.as(who, () => t.val('select submit_access_claim($1,$2,$3)', [place.id, 'hours', value]))

  test('hours settle like any other claim', async (t) => {
    const owner = await t.newUser()
    const place = await t.place({ owner })

    await claim(t, await t.newUser(), place, 'always')
    await claim(t, await t.newUser(), place, 'always')

    eq(await t.val('select hours::text from bathrooms where id = $1', [place.id]), 'always',
      'two people who agree settle it, same as every other field')
  })

  test('only the three answers are accepted', async (t) => {
    const owner = await t.newUser()
    const place = await t.place({ owner })

    const who = await t.newUser()
    await t.raises(() => claim(t, who, place, 'Mo-Fr 09:00-17:00'), '22023',
      'a real schedule is refused: two people would never phrase one the same way, ' +
      'so it could never corroborate')
  })

  test('open now matches what it can compute and nothing else', async (t) => {
    const owner = await t.newUser()
    const always = await t.place({ owner })
    const venue = await t.place({ owner })
    const unknown = await t.place({ owner })

    await t.sql(`update bathrooms set hours = 'always' where id = $1`, [always.id])
    await t.sql(`update bathrooms set hours = 'venue' where id = $1`, [venue.id])

    // Null Island, where the test places live.
    const open = await t.sql(
      `select id from bathrooms_in_view(-0.01, -0.01, 0.01, 0.2, null, null, 300, array['open_now'])`)
    const ids = open.map((r) => r.id)

    ok(ids.includes(always.id), 'around-the-clock is open now')
    ok(!ids.includes(venue.id),
      "the venue's hours decide, and this map does not know them")
    ok(!ids.includes(unknown.id), 'unknown is never a match, as everywhere else')
  })
})
