#!/usr/bin/env node
/**
 * Run SQL against the project database.
 *
 *   node scripts/db.mjs status              list applied and pending migrations
 *   node scripts/db.mjs migrate             apply pending migrations
 *   node scripts/db.mjs migrate --baseline  record existing files as applied
 *                                           without running them
 *   node scripts/db.mjs file <path.sql>     run one SQL file
 *   node scripts/db.mjs query "<sql>"       run ad-hoc SQL
 *   node scripts/db.mjs query -             read SQL from stdin
 *
 * Needs SUPABASE_DB_PASSWORD in .env — just the password. Host, port and user
 * are derived from VITE_SUPABASE_URL. Set SUPABASE_DB_URL instead if you'd
 * rather supply a full connection string. .env is gitignored either way.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MIGRATIONS = join(ROOT, 'supabase', 'migrations')

// --- config ----------------------------------------------------------------

function loadEnv() {
  const path = join(ROOT, '.env')
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line)
    if (!m) continue
    const value = m[2].trim().replace(/^["']|["']$/g, '')
    if (!(m[1] in process.env)) process.env[m[1]] = value
  }
}

function dbConfig() {
  loadEnv()
  const common = {
    // Supabase terminates TLS at the pooler with a cert Node's default trust
    // store doesn't carry. The channel is still encrypted.
    ssl: { rejectUnauthorized: false },
    application_name: 'restroom-map/scripts/db.mjs',
    connectionTimeoutMillis: 15_000,
  }

  // A full URL wins if you've set one.
  if (process.env.SUPABASE_DB_URL) {
    return { connectionString: process.env.SUPABASE_DB_URL, ...common }
  }

  // Otherwise derive it: the project ref is already in the public API URL, and
  // the password is passed as a field rather than interpolated into a URL, so
  // characters like @ : / # need no escaping.
  const password = process.env.SUPABASE_DB_PASSWORD
  const ref = /https:\/\/([a-z0-9]+)\.supabase\.co/.exec(
    process.env.VITE_SUPABASE_URL ?? '')?.[1]

  if (password && ref) {
    return {
      host: process.env.SUPABASE_DB_HOST ?? 'aws-0-us-east-1.pooler.supabase.com',
      port: Number(process.env.SUPABASE_DB_PORT ?? 5432),
      database: 'postgres',
      user: `postgres.${ref}`,
      password,
      ...common,
    }
  }

  console.error(`No database credentials found.

Add ONE line to .env:

  SUPABASE_DB_PASSWORD=your-database-password

That is the password from when the project was created. If it wasn't saved,
reset it at Database Settings -> Database password. Everything else (host,
port, user) is derived from VITE_SUPABASE_URL.

Alternatively set a full SUPABASE_DB_URL if you'd rather paste a connection
string. .env is gitignored either way.`)
  process.exit(1)
}

async function withClient(fn) {
  const client = new pg.Client(dbConfig())
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

// --- output ----------------------------------------------------------------

function printResult(res) {
  const results = Array.isArray(res) ? res : [res]
  for (const r of results) {
    if (!r) continue
    if (!r.rows || r.rows.length === 0) {
      console.log(`${r.command ?? 'OK'}${r.rowCount != null ? ` ${r.rowCount}` : ''}`)
      continue
    }
    const cols = r.fields.map((f) => f.name)
    const cell = (v) =>
      v === null ? 'NULL' : v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v)
    const widths = cols.map((c, i) =>
      Math.max(c.length, ...r.rows.map((row) => cell(row[cols[i]]).length)))
    const line = (chars) => chars.map((c, i) => c.padEnd(widths[i])).join('  ')
    console.log(line(cols))
    console.log(widths.map((w) => '-'.repeat(w)).join('  '))
    for (const row of r.rows) console.log(line(cols.map((c) => cell(row[c]))))
    console.log(`(${r.rows.length} row${r.rows.length === 1 ? '' : 's'})`)
  }
}

// --- migrations ------------------------------------------------------------

const TRACKING = `
create table if not exists schema_migrations (
  version    text primary key,
  checksum   text not null,
  applied_at timestamptz not null default now()
);`

const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16)

function migrationFiles() {
  if (!existsSync(MIGRATIONS)) return []
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => {
      const sql = readFileSync(join(MIGRATIONS, f), 'utf8')
      return { version: basename(f, '.sql'), file: f, sql, checksum: sha(sql) }
    })
}

async function appliedMap(client) {
  await client.query(TRACKING)
  const { rows } = await client.query('select version, checksum from schema_migrations')
  return new Map(rows.map((r) => [r.version, r.checksum]))
}

async function status(client) {
  const applied = await appliedMap(client)
  const files = migrationFiles()
  if (files.length === 0) return console.log('no migration files found')
  for (const m of files) {
    const known = applied.get(m.version)
    const state = known === undefined ? 'PENDING'
      : known === m.checksum ? 'applied'
      : 'applied (FILE CHANGED SINCE)'
    console.log(`  ${state.padEnd(28)} ${m.file}`)
  }
  const pending = files.filter((m) => !applied.has(m.version)).length
  console.log(`\n${files.length} migration${files.length === 1 ? '' : 's'}, ${pending} pending`)
}

async function migrate(client, { baseline }) {
  const applied = await appliedMap(client)
  const pending = migrationFiles().filter((m) => !applied.has(m.version))

  if (pending.length === 0) return console.log('nothing to apply')

  if (baseline) {
    for (const m of pending) {
      await client.query(
        'insert into schema_migrations (version, checksum) values ($1, $2) on conflict do nothing',
        [m.version, m.checksum])
      console.log(`  recorded (not run)  ${m.file}`)
    }
    console.log(`\nbaselined ${pending.length} migration${pending.length === 1 ? '' : 's'}`)
    return
  }

  for (const m of pending) {
    process.stdout.write(`  applying ${m.file} ... `)
    // Each migration is one transaction: it lands whole or not at all.
    await client.query('begin')
    try {
      await client.query(m.sql)
      await client.query(
        'insert into schema_migrations (version, checksum) values ($1, $2)',
        [m.version, m.checksum])
      await client.query('commit')
      console.log('ok')
    } catch (err) {
      await client.query('rollback')
      console.log('FAILED')
      console.error(`\n${err.message}`)
      if (err.position) console.error(`  at character ${err.position}`)
      if (err.hint) console.error(`  hint: ${err.hint}`)
      process.exit(1)
    }
  }
  console.log(`\napplied ${pending.length} migration${pending.length === 1 ? '' : 's'}`)
}

// --- entry -----------------------------------------------------------------

const [cmd, ...rest] = process.argv.slice(2)

const commands = {
  status: (c) => status(c),
  migrate: (c) => migrate(c, { baseline: rest.includes('--baseline') }),
  file: async (c) => {
    const path = rest[0]
    if (!path) throw new Error('usage: db.mjs file <path.sql>')
    printResult(await c.query(readFileSync(path, 'utf8')))
  },
  query: async (c) => {
    const sql = rest[0] === '-' ? readFileSync(0, 'utf8') : rest.join(' ')
    if (!sql?.trim()) throw new Error('usage: db.mjs query "<sql>"')
    printResult(await c.query(sql))
  },
}

if (!cmd || !(cmd in commands)) {
  console.error(`usage: db.mjs <status|migrate|file|query> [...]

  status                  list applied and pending migrations
  migrate                 apply pending migrations
  migrate --baseline      record pending files as applied WITHOUT running them
  file <path.sql>         run one SQL file
  query "<sql>"           run ad-hoc SQL ("-" reads stdin)`)
  process.exit(1)
}

withClient(commands[cmd]).catch((err) => {
  console.error(err.message)
  if (err.hint) console.error(`hint: ${err.hint}`)
  process.exit(1)
})
