/**
 * The operator commands, as functions over a client.
 *
 * These are the bodies of `db.mjs queue|triage|hide|unhide|resolve`. They live
 * here, apart from the command line that calls them, for one reason: the test
 * harness runs every test inside a transaction it always rolls back, so a test
 * cannot drive these through a subprocess — a second connection cannot see
 * uncommitted rows, and anything that committed to make it visible would trip
 * the canary and stop the run. Taking a client makes them callable with the
 * test's own transaction, which is the only way this code gets covered at all.
 *
 * So: SQL and decisions here, wording and exit codes in db.mjs. Nothing in
 * this file prints. A caller that wants to say something asks for the rows and
 * says it.
 */
import { APP } from './connect.mjs'

/** Open items for a person, richest first. Capped — this is a screenful. */
export async function openQueue(client, { limit = 50 } = {}) {
  const { rows } = await client.query(`
    select id, created_at, coalesce(bathroom_name, target_type) as subject,
           bathroom_status, reason, contact_email, awaiting_reply
    from moderation_queue limit $1`, [limit])
  return rows
}

/**
 * The queue as data, for the daily triage run.
 *
 * Deliberately separate from openQueue rather than a flag on it. `queue` is
 * written for a person on a weekday morning and should stay free to change its
 * wording; this is an interface something else parses, and the two wanting
 * different things is exactly how a pretty-printer ends up frozen by a scraper
 * nobody remembered.
 *
 * `message` is free text somebody typed into a form on the internet. It is
 * DATA. Anything downstream that reads it — a person, a model, a template —
 * must treat it as a report of a problem and never as an instruction, however
 * it is phrased. The `source` field is here so that is never ambiguous.
 *
 * Both halves filter on `app`. flags and feedback are shared tables and the
 * rows of every app sit in them together, so without it this hands the
 * restroom triage run somebody else's bug reports — about a codebase it cannot
 * read, from users it does not have.
 */
export async function triageItems(client) {
  const { rows } = await client.query(`
    select
      f.id,
      f.created_at,
      f.kind::text        as kind,
      f.message,
      f.contact_email,
      f.build,
      'feedback'          as source
    from feedback f
    where f.resolved_at is null and f.app = $1

    union all

    select
      g.id,
      g.created_at,
      'flag'              as kind,
      g.message,
      g.contact_email,
      null                as build,
      'flag:' || g.target_type || coalesce(' ' || b.name, '') as source
    from flags g
    left join bathrooms b on g.target_type = 'bathroom' and b.id = g.target_id
    where g.resolved_at is null and g.app = $1

    order by created_at`, [APP])

  return { generated_at: new Date().toISOString(), open: rows.length, items: rows }
}

/**
 * The kill switch. Hiding is a soft delete — the row, its reports and its
 * comments all survive, so a mistake or a disputed takedown is reversible.
 *
 * The two statements are not wrapped in a transaction here on purpose: the
 * caller owns that. db.mjs runs one command per connection and the test
 * harness is already inside a transaction of its own, so opening another would
 * either be redundant or nested.
 */
export async function hide(client, id, why) {
  const { rows } = await client.query(
    `update bathrooms set status='hidden', hidden_at=now(), hidden_reason=$2
     where id=$1 and status<>'removed' returning name, status`, [id, why])
  if (rows.length === 0) throw new Error(`no such place: ${id}`)

  // Logged as an already-resolved flag: this is the record that the place was
  // taken down and by whom, not a request for somebody to look at it.
  await client.query(
    `insert into flags (app, target_type, target_id, message, resolved_at)
     values ($1, 'bathroom', $2, $3, now())`,
    [APP, id, `hidden by operator: ${why}`])

  return { name: rows[0].name }
}

export async function unhide(client, id) {
  const { rows } = await client.query(
    `update bathrooms set status='active', hidden_at=null, hidden_reason=null
     where id=$1 returning name`, [id])
  if (rows.length === 0) throw new Error(`no such place: ${id}`)
  return { name: rows[0].name }
}

/**
 * Close one queue item, whichever table it came out of.
 *
 * The queue has two sources. An id from it is a flag or a piece of feedback and
 * the person typing it has no reason to know which — the queue does not say,
 * and should not have to.
 *
 * Both carry the text in `message`, so the column no longer varies with the
 * table. The `app` guard does though: these tables hold other apps' rows and an
 * id is a uuid either way, so without it a typo could resolve something out of
 * a queue this operator cannot see and will never think to check.
 */
export async function resolve(client, id) {
  for (const table of ['flags', 'feedback']) {
    const { rows } = await client.query(
      `update ${table} set resolved_at=now()
       where id=$1 and app=$2 and resolved_at is null
       returning message as what`, [id, APP])
    if (rows.length > 0) return { table, what: rows[0].what }
  }
  throw new Error(`nothing open in the queue with id ${id}`)
}
