import { SEED_BATHROOMS } from '../data/seed'
import { read as lastSeen, remember } from './lastSeen'
import { supabase } from './supabase'
import type {
  AccessClaim, AccessKind, Bathroom, Bounds, Filters, Need, VenueType,
} from './types'

function withinBounds(b: Bathroom, v: Bounds): boolean {
  return b.lng >= v.minLng && b.lng <= v.maxLng && b.lat >= v.minLat && b.lat <= v.maxLat
}

/**
 * One need, answered for one place. Mirrors the SQL in migration 018 clause
 * for clause — this runs against bundled sample data and against the offline
 * store, and a rule that differs between here and there would show up as pins
 * that appear and disappear depending on the signal.
 *
 * Unknown is never a match. Somebody filtering on a need is saying the journey
 * is wasted without it, and "we don't know" is not a reason to send them.
 */
function meetsNeed(b: Bathroom, need: Need): boolean {
  switch (need) {
    // A gendered changing table still counts as having one. The sheet says
    // which, and hiding it from everybody helps nobody.
    case 'changing': return b.changing_table != null && b.changing_table !== 'none'
    // 'partial' does not satisfy step-free: a partly accessible restroom is
    // exactly the trip a wheelchair user cannot afford to waste.
    case 'step_free': return b.wheelchair === 'full'
    case 'gender_neutral': return b.gender_neutral === true
    case 'adult_changing': return b.adult_changing === 'changing_places' || b.adult_changing === 'bench'
    case 'hoist': return b.adult_changing === 'changing_places'
    case 'grab_bars': return b.grab_bars === true
    case 'turning_space': return b.turning_space === true
    case 'sink_in_stall': return b.sink_in_stall === true
    case 'shelf': return b.shelf === true
    // Known to be unlocked, not merely not known to be locked.
    case 'unlocked': return b.accessible_locked === false
    // Mirrors the SQL: only what can be computed. 'venue' means the café's
    // hours decide and this map does not know them.
    case 'open_now': {
      if (b.hours === 'always') return true
      if (b.hours !== 'daylight') return false
      const h = Number(new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York', hour: 'numeric', hour12: false,
      }).format(new Date()))
      return h >= 7 && h <= 19
    }
  }
}

function matchesFilters(b: Bathroom, f: Filters): boolean {
  if (f.venues.size && !f.venues.has(b.venue_type)) return false
  if (f.access.size && !f.access.has(b.access_kind)) return false
  for (const need of f.needs) if (!meetsNeed(b, need)) return false
  return true
}

export interface InView {
  rows: Bathroom[]
  /** True when these came from the local store because the network did not. */
  stale: boolean
}

/**
 * Whether a failure is the network rather than the server.
 *
 * The distinction decides whether stale pins are a kindness or a cover-up. No
 * signal is the case this cache exists for, and showing what we have with a
 * banner is strictly better than an empty map. A server that answered with an
 * error is a different thing: walking outside will not fix it, and quietly
 * painting old pins over an outage or a bug would hide the one signal anybody
 * has that something is wrong.
 *
 * PostgREST failures arrive with a code; a connection that never completed
 * does not.
 */
function looksLikeNoSignal(error: { code?: string } | null, thrown?: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  if (thrown instanceof TypeError) return true          // fetch could not complete
  return Boolean(error && !error.code)
}

/**
 * One indexed bbox query with the filters applied in the same pass. Against
 * seed data the same shape runs in memory, so the calling code is identical —
 * and so does the offline fallback, which is the reason those two helpers are
 * worth keeping rather than pushing entirely into SQL.
 */
/** The most any one viewport query returns. Exported so the count can say
 *  "300+" rather than presenting a limit as a total. */
export const MAX_IN_VIEW = 300

export async function fetchInView(
  view: Bounds,
  filters: Filters,
  maxResults = MAX_IN_VIEW,
): Promise<InView> {
  if (!supabase) {
    return {
      rows: SEED_BATHROOMS
        .filter((b) => withinBounds(b, view) && matchesFilters(b, filters))
        .slice(0, maxResults),
      stale: false,
    }
  }

  let data: unknown = null
  let error: { code?: string; message: string } | null = null
  let thrown: unknown = null

  try {
    ({ data, error } = await supabase.rpc('bathrooms_in_view', {
      min_lng: view.minLng,
      min_lat: view.minLat,
      max_lng: view.maxLng,
      max_lat: view.maxLat,
      types: filters.venues.size ? ([...filters.venues] as VenueType[]) : null,
      access: filters.access.size ? ([...filters.access] as AccessKind[]) : null,
      max_results: maxResults,
      needs: filters.needs.size ? [...filters.needs] : null,
    }))
  } catch (e) {
    // supabase-js lets a failed fetch through as a thrown TypeError rather
    // than an error object, and that is precisely the offline case.
    thrown = e
  }

  if (error || thrown) {
    // Nothing kept for this viewport is the same as being offline with an
    // empty store: there is nothing better to show, so say what went wrong.
    const kept = looksLikeNoSignal(error, thrown)
      ? lastSeen()
          .filter((b) => withinBounds(b, view) && matchesFilters(b, filters))
          .slice(0, maxResults)
      : []

    if (kept.length > 0) return { rows: kept, stale: true }
    throw new Error(error?.message ?? 'Could not load this area')
  }

  const rows = (data ?? []) as Bathroom[]
  remember(rows)
  return { rows, stale: false }
}

/** Detail-sheet payload. The code comes from `get_code`, which owns the gate. */
export async function fetchDetail(id: string): Promise<Partial<Bathroom>> {
  if (!supabase) {
    const row = SEED_BATHROOMS.find((b) => b.id === id)
    return row ?? {}
  }

  const [detail, code, claims] = await Promise.all([
    supabase
      .from('bathrooms')
      .select('address, floor_hint, operator, wheelchair, changing_table, gender_neutral, adult_changing, grab_bars, turning_space, accessible_locked, sink_in_stall, shelf, hours, closed_in_winter')
      .eq('id', id)
      .maybeSingle(),
    supabase.rpc('get_code', { p_bathroom_id: id }),
    // What people have claimed and nobody has corroborated. A reader needs to
    // be able to tell one account from a settled fact.
    supabase
      .from('access_claim_state')
      .select('field, value, claims, disputed')
      .eq('bathroom_id', id),
  ])

  if (detail.error) throw new Error(detail.error.message)

  // A locked code is an expected outcome, not a failure — render the row
  // without it rather than failing the whole sheet.
  type CodeRow = { code: string | null; locked: boolean; cost: number }
  const codeRow = code.error ? null : (code.data as CodeRow[] | null)?.[0]

  return {
    ...(detail.data ?? {}),
    claims: (claims.error ? [] : claims.data ?? []) as AccessClaim[],
    code: codeRow?.code ?? null,
    code_locked: codeRow?.locked ?? false,
    code_cost: codeRow?.cost,
  }
}
