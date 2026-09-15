#!/usr/bin/env node
/**
 * NYC Parks' own restroom data, which is three datasets rather than one.
 *
 *   node scripts/import-parks.mjs           dry run
 *   node scripts/import-parks.mjs --apply   actually write
 *
 * WHY THIS AND NOT nycgovparks.org/facilities/restrooms
 * -----------------------------------------------------
 * That page is the public face of this data and sits behind bot protection
 * that returns 403 to anything scripted. These are the same facilities,
 * published by the same agency, through the front door.
 *
 * WHY THREE DATASETS
 * ------------------
 * Parks splits what one restroom is across three tables, and any one alone is
 * useless here:
 *
 *   n8q6-i44s  NYC Parks Structures — every comfort station as a building
 *              footprint. Has WHERE, has no operational status at all.
 *   9byw-znpj  Parks Inspection Program, Public Restrooms — which stations are
 *              shut for repairs and which close for the winter. Has STATUS,
 *              has no coordinates: only prop_id and cs_id.
 *   buk3-3qpr  Parks Inspection Program, All Sites (MAPPED) — the park
 *              property polygons that turn a prop_id into somewhere on a map.
 *
 * So: structures give locations, the inspection list gives status, and the
 * property polygons join them to what this map already shows.
 *
 * WHAT THIS ACTUALLY CHANGES, AND WHY IT IS MOSTLY NOT "ADD PINS"
 * ---------------------------------------------------------------
 * The park restrooms are already here — 750-odd of them, imported from NYC
 * Open Data's Public Restrooms list (i7jb-7jku), which is the same agency's
 * same facilities. Nearly every structure in this dataset already has a pin
 * within 30m. Re-importing the locations would be a no-op with a duplicate
 * risk attached.
 *
 * The part that is missing is that i7jb-7jku was last refreshed in November
 * 2025 and the inspection list is refreshed weekly. Right now this map shows
 * dozens of park restrooms as open that NYC Parks records as closed for
 * repairs — the exact wasted trip the whole project exists to prevent. That
 * is what is worth importing.
 *
 * LICENCE, READ BEFORE --apply
 * ----------------------------
 * All three declare no licence, same as i7jb-7jku: no `license` field in the
 * Socrata metadata, and NYC's terms of use only disclaim warranty. Ambiguity,
 * not permission. Every row written records where it came from.
 */
import { withClient } from './lib/connect.mjs'

const STRUCTURES = 'n8q6-i44s'
const INSPECTIONS = '9byw-znpj'
const SITES = 'buk3-3qpr'
const CITY_LIST = 'i7jb-7jku'
const SOURCE = `nyc-open-data:${STRUCTURES}`
const LICENCE = 'undeclared (NYC Open Data, no license field in metadata)'

/** How the hidden_reason is stamped, so a later run can find its own work. */
const HIDDEN_PREFIX = 'nyc-parks:'

/**
 * How close a structure has to be to an existing pin to count as already
 * mapped. Generous on purpose: i7jb-7jku positions a restroom by an eyeballed
 * point and this dataset by a building footprint, so the same facility lands
 * tens of metres apart routinely. Everything past this is reported, not
 * skipped silently, because at that distance a person has to decide.
 */
const COVERED_M = 100

const apply = process.argv.includes('--apply')

