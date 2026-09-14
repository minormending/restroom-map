#!/usr/bin/env node
/**
 * Run the database test suites.
 *
 *   pnpm test                 every suite
 *   pnpm test credits         only suites whose name matches
 *   pnpm test -- --verbose    print every passing test, not just failures
 *
 * WHY THIS RUNS AGAINST THE REAL DATABASE
 *
 * The things worth testing here — the credit ledger, can_view_code(), the
 * award and auto-hide triggers — are Postgres functions with PostGIS
 * dependencies and Supabase's auth schema underneath them. A mock would test
 * the mock. There is no local Postgres on this machine and no container
 * runtime, so the project database is the only place this code actually runs.
 *
 * WHY THAT IS SAFE
 *
 * Every test runs inside a transaction that is ALWAYS rolled back — on pass,
 * on failure, on assertion error, on process death (the connection drops and
 * Postgres rolls back for us). Nothing a test writes is ever committed.
 *
 * That is the design. The enforcement is the canary: after each rollback the
 * runner counts rows carrying the test marker, and aborts the whole run the
 * moment one survives. If a test ever manages to commit — a stray `commit` in
 * a function body, a future change to how the pooler handles transactions —
 * the run stops on that test rather than quietly polluting the map.
 *
 * Tests never touch existing rows. They create their own users and places,
 * and the places sit at Null Island so the 20m duplicate check in
 * submit_bathroom cannot collide with anything real.
 */
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import pg from 'pg'
import { ROOT, dbConfig, withClient } from './lib/connect.mjs'
import { suites, AssertionError, raises } from './lib/testkit.mjs'

const TESTS = join(ROOT, 'scripts', 'tests')

/** Every row a test creates carries this, and the canary hunts for it. */
const MARKER = 'harness.invalid'

const args = process.argv.slice(2)
const verbose = args.includes('--verbose')
const filters = args.filter((a) => !a.startsWith('-'))

// --- the context handed to each test ---------------------------------------

