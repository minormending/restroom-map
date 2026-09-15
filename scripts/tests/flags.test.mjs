/**
 * Flags, and the door that used to stand beside the one with a lock on it.
 *
 * submit_flag() takes ten a day per fingerprint. Until migration 024 the table
 * also carried an INSERT grant and a policy asking only that reporter_id be
 * null, so anybody could skip the function and write as many rows as they
 * liked — anonymously, into the table that receives takedown requests.
 *
 * Most of what is below is about that: the limit holds, and there is no longer
 * a way round it. The rest is the path a business actually takes to ask for
 * their premises to come off the map, which goes through here.
 */
import { suite, eq, ok } from '../lib/testkit.mjs'

const flag = (t, place, reason, email = null) =>
  t.val('select submit_flag($1,$2,$3,$4)', ['bathroom', place.id, reason, email])

const queued = (t, place) =>
  t.sql(`select reason, contact_email, awaiting_reply, bathroom_name
         from moderation_queue where target_id = $1 order by reason`, [place.id])

suite('flags', (test) => {
  test('a stranger can report a listing', async (t) => {
    const place = await t.place({ owner: await t.newUser() })
    await t.become(await t.anonVisitor())

    ok((await flag(t, place, 'The code has changed')).ok, 'accepted')

    const rows = await queued(t, place)
    eq(rows.length, 1, 'it reaches the queue')
    eq(rows[0].reason, 'The code has changed', 'intact')
    eq(rows[0].bathroom_name, place.name, 'named by the place it is about')
  })

  test('a takedown request sorts to the top', async (t) => {
    const place = await t.place({ owner: await t.newUser() })
    await t.become(await t.anonVisitor())

    await flag(t, place, 'This is my shop, please remove it', 'owner@example.test')

    const [row] = await queued(t, place)
    eq(row.contact_email, 'owner@example.test', 'the address is kept')
    eq(row.awaiting_reply, true, 'somebody is owed an answer')
  })

  test('ten a day, then it stops', async (t) => {
    const place = await t.place({ owner: await t.newUser() })
    await t.become(await t.anonVisitor())

    for (let i = 0; i < 10; i++) ok((await flag(t, place, `report ${i}`)).ok, `number ${i + 1}`)
    await t.raises(() => flag(t, place, 'the eleventh'), '53400', 'the eleventh in a day')
    eq((await queued(t, place)).length, 10, 'and it is not in the queue')
  })

  test('the limit cannot be walked around by writing to the table', async (t) => {
    const place = await t.place({ owner: await t.newUser() })

    // The bypass migration 024 closed. asRole, not become: become leaves the
    // connection as the owner, which grants and RLS do not apply to, so this
    // would pass against the broken schema too.
    for (const role of ['anon', 'authenticated']) {
      await t.raises(
        () => t.asRole(role, () => t.sql(
          `insert into flags (target_type, target_id, reason)
           values ('bathroom', $1, 'straight in')`, [place.id])),
        '42501', `writing to flags as ${role}`)
    }

    eq((await queued(t, place)).length, 0, 'nothing got in')
  })

  test('an empty reason is refused', async (t) => {
    const place = await t.place({ owner: await t.newUser() })
    await t.become(await t.anonVisitor())
    await t.raises(() => flag(t, place, '   '), '22023', 'a blank reason')
  })

  test('an unknown target type is refused rather than stored', async (t) => {
    await t.become(await t.anonVisitor())
    await t.raises(
      () => t.val('select submit_flag($1,$2,$3,$4)',
        ['bathhouse', '00000000-0000-4000-8000-000000000001', 'whatever', null]),
      '22023', 'an invented target type')
  })

  test('nobody can read the queue back', async (t) => {
    const place = await t.place({ owner: await t.newUser() })
    await t.become(await t.anonVisitor())
    await flag(t, place, 'private words')

    for (const role of ['anon', 'authenticated']) {
      await t.raises(
        () => t.asRole(role, () => t.val('select count(*)::int from flags')),
        '42501', `reading flags as ${role}`)
    }
  })
})