const get = async (id, query) => {
  const url = `https://data.cityofnewyork.us/resource/${id}.json?${query}`
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${id} returned ${r.status}`)
  return r.json()
}

// ---------------------------------------------------------------------------
// Geometry. Small enough to do here; loading 700 polygons into Postgres to ask
// one question of them would be the larger moving part.
// ---------------------------------------------------------------------------
function centroid(mp) {
  const pts = []
  for (const poly of mp.coordinates) for (const p of poly[0]) pts.push(p)
  return [pts.reduce((s, p) => s + p[0], 0) / pts.length,
          pts.reduce((s, p) => s + p[1], 0) / pts.length]
}

function inRing([x, y], ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Rings after the first are holes — a park with a lake in it still has edges. */
const inMulti = (pt, mp) => mp.coordinates.some(
  (poly) => inRing(pt, poly[0]) && !poly.slice(1).some((hole) => inRing(pt, hole)))

function bbox(mp) {
  let minX = 180, minY = 90, maxX = -180, maxY = -90
  for (const poly of mp.coordinates) for (const [x, y] of poly[0]) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  return [minX, minY, maxX, maxY]
}

/**
 * Tidy the city's hyphen without inventing a name. "Central Park-The Ramble
 * Shed" is a park and a facility jammed together; everything else is left
 * exactly as Parks wrote it, because a name somebody can match against a sign
 * beats a name that reads nicely.
 */
const tidy = (s) => String(s ?? 'Park restroom').trim()
  .replace(/(\w)-(\w)/g, '$1 – $2').slice(0, 120)

/** Metres between two [lng, lat] pairs. Haversine; fine at city scale. */
function metres(a, b) {
  const R = 6_371_000, rad = (d) => (d * Math.PI) / 180
  const dLat = rad(b[1] - a[1]), dLng = rad(b[0] - a[0])
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

console.log('NYC Parks — comfort stations, and which of them are shut\n')

const [structures, inspections, sites, city] = await Promise.all([
  get(STRUCTURES, '$where=public_restroom=true&$limit=2000'),
  get(INSPECTIONS, '$limit=3000'),
  get(SITES, "$where=publicrestroom='Yes'&$limit=2000&" +
    '$select=prop_id,prop_name,multipolygon'),
  get(CITY_LIST, '$limit=5000'),
])

/**
 * The city's restroom list, consulted by position rather than by key.
 *
 * i7jb-7jku carries no prop_id, no cs_id and no structure id — nothing this
 * dataset also holds — so proximity is the only join there is. 120m, because
 * the two place the same building by different methods: one an eyeballed
 * point, the other a surveyed footprint.
 */
const listed = city.filter((r) => Number.isFinite(Number(r.latitude)))
const cityListing = (lng, lat) => {
  let best = null
  for (const r of listed) {
    const d = metres([lng, lat], [Number(r.longitude), Number(r.latitude)])
    if (!best || d < best.d) best = { d, r }
  }
  return best && best.d < 120 ? { ...best.r, m: Math.round(best.d) } : null
}

const active = structures.filter((s) => s.featurestatus === 'Active')
console.log(`  structures flagged public restroom  ${structures.length}` +
  `  (${active.length} active, ${structures.length - active.length} inactive/removed)`)
console.log(`  inspection records                  ${inspections.length}`)
console.log(`  park properties with a restroom     ${sites.length}`)

// ---------------------------------------------------------------------------
// Status, per park property.
//
// The inspection list keys on cs_id — an individual comfort station — but
// nothing published maps a cs_id to a point. prop_id is as fine as the join
// gets, so a park with two stations where one is closed is genuinely
// ambiguous, and this script says so rather than guessing which pin is which.
// ---------------------------------------------------------------------------
const status = new Map()
for (const r of inspections) {
  const s = status.get(r.prop_id) ?? { stations: 0, closed: [], winter: [] }
  s.stations++
  if (r.long_term_closure === 'Yes') s.closed.push(r.reason_closed ?? 'closed')
  if (r.winterized === 'Yes') s.winter.push(r.reason_winterized ?? 'no heat')
  status.set(r.prop_id, s)
}

const boxed = sites.map((s) => ({ ...s, box: bbox(s.multipolygon) }))
const propertyAt = (pt) => boxed.find((s) =>
  pt[0] >= s.box[0] && pt[0] <= s.box[2] && pt[1] >= s.box[1] && pt[1] <= s.box[3] &&
  inMulti(pt, s.multipolygon))

await withClient(async (client) => {
  // -------------------------------------------------------------------------
  // 1. Locations this map does not have.
  // -------------------------------------------------------------------------
  const add = [], notOperational = [], nearMiss = [], closedAlready = []

  for (const s of active) {
    const [lng, lat] = centroid(s.multipolygon)
    const { rows: near } = await client.query(
      `select name, status,
              round(st_distance(geog, st_setsrid(st_makepoint($1,$2),4326)::geography)::numeric, 0) as m
       from bathrooms
       order by geog <-> st_setsrid(st_makepoint($1,$2),4326)::geography limit 1`,
      [lng, lat])
    if (near.length && Number(near[0].m) < COVERED_M) continue

    // The city's own restroom list is the authority on whether a comfort
    // station is open, and it lists most of these as Not Operational. They are
    // absent from the map because a previous import deliberately left them
    // out; putting them back from a dataset that carries no status at all
    // would undo that on purpose.
    const known = cityListing(lng, lat)
    if (known && known.status !== 'Operational') {
      notOperational.push({ s, known }); continue
    }
    if (known) { nearMiss.push({ s, known, m: near[0]?.m }); continue }

    // Which park this stands in — asked three ways, because no one of them
    // answers for all 715.
    //
    // By position: only works where Parks publishes a polygon, and it
    // publishes them per site, so Central Park's structures fall outside every
    // one of them. By zone id (M010-ZN41) or property id (M010): works where
    // the spellings agree, and they drift between datasets — "M010-ZN18&19"
    // against "M010-ZN18+19", "M010_temp3".
    //
    // Any of the three saying "closed" is enough to skip. A miss here does not
    // read as "unknown", it reads as "Parks says nothing is wrong", and the
    // cost of getting that backwards is a pin on a restroom shut for repairs.
    const site = propertyAt([lng, lat])
    const st = [site?.prop_id, s.omppropid, s.gispropnum]
      .map((key) => key && status.get(key))
      .filter(Boolean)
    const shut = st.find((x) => x.closed.length)
    if (shut) { closedAlready.push({ s, why: shut.closed[0] }); continue }

    add.push({
      import_id: s.system,
      name: tidy(s.description),
      lng, lat,
      address: s.location ? String(s.location).slice(0, 200) : null,
      park: site?.prop_name ?? null,
      winter: st.some((x) => x.winter.length),
    })
  }

  console.log(`\n  uncovered by any pin within ${COVERED_M}m          ` +
    `${add.length + notOperational.length + nearMiss.length + closedAlready.length}`)
  console.log(`    city lists them Not Operational   ${notOperational.length}  (skipped)`)
  console.log(`    same place, pin is just off       ${nearMiss.length}  (skipped)`)
  console.log(`    Parks says long-term closed       ${closedAlready.length}  (skipped)`)
  console.log(`    would add                         ${add.length}`)
  for (const a of add) {
    console.log(`     + ${a.name.slice(0, 46).padEnd(46)} ${(a.park ?? '?').slice(0, 26).padEnd(26)}` +
      ` ${a.address?.slice(0, 34) ?? ''}` + (a.winter ? '  [closed in winter]' : ''))
  }

  // -------------------------------------------------------------------------
  // 2. Status for pins already on the map.
  // -------------------------------------------------------------------------
  const { rows: pins } = await client.query(
    `select b.id, b.name, b.status, b.hidden_reason,
            coalesce(f.confirms_90d, 0) as confirms,
            f.last_confirmed_at,
            st_x(b.geog::geometry) as lng, st_y(b.geog::geometry) as lat
     from bathrooms b
     left join bathroom_confidence f on f.bathroom_id = b.id
     where b.status in ('active', 'hidden')`)

  const byProp = new Map()
  for (const p of pins) {
    const site = propertyAt([Number(p.lng), Number(p.lat)])
    if (!site) continue
    p.park = site.prop_name
    p.prop = site.prop_id
    const list = byProp.get(site.prop_id) ?? []
    list.push(p)
    byProp.set(site.prop_id, list)
  }

  const hide = [], unhide = [], winterize = [], ambiguous = [], disputed = []

  // Only pins in a park Parks actually inspects are in scope below. A park
  // with no inspection record is not a park known to stay open all winter —
  // it is a park nobody told us about, and writing `false` there would turn
  // an absence of information into a claim.
  const scoped = []

  for (const [prop, group] of byProp) {
    const st = status.get(prop)
    const mine = group.filter((p) => p.status === 'active')
    const hiddenByUs = group.filter((p) =>
      p.status === 'hidden' && p.hidden_reason?.startsWith(HIDDEN_PREFIX))

    // Repairs end. Anything this importer hid, this importer un-hides once
    // Parks stops saying it is closed — otherwise the first run quietly
    // becomes permanent.
    const stillClosed = Boolean(st?.closed.length)
    if (!stillClosed) for (const p of hiddenByUs) unhide.push(p)
    if (!st) continue
    scoped.push(...group.map((p) => p.id))

    // Every station in the park is shut, and we show no more pins than there
    // are stations: nothing here can be open, so all of them go.
    const allClosed = st.closed.length === st.stations && st.stations > 0
    if (stillClosed) {
      if (allClosed && mine.length <= st.stations) {
        for (const p of mine) {
          // Somebody was standing there. The inspection list is refreshed
          // weekly and a confirmation is a person saying "I used this"; when
          // they disagree the person wins, and a human looks at it. Removing
          // a restroom somebody just confirmed would teach people that
          // confirming does nothing.
          if (p.confirms > 0) disputed.push({ ...p, why: st.closed[0] })
          else hide.push({ ...p, why: st.closed[0] })
        }
      } else {
        for (const p of mine) {
          ambiguous.push({ ...p, why: st.closed[0], stations: st.stations, closed: st.closed.length })
        }
      }
    }

    // Winterised is a fact about the place, not a reason to remove it: it is
    // open right now and shut in January. Same all-or-nothing rule.
    if (st.winter.length === st.stations && st.stations > 0) {
      for (const p of mine) winterize.push(p)
    }
  }

  console.log(`\n  pins inside a park Parks inspects          ${scoped.length}`)
  console.log(`    Parks says closed, unambiguously          ${hide.length}  -> hide`)
  console.log(`    Parks says closed, park has others open   ${ambiguous.length}  -> left alone, listed below`)
  console.log(`    hidden by an earlier run, now reopened    ${unhide.length}  -> show again`)
  console.log(`    closed for the winter                     ${winterize.length}  -> noted on the place`)
  if (disputed.length) {
    console.log(`    closed, but somebody confirmed it lately  ${disputed.length}  -> left alone, decide these yourself`)
    for (const d of disputed) {
      console.log(`     ! ${d.name.slice(0, 40).padEnd(40)} ${d.confirms} confirmed, last ` +
        `${String(d.last_confirmed_at ?? '').slice(0, 10)}, Parks says ${d.why}`)
    }
  }

  console.log('\n  showing as open, NYC Parks says closed:')
  for (const h of hide) {
    console.log(`     - ${h.name.slice(0, 40).padEnd(40)} ${h.prop.padEnd(10)} ${h.why}`)
  }
  if (ambiguous.length) {
    console.log('\n  closed somewhere in this park, but not knowably this pin:')
    for (const a of ambiguous) {
      console.log(`     ? ${a.name.slice(0, 40).padEnd(40)} ${a.prop.padEnd(10)} ` +
        `${a.closed}/${a.stations} stations ${a.why}`)
    }
  }

  if (!apply) {
    console.log('\nDry run. Nothing written. Re-run with --apply.')
    return
  }

  await client.query('begin')
  try {
    let added = 0
    for (const a of add) {
      const { rowCount } = await client.query(
        `insert into bathrooms
           (geog, name, venue_type, access_kind, address, operator, hours,
            closed_in_winter, import_source, import_id, import_licence)
         values (st_setsrid(st_makepoint($1,$2),4326)::geography, $3, 'park', 'open',
                 $4, 'NYC Parks', 'venue', $5, $6, $7, $8)
         on conflict (import_source, import_id) where import_source is not null
         do update set name = excluded.name,
                       address = excluded.address,
                       closed_in_winter = excluded.closed_in_winter`,
        [a.lng, a.lat, a.name, a.address, a.winter, SOURCE, a.import_id, LICENCE])
      added += rowCount
    }

    const reason = (why) => `${HIDDEN_PREFIX} ${why} (${INSPECTIONS})`
    for (const h of hide) {
      await client.query(
        `update bathrooms set status = 'hidden', hidden_reason = $2, hidden_at = now()
         where id = $1 and status = 'active'`, [h.id, reason(h.why)])
    }
    for (const u of unhide) {
      await client.query(
        `update bathrooms set status = 'active', hidden_reason = null, hidden_at = null
         where id = $1 and status = 'hidden'`, [u.id])
    }
    // Set and unset both: a park that gets heating stops being seasonal.
    const winterIds = winterize.map((p) => p.id)
    await client.query(
      `update bathrooms set closed_in_winter = (id = any($1::uuid[]))
       where id = any($2::uuid[])
         and closed_in_winter is distinct from (id = any($1::uuid[]))`,
      [winterIds, scoped])

    await client.query('commit')
    console.log(`\napplied: ${added} added, ${hide.length} hidden, ` +
      `${unhide.length} restored, ${winterize.length} marked seasonal`)
  } catch (e) {
    await client.query('rollback')
    console.error('\nrolled back:', e.message)
    process.exitCode = 1
  }

})
