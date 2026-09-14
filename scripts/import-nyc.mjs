#!/usr/bin/env node
/**
 * Import NYC Open Data's "Public Restrooms" dataset (i7jb-7jku).
 *
 *   node scripts/import-nyc.mjs                      dry run, whole city
 *   node scripts/import-nyc.mjs --bbox seed          dry run, the seeded area
 *   node scripts/import-nyc.mjs --bbox seed --apply  actually write
 *
 * LICENCE, READ BEFORE --apply
 * ---------------------------
 * This dataset declares NO licence. Its Socrata metadata has no `license`
 * field, and NYC's terms of use neither grant nor forbid redistribution — they
 * only disclaim warranty. That is ambiguity, not permission. Ask NYC Open Data
 * before you rely on this in anything public.
 *
 * Every row written records where it came from, so if the answer comes back
 * "no", removing them is one delete.
 */
import pg from 'pg'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = 'nyc-open-data:i7jb-7jku'
const LICENCE = 'undeclared (NYC Open Data, no license field in metadata)'
const ENDPOINT = 'https://data.cityofnewyork.us/resource/i7jb-7jku.json?$limit=5000'

// The area the hand-seeded rows cover, so a first import stays reviewable.
const SEED_BBOX = { minLat: 40.69, maxLat: 40.74, minLng: -74.03, maxLng: -73.98 }

/** Their vocabulary to ours. Anything unmapped becomes 'other', not dropped. */
const VENUE = {
  'Park': 'park',
  'Library': 'library',
  'Transit': 'transit',
  'Public Plaza': 'park',
  'Privately Owned Public Space': 'public_facility',
}

const norm = (v) =>
  v == null ? null : String(v).trim().toLowerCase().replace(/^"|"$/g, '')

/**
 * "Yes, in women's restroom only" is a changing table somebody cannot use.
 * Flattening it to a plain yes sends a father with an infant to a table he
 * cannot reach — the same wasted trip this importer already refuses to cause
 * by skipping closed restrooms.
 *
 * "in single-stall all gender restroom only" is not a restriction on who may
 * use it, only on where it is, so it maps to `any`.
 */
const changingTable = (v) => {
  const s = norm(v)
  if (s == null) return null
  if (!s.startsWith('yes')) return s === 'no' ? 'none' : null
  if (s.includes("women's")) return 'women_only'
  if (s.includes("men's")) return 'men_only'
  return 'any'
}

/**
 * Partial accessibility is its own answer, not a rounding of yes or no. The
 * column holds it because a wheelchair user cannot afford the trip that finds
 * out which way it rounded.
 */
const wheelchair = (v) => {
  const s = norm(v)
  if (s == null) return null
  if (s.startsWith('fully')) return 'full'
  if (s.startsWith('partially') || s.startsWith('limited')) return 'partial'
  if (s.startsWith('not')) return 'none'
  return null
}

/**
 * All-gender in any form counts, including "Both Single-Stall All Gender and
 * Multi-Stall W/M" — the question is whether such a restroom is there at all.
 * Note the source contains a "Single -Stall" typo, hence matching on the
 * meaningful part rather than the whole string.
 */
const genderNeutral = (v) => {
  const s = norm(v)
  if (s == null) return null
  if (s.includes('all gender')) return true
  if (s.includes('w/m')) return false
  return null
}

function loadEnv() {
  for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line)
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim()
  }
}

function dbConfig() {
  loadEnv()
  if (process.env.SUPABASE_DB_URL) {
    return { connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } }
  }
  const ref = /https:\/\/([a-z0-9]+)\.supabase\.co/.exec(process.env.VITE_SUPABASE_URL ?? '')?.[1]
  return {
    host: process.env.SUPABASE_DB_HOST ?? 'aws-0-us-east-1.pooler.supabase.com',
    port: 5432, database: 'postgres', user: `postgres.${ref}`,
    password: process.env.SUPABASE_DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
  }
}

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const seedOnly = args[args.indexOf('--bbox') + 1] === 'seed' && args.includes('--bbox')

const rows = await fetch(ENDPOINT).then((r) => {
  if (!r.ok) throw new Error(`NYC Open Data returned ${r.status}`)
  return r.json()
})

const stats = { fetched: rows.length, noCoords: 0, notOperational: 0, outsideBbox: 0, kept: 0 }
const keep = []

for (const r of rows) {
  const lat = Number(r.latitude), lng = Number(r.longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) { stats.noCoords++; continue }

  // A restroom known to be shut is worse than no pin: it sends someone on a
  // walk to a locked door, which is the exact failure this app exists to avoid.
  if (r.status !== 'Operational') { stats.notOperational++; continue }

  if (seedOnly && (lat < SEED_BBOX.minLat || lat > SEED_BBOX.maxLat ||
                   lng < SEED_BBOX.minLng || lng > SEED_BBOX.maxLng)) {
    stats.outsideBbox++; continue
  }

  keep.push({
    import_id: String(r.objectid ?? `${r.facility_name}|${lat},${lng}`),
    name: (r.facility_name || 'Public restroom').trim().slice(0, 120),
    lat, lng,
    venue_type: VENUE[r.location_type] ?? 'other',
    changing_table: changingTable(r.changing_stations),
    wheelchair: wheelchair(r.accessibility),
    gender_neutral: genderNeutral(r.restroom_type),
    operator: r.operator ?? null,
  })
  stats.kept++
}

console.log(`NYC Open Data — Public Restrooms (${SOURCE})`)
console.log(`  fetched            ${stats.fetched}`)
console.log(`  no coordinates     ${stats.noCoords}`)
console.log(`  not operational    ${stats.notOperational}   (deliberately skipped)`)
if (seedOnly) console.log(`  outside seed bbox  ${stats.outsideBbox}`)
console.log(`  would import       ${stats.kept}`)

