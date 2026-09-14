import { SEED_BATHROOMS } from '../data/seed'
import { supabase } from './supabase'
import type { AccessKind, Bathroom, Bounds, Filters, VenueType } from './types'

function withinBounds(b: Bathroom, v: Bounds): boolean {
  return b.lng >= v.minLng && b.lng <= v.maxLng && b.lat >= v.minLat && b.lat <= v.maxLat
}

function matchesFilters(b: Bathroom, f: Filters): boolean {
  if (f.venues.size && !f.venues.has(b.venue_type)) return false
  if (f.access.size && !f.access.has(b.access_kind)) return false
  // The bundled sample has no amenity data, so these can only ever exclude.
  // A gendered changing table still counts as having one — the sheet says
  // which, and hiding it from everyone helps nobody.
  if (f.needsChanging && (b.changing_table == null || b.changing_table === 'none')) return false
  // Partial is not a match. A partly step-free restroom is exactly the trip
  // somebody in a wheelchair cannot afford to waste.
  if (f.needsStepFree && b.wheelchair !== 'full') return false
  if (f.needsGenderNeutral && b.gender_neutral !== true) return false
  return true
}

/**
 * One indexed bbox query with the filters applied in the same pass. Against
 * seed data the same shape runs in memory, so the calling code is identical.
 */
export async function fetchInView(
  view: Bounds,
  filters: Filters,
  maxResults = 300,
): Promise<Bathroom[]> {
  if (!supabase) {
    return SEED_BATHROOMS
      .filter((b) => withinBounds(b, view) && matchesFilters(b, filters))
      .slice(0, maxResults)
  }

  const { data, error } = await supabase.rpc('bathrooms_in_view', {
    min_lng: view.minLng,
    min_lat: view.minLat,
    max_lng: view.maxLng,
    max_lat: view.maxLat,
    types: filters.venues.size ? ([...filters.venues] as VenueType[]) : null,
    access: filters.access.size ? ([...filters.access] as AccessKind[]) : null,
    max_results: maxResults,
    needs_changing: filters.needsChanging,
    needs_step_free: filters.needsStepFree,
    needs_gender_neutral: filters.needsGenderNeutral,
  })

  if (error) throw new Error(error.message)
  return (data ?? []) as Bathroom[]
}

/** Detail-sheet payload. The code comes from `get_code`, which owns the gate. */
export async function fetchDetail(id: string): Promise<Partial<Bathroom>> {
  if (!supabase) {
    const row = SEED_BATHROOMS.find((b) => b.id === id)
    return row ?? {}
  }

  const [detail, code] = await Promise.all([
    supabase
      .from('bathrooms')
      .select('address, floor_hint, operator, wheelchair, changing_table, gender_neutral')
      .eq('id', id)
      .maybeSingle(),
    supabase.rpc('get_code', { p_bathroom_id: id }),
  ])

  if (detail.error) throw new Error(detail.error.message)

  // A locked code is an expected outcome, not a failure — render the row
  // without it rather than failing the whole sheet.
  type CodeRow = { code: string | null; locked: boolean; cost: number }
  const codeRow = code.error ? null : (code.data as CodeRow[] | null)?.[0]

  return {
    ...(detail.data ?? {}),
    code: codeRow?.code ?? null,
    code_locked: codeRow?.locked ?? false,
    code_cost: codeRow?.cost,
  }
}
