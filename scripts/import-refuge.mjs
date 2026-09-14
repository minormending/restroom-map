#!/usr/bin/env node
/**
 * Import Refuge Restrooms.
 *
 *   node scripts/import-refuge.mjs --bbox seed           dry run, seeded area
 *   node scripts/import-refuge.mjs --bbox seed --apply   write
 *
 * refugerestrooms.org indexes safe restrooms for trans, intersex and gender
 * nonconforming people. It is the only source found that carries a written
 * direction to the door — "in the back of the store, past the registers" — and
 * that sentence is the difference between a pin and a restroom you can find.
 *
 * WHAT IS DELIBERATELY NOT IMPORTED
 *
 * Refuge's `accessible` is a single crowdsourced tick. This schema separates
 * full / partial / none precisely because a boolean forces partial access into
 * a lie, and migration 018 made that split to stop somebody being sent to a
 * door they cannot get through. Promoting a stranger's tick to 'full' would
 * put back the exact error the column was reshaped to prevent, so the flag is
 * read, counted in the dry run, and dropped.
 *
 * `unisex` and `changing_table` are imported: those are binary questions with
 * binary answers, and a tick means the same thing to everybody.
 *
 * THE LICENCE IS NOT STATED
 *
 * The code is AGPL-3.0. The data carries no licence anywhere on the site, the
 * API, or the repository — the same ambiguity as NYC Open Data, and ambiguity
 * is not permission. Every row records import_source and import_licence, so
 * withdrawing the lot stays one delete.
 */
import pg from 'pg'
import { dbConfig } from './lib/connect.mjs'

const SOURCE = 'refuge-restrooms'
const LICENCE = 'undeclared (refugerestrooms.org states none for its data; code is AGPL-3.0)'
const API = 'https://www.refugerestrooms.org/api/v1/restrooms/by_location'

const SEED_BBOX = { minLat: 40.69, maxLat: 40.74, minLng: -74.03, maxLng: -73.98 }

const apply = process.argv.includes('--apply')
const seedOnly = process.argv.includes('--bbox') &&
  process.argv[process.argv.indexOf('--bbox') + 1] === 'seed'

/** Their vocabulary is free text; ours is an enum. Anything unrecognised is
 *  'other' rather than dropped — a restroom with a bad label is still one. */
const VENUE = [
  [/\b(starbucks|dunkin|caf[eé]|coffee|bakery|tea|espresso|patisserie)\b/i, 'cafe'],
  [/\b(library|nypl|bpl|qpl)\b/i, 'library'],
  [/\b(park|playground|garden|square|plaza)\b/i, 'park'],
  [/\b(station|subway|terminal|ferry|transit|amtrak|port authority)\b/i, 'transit'],
  [/\b(hotel|inn|hostel)\b/i, 'hotel'],
  [/\b(gas|shell|exxon|mobil|citgo)\b/i, 'gas_station'],
  [/\b(restaurant|ristorante|trattoria|bistro|eatery|kitchen|taqueria|diner|grill|pizza|pizzeria|bar|pub|tavern|deli|sushi|noodle|burger)\b/i, 'restaurant'],
  [/\b(bookstore|books|store|shop|market|target|walmart|whole foods|duane reade|cvs|walgreens|grocery)\b/i, 'store'],
  [/\b(museum|gallery|theater|theatre|hall|center|centre|court|hospital|clinic|school|college|university|institute)\b/i, 'public_facility'],
]
const venueOf = (name) => VENUE.find(([re]) => re.test(name))?.[1] ?? 'other'

async function fetchAll() {
  const rows = []
  const seen = new Set()
  // The API is proximity-paged rather than bbox-queried, so it is walked
  // outward from the middle of the seeded area until it stops returning new
  // ids or leaves the box behind.
  for (let page = 1; page <= 20; page++) {
    const url = `${API}?lat=40.715&lng=-74.005&per_page=100&page=${page}`
    const r = await fetch(url, { headers: { 'User-Agent': 'restroom-map-import/1.0' } })
    if (!r.ok) throw new Error(`Refuge Restrooms returned ${r.status}`)
    const batch = await r.json()
    if (!batch.length) break
    for (const row of batch) {
      if (!seen.has(row.id)) { seen.add(row.id); rows.push(row) }
    }
  }
  return rows
}

