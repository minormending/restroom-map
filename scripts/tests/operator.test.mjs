/**
 * The operator commands: `db.mjs queue|triage|hide|unhide|resolve`.
 *
 * These had no coverage at all until now, and the cost of that showed up in
 * #17: the move onto the shared database renamed flags.reason to flags.message
 * and added a NOT NULL `app` column, the moderation_queue view was updated for
 * it, and three commands that go to the base tables instead were not. `triage`
 * failed on every run for six days. `hide` — the kill switch — would have taken
 * a place off the map and then failed to write the record of why.
 *
 * The suite passed throughout. It covered the RPCs and the view, and nothing
 * ran the operator SQL. So the tests below are deliberately shaped around the
 * two things that actually broke:
 *
 *   - every column these statements name still exists, under the name used
 *   - every one of them is scoped to this app, because flags and feedback are
 *     shared tables and the rows of other apps sit in them
 *
 * They call the functions in lib/moderation.mjs directly, with the harness's
 * own transaction. See the note at the top of that file for why a subprocess
 * is not an option.
 */
import { suite, eq, ok } from '../lib/testkit.mjs'
import { hide, openQueue, resolve, triageItems, unhide } from '../lib/moderation.mjs'

/**
 * Must match MARKER in test.mjs — the canary hunts for it after each rollback.
 * Every row this suite writes carries it, including the reasons handed to
 * hide(), because those become flag rows in a shared table: one that escaped a
 * rollback would be an item in the real moderation queue, and the canary can
 * only catch what it can recognise.
 */
const MARKER = 'harness.invalid'

/**
 * A real neighbour on the shared database — `app` is a foreign key to apps.slug,
 * so this cannot be an invented name, and its rows must never reach this queue.
 * Its target types are its own ('place', not 'bathroom'), which is the other
 * half of how the registry keeps the two apart.
 */
const OTHER_APP = 'trip-companion'
const OTHER_APP_TARGET = 'place'

const sendFeedback = (t, { app = 'restroom-map', kind = 'bug', message, email = null, build = 'v99' }) =>
  t.val('select submit_feedback($1,$2,$3,$4,$5)', [app, kind, message, email, build])

const sendFlag = (t, place, message, { app = 'restroom-map', target = 'bathroom', email = null } = {}) =>
  t.val('select submit_flag($1,$2,$3,$4,$5)', [app, target, place.id, message, email])

/** Only the rows this test made. Real open items may exist and are not ours. */
const ours = (report) => report.items.filter((i) => i.message.includes(MARKER))

const placeRow = (t, place) =>
  t.one('select name, status, hidden_reason, hidden_at from bathrooms where id=$1', [place.id])

const flagsFor = (t, place) =>
  t.sql(`select app, message, resolved_at from flags
         where target_id=$1 order by created_at`, [place.id])