const byType = keep.reduce((a, r) => ((a[r.venue_type] = (a[r.venue_type] ?? 0) + 1), a), {})
console.log(`  by venue type      ${JSON.stringify(byType)}`)
console.log('\n  first five:')
for (const r of keep.slice(0, 5)) {
  // Show every field being written. A dry run is the only look anyone gets
  // at this data before it lands on the map.
  const say = (k, v) => `${k}=${v ?? '?'}`
  console.log(`   - ${r.name.slice(0, 36).padEnd(36)} ${r.venue_type.padEnd(15)} ` +
    [say('step-free', r.wheelchair), say('changing', r.changing_table),
     say('all-gender', r.gender_neutral)].join('  '))
  if (r.operator) console.log(`       operated by ${r.operator}`)
}

// Collisions against what is already there. submit_bathroom refuses a pin
// within 20m; a bulk insert goes straight round that, and duplicate pins are
// how a crowdsourced map rots. Checked on dry runs too — knowing what would
// collide is most of the value of a dry run.
//
// 30m, not more: NYC lists two restrooms in Columbus Park 120m apart, and they
// are genuinely two buildings. A radius wide enough to catch a sloppy
// hand-placed pin is also wide enough to merge real facilities. So anything
// further out is reported rather than skipped, and a person decides.
const client = new pg.Client(dbConfig())
await client.connect()

const collisions = []
for (const r of keep) {
  const { rows: near } = await client.query(
    `select name, import_source from bathrooms
     where status = 'active'
       and st_dwithin(geog, st_setsrid(st_makepoint($1,$2),4326)::geography, 30)
       and import_source is distinct from $3
     limit 1`, [r.lng, r.lat, SOURCE])
  if (near.length) { r.collidesWith = near[0].name; collisions.push(r) }
}

// Same place, pin dropped carelessly? Look for a shared distinctive word
// within 150m — far enough to catch an eyeballed coordinate, reported rather
// than acted on because it is a guess.
const STOP = new Set(['park','the','and','library','nypl','bpl','qpl','st','street',
                      'public','restroom','restrooms','zone','playground','new','york'])
const tokens = (s) => new Set(String(s).toLowerCase().match(/[a-z]{3,}/g)?.filter(w => !STOP.has(w)) ?? [])

const suspects = []
for (const r of keep.filter((x) => !x.collidesWith)) {
  const { rows: near } = await client.query(
    `select name, round(st_distance(geog, st_setsrid(st_makepoint($1,$2),4326)::geography)::numeric,0) as m
     from bathrooms
     where status='active' and import_source is null
       and st_dwithin(geog, st_setsrid(st_makepoint($1,$2),4326)::geography, 150)
     order by 2 limit 3`, [r.lng, r.lat])
  for (const n of near) {
    const a = tokens(r.name), b = tokens(n.name)
    const shared = [...a].filter((w) => b.has(w))
    if (shared.length) { suspects.push({ ...r, other: n.name, m: n.m, shared }); break }
  }
}

if (collisions.length) {
  console.log(`\n  ${collisions.length} would land within 30m of an existing pin — skipped:`)
  for (const c of collisions.slice(0, 10)) {
    console.log(`   - ${c.name.slice(0, 38).padEnd(38)} near "${c.collidesWith}"`)
  }
  if (collisions.length > 10) console.log(`   ... and ${collisions.length - 10} more`)
}

if (suspects.length) {
  console.log(`\n  ${suspects.length} look like the same place as an existing pin, but are too far`)
  console.log('  apart to skip automatically. Decide these yourself:')
  for (const x of suspects) {
    console.log(`   ? ${x.name.slice(0, 34).padEnd(34)} ${String(x.m).padStart(4)}m from "${x.other}"`)
  }
}

const toWrite = keep.filter((r) => !r.collidesWith)
console.log(`\n  net new                ${toWrite.length}`)

if (!apply) {
  console.log('\nDry run. Nothing written. Re-run with --apply once the licence question is settled.')
  await client.end()
  process.exit(0)
}

try {
  await client.query('begin')
  let inserted = 0, updated = 0
  for (const r of toWrite) {
    const { rowCount } = await client.query(
      // floor_hint is deliberately absent. NYC does not supply one, and it is
      // the one field here a person might contribute later — overwriting that
      // on every re-import would quietly delete the only part of an imported
      // row that somebody actually walked to the place to write down.
      `insert into bathrooms
         (geog, name, venue_type, access_kind, changing_table, wheelchair,
          gender_neutral, operator, import_source, import_id, import_licence)
       values (st_setsrid(st_makepoint($1,$2),4326)::geography, $3, $4::venue_type,
               'open', $5::changing_table_access, $6::wheelchair_access,
               $7, $8, $9, $10, $11)
       on conflict (import_source, import_id) where import_source is not null
       do update set name = excluded.name,
                     venue_type = excluded.venue_type,
                     changing_table = excluded.changing_table,
                     wheelchair = excluded.wheelchair,
                     gender_neutral = excluded.gender_neutral,
                     operator = excluded.operator
       returning (xmax = 0) as is_insert`,
      [r.lng, r.lat, r.name, r.venue_type, r.changing_table, r.wheelchair,
       r.gender_neutral, r.operator, SOURCE, r.import_id, LICENCE])
    if (rowCount) inserted++
  }
  await client.query('commit')
  console.log(`\napplied: ${inserted} rows written`)
  const { rows: [t] } = await client.query(
    `select count(*)::int as imported from bathrooms where import_source = $1`, [SOURCE])
  console.log(`total from this source now: ${t.imported}`)
} catch (e) {
  await client.query('rollback')
  console.error('\nrolled back:', e.message)
  process.exitCode = 1
} finally {
  await client.end()
}