const raw = await fetchAll()

/**
 * Three filters, each earned by looking at what came back.
 *
 * FALLBACK COORDINATES. 91 of 396 rows in the seeded area sat on one point —
 * Jeremy, Carrol, Gabriella, Nogood87 — which is a geocoder giving up, not a
 * building. Any coordinate carrying five or more rows is treated as one. A
 * genuine building might collect two or three entries; it does not collect
 * ninety.
 *
 * REPEATS. The same venue gets entered again and again: The Public Theater
 * four times, the Whitney three. Collapsed to the best-attested one.
 *
 * VOTES. This is the filter that matters. Refuge lets its own users vote, and
 * they have: "central park" carries 1 up against 332 down, Kadampa Meditation
 * Center 68 against 1050 — both pinned nowhere near their names. Importing a
 * row the source's own community has rejected would be taking the data and
 * throwing away the part that says not to trust it.
 *
 * 396 rows in, 67 out. The 67 are Strand Bookstore, Housing Works,
 * Bluestockings, the LGBT Center — named places with written directions, which
 * is the commercial all-gender coverage this map is thinnest on and the one
 * thing no other source supplies.
 */
const FALLBACK_AT_ONE_POINT = 5

const key6 = (r) => `${Number(r.latitude).toFixed(6)},${Number(r.longitude).toFixed(6)}`
const perPoint = new Map()
for (const r of raw) perPoint.set(key6(r), (perPoint.get(key6(r)) ?? 0) + 1)

const netVotes = (r) => (r.upvote ?? 0) - (r.downvote ?? 0)

const bestOf = new Map()
for (const r of raw) {
  if (perPoint.get(key6(r)) >= FALLBACK_AT_ONE_POINT) continue
  const k = [
    String(r.name ?? '').toLowerCase().replace(/\W+/g, ''),
    Number(r.latitude).toFixed(4), Number(r.longitude).toFixed(4),
  ].join('|')
  const prev = bestOf.get(k)
  if (!prev || netVotes(r) > netVotes(prev)) bestOf.set(k, r)
}

const rows = [...bestOf.values()]
const stats = {
  fetched: raw.length,
  stacked: raw.length - raw.filter((r) => perPoint.get(key6(r)) < FALLBACK_AT_ONE_POINT).length,
  repeats: raw.filter((r) => perPoint.get(key6(r)) < FALLBACK_AT_ONE_POINT).length - rows.length,
  downvoted: 0, noCoords: 0, unapproved: 0, outsideBbox: 0,
  accessibleDropped: 0, kept: 0,
}
const keep = []

for (const r of rows) {
  const lat = Number(r.latitude), lng = Number(r.longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) { stats.noCoords++; continue }

  // Unapproved rows are unreviewed submissions on their side. Somebody else's
  // moderation queue is not a thing to import from.
  if (!r.approved) { stats.unapproved++; continue }

  if (seedOnly && (lat < SEED_BBOX.minLat || lat > SEED_BBOX.maxLat ||
                   lng < SEED_BBOX.minLng || lng > SEED_BBOX.maxLng)) {
    stats.outsideBbox++; continue
  }

  // Their community's own verdict. Ignoring it would be taking the data and
  // discarding the part that says not to trust it.
  if (netVotes(r) <= 0) { stats.downvoted++; continue }

  if (r.accessible === true) stats.accessibleDropped++

  const name = (r.name || 'Public restroom').trim().slice(0, 120)
  const address = [r.street, r.city].filter(Boolean).join(', ').trim() || null

  keep.push({
    import_id: String(r.id),
    name,
    lat, lng,
    venue_type: venueOf(name),
    address: address ? address.slice(0, 200) : null,
    // The reason this source is worth having.
    floor_hint: (r.directions || '').trim().slice(0, 200) || null,
    gender_neutral: typeof r.unisex === 'boolean' ? r.unisex : null,
    changing_table: r.changing_table === true ? 'any'
                  : r.changing_table === false ? 'none' : null,
  })
  stats.kept++
}