suite('operator commands', (test) => {

  // --- triage --------------------------------------------------------------

  test('open feedback reaches triage with its fields intact', async (t) => {
    await t.become(await t.anonVisitor())
    const message = `${MARKER} the code on Fulton is wrong`
    ok((await sendFeedback(t, { kind: 'bug', message, email: 'them@example.test' })).ok, 'accepted')

    const [item] = ours(await triageItems(t.client))
    ok(item, 'it is in the triage output')
    eq(item.message, message, 'message intact')
    eq(item.kind, 'bug', 'the kind it was filed under')
    eq(item.build, 'v99', 'the build they were on')
    eq(item.contact_email, 'them@example.test', 'somebody to answer')
    eq(item.source, 'feedback', 'and it says where it came from')
  })

  test('an open flag reaches triage, named by the place it is about', async (t) => {
    const place = await t.place({ owner: await t.newUser() })
    await t.become(await t.anonVisitor())
    await sendFlag(t, place, `${MARKER} this is my shop, please remove it`)

    const [item] = ours(await triageItems(t.client))
    ok(item, 'it is in the triage output')
    eq(item.kind, 'flag', 'filed as a flag, whatever the text says')
    eq(item.build, null, 'a flag has no build')
    eq(item.source, `flag:bathroom ${place.name}`, 'the place is named in the source')
  })

  test('a resolved item is not in the queue', async (t) => {
    await t.become(await t.anonVisitor())
    await sendFeedback(t, { message: `${MARKER} already dealt with` })

    const [item] = ours(await triageItems(t.client))
    await resolve(t.client, item.id)

    eq(ours(await triageItems(t.client)).length, 0, 'gone from triage')
  })

  test("another app's feedback stays out of this queue", async (t) => {
    await t.become(await t.anonVisitor())
    await sendFeedback(t, { app: OTHER_APP, message: `${MARKER} a bug in some other app` })

    eq(ours(await triageItems(t.client)).length, 0, 'not ours to triage')
  })

  test("another app's flag stays out of this queue", async (t) => {
    const place = await t.place({ owner: await t.newUser() })
    await t.become(await t.anonVisitor())
    await sendFlag(t, place, `${MARKER} a flag filed against another app`,
      { app: OTHER_APP, target: OTHER_APP_TARGET })

    eq(ours(await triageItems(t.client)).length, 0, 'not ours to triage')
  })

  test('queue and triage agree about what is open', async (t) => {
    await t.become(await t.anonVisitor())
    await sendFeedback(t, { message: `${MARKER} in both or in neither` })

    const inQueue = (await openQueue(t.client)).filter((r) => r.reason.includes(MARKER))
    const inTriage = ours(await triageItems(t.client))

    eq(inQueue.length, 1, 'the person-facing queue has it')
    eq(inTriage.length, 1, 'the machine-facing one too')
    eq(inQueue[0].id, inTriage[0].id, 'and it is the same row')
  })

  // --- hide / unhide -------------------------------------------------------

  test('hide takes a place off the map and records why', async (t) => {
    const place = await t.place({ owner: await t.newUser() })

    const why = `${MARKER} closed for a year`
    const { name } = await hide(t.client, place.id, why)
    eq(name, place.name, 'it says which place')

    const row = await placeRow(t, place)
    eq(row.status, 'hidden', 'off the map')
    eq(row.hidden_reason, why, 'and why')
    ok(row.hidden_at, 'and when')
  })

  test('hide writes the audit record, already resolved', async (t) => {
    // The half that was broken: this insert named `reason`, which no longer
    // exists, and omitted `app`, which is NOT NULL with no default. A place
    // could be hidden and the record of why never written.
    const place = await t.place({ owner: await t.newUser() })
    const why = `${MARKER} test data, not a real place`
    await hide(t.client, place.id, why)

    const [flag] = await flagsFor(t, place)
    ok(flag, 'a flag was written')
    eq(flag.app, 'restroom-map', 'attributed to this app')
    eq(flag.message, `hidden by operator: ${why}`, 'says who and why')
    ok(flag.resolved_at, 'and closed on the way in — nobody is being asked to look')
  })

  test('hiding does not put anything in the queue to read', async (t) => {
    const place = await t.place({ owner: await t.newUser() })
    await hide(t.client, place.id, `${MARKER} operator takedown`)

    eq(ours(await triageItems(t.client)).length, 0, 'an audit row is not an open item')
  })

  test('unhide puts it back', async (t) => {
    const place = await t.place({ owner: await t.newUser() })
    await hide(t.client, place.id, `${MARKER} a mistake`)

    eq((await unhide(t.client, place.id)).name, place.name, 'it says which place')

    const row = await placeRow(t, place)
    eq(row.status, 'active', 'back on the map')
    eq(row.hidden_reason, null, 'and the reason is cleared')
    eq(row.hidden_at, null, 'with it')
  })

  test('hide and unhide refuse an id that is not a place', async (t) => {
    const missing = '00000000-0000-4000-8000-000000000001'

    const a = await t.raises(() => hide(t.client, missing, `${MARKER} whatever`), null, 'hide')
    ok(a.message.includes(missing), 'the message names the id')
    const b = await t.raises(() => unhide(t.client, missing), null, 'unhide')
    ok(b.message.includes(missing), 'the message names the id')
  })

  // --- resolve -------------------------------------------------------------

  test('resolve closes a flag', async (t) => {
    // The half that raised before it touched a row: the column was named per
    // table, and the flags half still said `reason`.
    const place = await t.place({ owner: await t.newUser() })
    await t.become(await t.anonVisitor())
    await sendFlag(t, place, `${MARKER} the code has changed`)

    const [item] = ours(await triageItems(t.client))
    const done = await resolve(t.client, item.id)

    eq(done.table, 'flags', 'out of the flags table')
    eq(done.what, `${MARKER} the code has changed`, 'and it echoes what was closed')
    eq(ours(await triageItems(t.client)).length, 0, 'gone from the queue')
  })

  test('resolve closes feedback', async (t) => {
    await t.become(await t.anonVisitor())
    await sendFeedback(t, { kind: 'idea', message: `${MARKER} a filter for changing tables` })

    const [item] = ours(await triageItems(t.client))
    const done = await resolve(t.client, item.id)

    eq(done.table, 'feedback', 'out of the feedback table')
    eq(ours(await triageItems(t.client)).length, 0, 'gone from the queue')
  })

  test("resolve will not close another app's row", async (t) => {
    // Without the app guard this succeeds, and it closes something out of a
    // queue this operator cannot see and will never think to check.
    await t.become(await t.anonVisitor())
    await sendFeedback(t, { app: OTHER_APP, message: `${MARKER} not ours to close` })

    const id = await t.val(
      `select id from feedback where app=$1 and message like $2`, [OTHER_APP, `%${MARKER}%`])

    const err = await t.raises(() => resolve(t.client, id), null, 'resolving across apps')
    // Specifically refused for not being ours, rather than having fallen over
    // on the way. Without this the test passes against the broken version too,
    // which raised a column error before it got as far as deciding anything.
    ok(err.message.includes('nothing open in the queue'), 'refused, not broken')
    eq(await t.val('select resolved_at from feedback where id=$1', [id]), null, 'still open')
  })

  test('resolve refuses an id that is already closed', async (t) => {
    await t.become(await t.anonVisitor())
    await sendFeedback(t, { message: `${MARKER} closed twice` })

    const [item] = ours(await triageItems(t.client))
    await resolve(t.client, item.id)

    const err = await t.raises(() => resolve(t.client, item.id), null, 'the second time')
    ok(err.message.includes(item.id), 'the message names the id')
  })
})