function context(client, state) {
  const t = {
    /** Rows from one statement. */
    async sql(text, params) {
      return (await client.query(text, params)).rows
    },
    /** First row, or null. */
    async one(text, params) {
      return (await client.query(text, params)).rows[0] ?? null
    },
    /** First column of the first row, or null. */
    async val(text, params) {
      const row = await t.one(text, params)
      return row ? Object.values(row)[0] : null
    },

    /**
     * A signed-up user, created the way Supabase creates one: insert into
     * auth.users and let on_auth_user_created do the rest. That means the
     * profile row and the signup bonus come from the real trigger.
     *
     * Accounts default to two days old because escrow only counts
     * confirmations from accounts older than a day. Pass `ageDays: 0` for a
     * sockpuppet minted this morning.
     */
    async newUser({ ageDays = 2, name } = {}) {
      const n = ++state.users
      const row = await t.one(
        `insert into auth.users (id, email, raw_user_meta_data)
         values (gen_random_uuid(), $1, jsonb_build_object('full_name', $2::text))
         returning id`,
        [`user${n}@${MARKER}`, name ?? `Test User ${n}`])

      if (ageDays > 0) {
        await client.query(
          `update profiles set created_at = now() - ($2 || ' days')::interval
           where id = $1`, [row.id, ageDays])
      }
      // A distinct address per caller. Every rate limit in the schema is keyed
      // on client_fingerprint(), so without this every test user would share
      // one bucket and the third confirmation of anything would be refused.
      return { id: row.id, ip: `198.51.100.${n}`, label: `user${n}` }
    },

    /** Someone with no account, from their own address. */
    anonVisitor() {
      const n = ++state.users
      return { id: null, ip: `198.51.100.${n}`, label: `anon${n}` }
    },

    /** Run fn as this caller: their auth.uid() and their IP. */
    async as(who, fn) {
      const previous = state.current
      await t.become(who)

      let result, failure
      try {
        result = await fn()
      } catch (err) {
        failure = err
      }

      // Switching back must never mask what fn threw. When fn raises, the
      // transaction is aborted and every later statement — including this
      // restore — fails with 25P02, so a plain finally would report the
      // aborted-transaction error instead of the refusal being tested.
      await t.become(previous).catch(() => {})

      if (failure) throw failure
      return result
    },

    async become(who) {
      state.current = who ?? null
      await client.query('select set_config($1,$2,true), set_config($3,$4,true)', [
        'request.jwt.claims',
        who?.id ? JSON.stringify({ sub: who.id, role: 'authenticated' }) : '',
        'request.headers',
        JSON.stringify({ 'cf-connecting-ip': who?.ip ?? '198.51.100.254' }),
      ])
    },

    /**
     * A place on the map. With an owner it goes through submit_bathroom, so
     * the test exercises the real path; without one it is inserted directly as
     * an imported row, which is what a row with no one to pay looks like.
     */
    async place({ owner, name, code, venue = 'cafe', access = 'code_required' } = {}) {
      const n = ++state.places
      const lat = n * 0.002        // Null Island, spaced well past 20m apart
      const lng = 0
      const label = name ?? `TEST/${MARKER}/place${n}`

      if (!owner) {
        const row = await t.one(
          `insert into bathrooms
             (geog, name, venue_type, access_kind, import_source, import_id)
           values (st_setsrid(st_makepoint($2,$1),4326)::geography,
                   $3, $4::venue_type, $5::access_kind, 'test-harness', $6)
           returning id`,
          [lat, lng, label, venue, access, `${MARKER}/${n}`])
        if (code) {
          await client.query(
            `insert into bathroom_codes (bathroom_id, code) values ($1, $2)`,
            [row.id, code])
        }
        return { id: row.id, lat, lng, name: label }
      }

      const res = await t.as(owner, () => t.val(
        `select submit_bathroom($1,$2,$3,$4,$5,null,null,$6)`,
        [label, lat, lng, venue, access, code ?? null]))

      if (!res?.ok) throw new Error(`could not create a test place: ${JSON.stringify(res)}`)
      return { id: res.id, lat, lng, name: label }
    },

    /**
     * File a report through the real RPC. `geo: true` sends coordinates at the
     * place itself, which is what standing outside it looks like.
     */
    async report(who, place, kind, { geo = false } = {}) {
      return t.as(who, () => t.val(
        `select submit_report($1,$2,null,$3,$4)`,
        [place.id, kind, geo ? place.lat : null, geo ? place.lng : null]))
    },

    /** Balance through the view the profile page reads. */
    async balance(user) {
      return Number(await t.val(
        `select coalesce((select balance from user_credits where user_id = $1), 0)`,
        [user.id]))
    },

    /** Every ledger entry for a user, oldest first. */
    async ledger(user) {
      return t.sql(
        `select reason, delta, ref_type, ref_id from credit_ledger
         where user_id = $1 order by created_at, reason`, [user.id])
    },

    /** How many entries of one reason a user has. */
    async entries(user, reason) {
      return Number(await t.val(
        `select count(*) from credit_ledger where user_id = $1 and reason = $2`,
        [user.id, reason]))
    },

    /**
     * Re-install the M4 body of can_view_code(). Migration 013 opened codes
     * back up, so the gate is a no-op in production right now — but the whole
     * point of that design is that the lever can be pulled again. These tests
     * pull it, inside the transaction, and prove it still works.
     */
    async enableGating() {
      await client.query(`
        create or replace function can_view_code(p_user uuid, p_bathroom uuid)
        returns boolean
        language sql stable security definer set search_path = public, extensions as $fn$
          select p_user is not null and (
            exists (select 1 from bathrooms
                    where id = p_bathroom and created_by = p_user)
            or exists (select 1 from bathroom_codes
                       where bathroom_id = p_bathroom and submitted_by = p_user)
            or exists (select 1 from code_unlocks
                       where user_id = p_user and bathroom_id = p_bathroom)
          );
        $fn$`)
    },

    /**
     * Assert a call fails, and fails for the reason meant.
     *
     * The savepoint is not a nicety: in Postgres a raised error aborts the
     * whole transaction, so without one the first expected failure in a
     * test takes every statement after it down with a 25P02 that hides what
     * the test was actually checking.
     */
    async raises(fn, errcode, what) {
      await client.query('savepoint expected_failure')
      try {
        return await raises(fn, errcode, what)
      } finally {
        await client.query('rollback to savepoint expected_failure').catch(() => {})
      }
    },

    /**
     * A second database session, for the things one connection cannot show —
     * chiefly whether a lock is actually taken. Its transaction is rolled back
     * too, so the two sessions never see each other's rows: use it to prove
     * blocking, not to prove a committed outcome.
     */
    async secondSession(fn) {
      const other = new pg.Client(dbConfig({ applicationName: 'restroom-map/test (2nd session)' }))
      await other.connect()
      try {
        await other.query('begin')
        try {
          return await fn(other)
        } finally {
          await other.query('rollback').catch(() => {})
        }
      } finally {
        await other.end()
      }
    },
  }
  return t
}