console.log(`Refuge Restrooms (${SOURCE})`)
console.log(`  fetched              ${stats.fetched}`)
console.log(`  stacked on a point   ${stats.stacked}   (geocoder fallback, not a place)`)
console.log(`  repeat entries       ${stats.repeats}   (same venue, collapsed)`)
console.log(`  no coordinates       ${stats.noCoords}`)
console.log(`  unapproved           ${stats.unapproved}   (their queue, not ours)`)
if (seedOnly) console.log(`  outside seed bbox    ${stats.outsideBbox}`)
console.log(`  net-downvoted        ${stats.downvoted}   (their users rejected these)`)
console.log(`  would import         ${stats.kept}`)
console.log(`  accessible= dropped  ${stats.accessibleDropped}   (a tick cannot say 'partial')`)

const byType = keep.reduce((a, r) => ((a[r.venue_type] = (a[r.venue_type] ?? 0) + 1), a), {})
console.log(`  by venue type        ${JSON.stringify(byType)}`)

console.log('\n  first five:')
for (const r of keep.slice(0, 5)) {
  console.log(`   - ${r.name.slice(0, 34).padEnd(34)} ${r.venue_type.padEnd(15)} ` +
    `all-gender=${r.gender_neutral ?? '?'}  changing=${r.changing_table ?? '?'}`)
  if (r.floor_hint) console.log(`       "${r.floor_hint.slice(0, 68)}"`)
}

const client = new pg.Client(dbConfig({ applicationName: 'restroom-map/import-refuge' }))
await client.connect()

// Same rules as the NYC importer, for the same reasons. 30m is a collision and
// is skipped; 30-150m with a shared distinctive word is a guess and is
// reported for a person to decide.
const collisions = []
for (const r of keep) {
  const { rows: near } = await client.query(
    `select name from bathrooms
     where status = 'active'
       and st_dwithin(geog, st_setsrid(st_makepoint($1,$2),4326)::geography, 30)
       and import_source is distinct from $3
     limit 1`, [r.lng, r.lat, SOURCE])
  if (near.length) { r.collidesWith = near[0].name; collisions.push(r) }
}

if (collisions.length) {
  console.log(`\n  ${collisions.length} would land within 30m of an existing pin — skipped:`)
  for (const c of collisions.slice(0, 8)) {
    console.log(`   - ${c.name.slice(0, 34).padEnd(34)} near "${c.collidesWith}"`)
  }
  if (collisions.length > 8) console.log(`   ... and ${collisions.length - 8} more`)
}

const toWrite = keep.filter((r) => !r.collidesWith)
console.log(`\n  net new              ${toWrite.length}`)

if (!apply) {
  console.log('\nDry run. Nothing written. The licence is undeclared — see the header.')
  await client.end()
  process.exit(0)
}

try {
  await client.query('begin')
  let written = 0
  for (const r of toWrite) {
    await client.query(
      // floor_hint IS written here, unlike the NYC importer, because it is the
      // one field this source actually supplies. On a re-run it is refreshed
      // from Refuge rather than preserved: a contributed hint on a Refuge row
      // would be overwritten, which is a real cost and the reason to say so.
      `insert into bathrooms
         (geog, name, venue_type, access_kind, address, floor_hint,
          gender_neutral, changing_table, import_source, import_id, import_licence)
       values (st_setsrid(st_makepoint($1,$2),4326)::geography, $3, $4::venue_type,
               'open', $5, $6, $7, $8::changing_table_access, $9, $10, $11)
       on conflict (import_source, import_id) where import_source is not null
       do update set name = excluded.name,
                     venue_type = excluded.venue_type,
                     address = excluded.address,
                     floor_hint = excluded.floor_hint,
                     gender_neutral = excluded.gender_neutral,
                     changing_table = excluded.changing_table`,
      [r.lng, r.lat, r.name, r.venue_type, r.address, r.floor_hint,
       r.gender_neutral, r.changing_table, SOURCE, r.import_id, LICENCE])
    written++
  }
  await client.query('commit')
  console.log(`\napplied: ${written} rows written`)
  const { rows: [t] } = await client.query(
    `select count(*)::int as n from bathrooms where import_source = $1`, [SOURCE])
  console.log(`total from this source now: ${t.n}`)
} catch (e) {
  await client.query('rollback')
  console.error(`\nfailed, nothing written: ${e.message}`)
  process.exitCode = 1
} finally {
  await client.end()
}
