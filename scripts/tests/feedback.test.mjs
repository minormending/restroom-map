/**
 * The complaint box.
 *
 * Two things matter here and neither is the insert. First, that it takes a
 * message from somebody with no account at all — that is the whole reason it
 * exists, and an accidental `auth.uid() is not null` would quietly restore the
 * barrier it replaced. Second, that what arrives lands in the queue somebody
 * actually reads, because a table nobody looks at is worse than no table.
 */
import { suite, eq, ok } from '../lib/testkit.mjs'

const send = (t, kind, message, email = null) =>
  t.val('select submit_feedback($1,$2,$3,$4)', [kind, message, email, 'v99'])

const queued = (t) =>
  t.sql(`select subject, reason, contact_email, awaiting_reply from (
           select coalesce(bathroom_name, target_type) as subject,
                  reason, contact_email, awaiting_reply
           from moderation_queue) q
         where subject like 'feedback%' order by subject`)

suite('feedback', (test) => {
  test('a stranger with no account can send one', async (t) => {
    await t.become(await t.anonVisitor())

    const res = await send(t, 'bug', 'The code for the Starbucks on Fulton is wrong')
    ok(res.ok, 'accepted')

    const rows = await queued(t)
    eq(rows.length, 1, 'it reaches the queue')
    eq(rows[0].reason, 'The code for the Starbucks on Fulton is wrong', 'message intact')
    eq(rows[0].awaiting_reply, false, 'nobody is waiting on an answer')
  })

  test('the subject carries the kind and the build', async (t) => {
    await t.become(await t.anonVisitor())
    await send(t, 'idea', 'A filter for baby changing would help')

    const [row] = await queued(t)
    eq(row.subject, 'feedback: idea · v99', 'readable before the message is')
  })

  test('an address sorts it to the top, like a flag with one', async (t) => {
    await t.become(await t.anonVisitor())
    await send(t, 'complaint', 'This place has been closed for a year', 'someone@example.test')

    const [row] = await queued(t)
    eq(row.contact_email, 'someone@example.test', 'the address is kept')
    eq(row.awaiting_reply, true, 'and marks it as owed a reply')
  })

  test('an empty message is refused', async (t) => {
    await t.become(await t.anonVisitor())
    await t.raises(() => send(t, 'bug', '   '), '22023', 'a blank message')
    eq((await queued(t)).length, 0, 'nothing written')
  })

  test('an unknown kind is refused rather than coerced', async (t) => {
    await t.become(await t.anonVisitor())
    await t.raises(() => send(t, 'rant', 'something'), '22023', 'an invented kind')
  })

  test('five a day, then it stops', async (t) => {
    await t.become(await t.anonVisitor())
    for (let i = 0; i < 5; i++) ok((await send(t, 'bug', `report ${i}`)).ok, `number ${i + 1}`)

    await t.raises(() => send(t, 'bug', 'the sixth'), '53400', 'the sixth in a day')
    eq((await queued(t)).length, 5, 'and it is not in the queue')
  })

  test('resolved feedback leaves the queue', async (t) => {
    await t.become(await t.anonVisitor())
    await send(t, 'bug', 'something to close')

    // As the operator does it: db.mjs connects as the owner, not as one of
    // the API roles, which is the whole reason the queue has no grants.
    await t.sql(`update feedback set resolved_at = now()
                 where message = 'something to close'`)

    eq((await queued(t)).length, 0, 'gone from the queue, still in the table')
    eq(await t.val(`select count(*)::int from feedback where message = 'something to close'`), 1,
      'the row survives being dealt with')
  })

  test('nobody can read back what anybody else wrote', async (t) => {
    await t.become(await t.anonVisitor())
    await send(t, 'complaint', 'private words')

    // asRole, not become: become only sets the JWT claims and leaves the
    // connection as the owner, which bypasses RLS and would pass this either
    // way. Refused outright rather than answered with an empty set — there is
    // no SELECT grant to reach a policy with, which is the stronger answer.
    await t.raises(
      () => t.asRole('anon', () => t.val('select count(*)::int from feedback')),
      '42501', 'reading the report box')
  })

  test('the rate limit cannot be walked around', async (t) => {
    await t.become(await t.anonVisitor())

    // No INSERT grant and no policy: submit_feedback is the only door, so
    // rl_take is not optional the way it is for flags.
    await t.raises(
      () => t.asRole('anon', () =>
        t.sql(`insert into feedback (kind, message) values ('bug', 'straight in')`)),
      '42501', 'writing to the table directly')
  })
})