// --- the runner ------------------------------------------------------------

/** Nothing a test wrote may outlive its rollback. */
async function canary(client) {
  const { rows } = await client.query(
    `select (select count(*) from auth.users where email like $1)     as users,
            (select count(*) from bathrooms where name like $2)       as places,
            (select count(*) from bathrooms where import_source = $3) as imports`,
    [`%@${MARKER}`, `TEST/${MARKER}/%`, 'test-harness'])

  const leaked = Object.entries(rows[0]).filter(([, n]) => Number(n) > 0)
  if (leaked.length > 0) {
    throw new Error(
      `test data survived a rollback: ${leaked.map(([k, n]) => `${n} ${k}`).join(', ')}\n` +
      `The run is stopping here. Something committed that should not have.`)
  }
}

async function main(client) {
  for (const file of readdirSync(TESTS).filter((f) => f.endsWith('.test.mjs')).sort()) {
    await import(pathToFileURL(join(TESTS, file)).href)
  }

  const selected = filters.length
    ? suites.filter((s) => filters.some((f) => s.name.includes(f)))
    : suites

  if (selected.length === 0) {
    console.error(`no suites match ${filters.join(', ')}`)
    console.error(`available: ${suites.map((s) => s.name).join(', ')}`)
    process.exit(1)
  }

  let passed = 0
  const failures = []
  const started = Date.now()

  for (const s of selected) {
    console.log(`\n  ${s.name}`)
    for (const test of s.tests) {
      const state = { users: 0, places: 0, current: null }
      let error
      await client.query('begin')
      try {
        await client.query(`set local statement_timeout = '30s'`)
        const t = context(client, state)
        await t.become(null)
        await test.fn(t)
      } catch (err) {
        error = err
      } finally {
        await client.query('rollback').catch(() => {})
      }

      // Before reporting anything, prove the rollback did its job.
      await canary(client)

      if (error) {
        failures.push({ suite: s.name, test: test.name, error })
        console.log(`    ✗ ${test.name}`)
      } else {
        passed++
        if (verbose) console.log(`    ✓ ${test.name}`)
      }
    }
  }

  const seconds = ((Date.now() - started) / 1000).toFixed(1)

  if (failures.length > 0) {
    console.log('\n')
    for (const f of failures) {
      console.log(`  ${f.suite} › ${f.test}`)
      const message = f.error instanceof AssertionError
        ? f.error.message
        : `${f.error.message}${f.error.code ? ` [${f.error.code}]` : ''}`
      console.log(`      ${message.split('\n').join('\n      ')}`)
      if (!(f.error instanceof AssertionError) && f.error.stack) {
        const frame = f.error.stack.split('\n').find((l) => l.includes('/tests/'))
        if (frame) console.log(`      ${frame.trim()}`)
      }
      console.log('')
    }
  }

  console.log(`\n  ${passed} passed, ${failures.length} failed  (${seconds}s)\n`)
  if (failures.length > 0) process.exit(1)
}

withClient(main, { applicationName: 'restroom-map/scripts/test.mjs' }).catch((err) => {
  console.error(`\n${err.message}\n`)
  process.exit(1)
})
