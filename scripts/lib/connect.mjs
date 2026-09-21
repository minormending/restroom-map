/**
 * Database connection, shared by scripts/db.mjs and scripts/test.mjs.
 *
 * Needs SUPABASE_DB_PASSWORD in .env — just the password. Host, port and user
 * are derived from VITE_SUPABASE_URL. Set SUPABASE_DB_URL instead if you'd
 * rather supply a full connection string. .env is gitignored either way.
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

export function loadEnv() {
  const path = join(ROOT, '.env')
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line)
    if (!m) continue
    const value = m[2].trim().replace(/^["']|["']$/g, '')
    if (!(m[1] in process.env)) process.env[m[1]] = value
  }
}

export function dbConfig({ applicationName = 'restroom-map/scripts' } = {}) {
  loadEnv()
  const common = {
    // Supabase terminates TLS at the pooler with a cert Node's default trust
    // store doesn't carry. The channel is still encrypted.
    ssl: { rejectUnauthorized: false },
    application_name: applicationName,
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

/**
 * This app's tables live in the `restroom` schema of a database shared with
 * other apps. `public` still comes second, because profiles, rate limiting and
 * the moderation queue live there and are shared by every app.
 *
 * Setting it here rather than per script also means `schema_migrations` lands
 * in `restroom`, so each app tracks its own migrations instead of colliding on
 * version numbers — every one of them starts at 0001.
 */
export const SCHEMA = process.env.RESTROOM_SCHEMA ?? 'restroom'

export async function withClient(fn, options) {
  const client = new pg.Client(dbConfig(options))
  await client.connect()
  try {
    await client.query(`set search_path = ${SCHEMA}, public, extensions`)
    return await fn(client)
  } finally {
    await client.end()
  }
}
