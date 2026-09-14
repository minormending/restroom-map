export const VENUE_TYPES = [
  'store', 'restaurant', 'cafe', 'gas_station', 'park',
  'transit', 'public_facility', 'library', 'hotel', 'other',
] as const
export type VenueType = (typeof VENUE_TYPES)[number]

export const ACCESS_KINDS = [
  'open', 'code_required', 'ask_staff', 'customers_only',
] as const
export type AccessKind = (typeof ACCESS_KINDS)[number]

export const VENUE_LABELS: Record<VenueType, string> = {
  store: 'Store',
  restaurant: 'Restaurant',
  cafe: 'Café',
  gas_station: 'Gas station',
  park: 'Park',
  transit: 'Transit',
  public_facility: 'Public facility',
  library: 'Library',
  hotel: 'Hotel',
  other: 'Other',
}

/**
 * Neither of these is a yes/no question, which is why migration 016 widened
 * the columns. "Partially accessible" and "there is a changing table but only
 * in the women's room" are real answers, and rounding them to true or false
 * is how somebody ends up standing outside a door they cannot use.
 */
export const WHEELCHAIR_ACCESS = ['full', 'partial', 'none'] as const
export type WheelchairAccess = (typeof WHEELCHAIR_ACCESS)[number]

export const CHANGING_TABLE_ACCESS = ['any', 'women_only', 'men_only', 'none'] as const
export type ChangingTableAccess = (typeof CHANGING_TABLE_ACCESS)[number]

export const HOURS_KIND = ['always', 'daylight', 'venue'] as const
export type HoursKind = (typeof HOURS_KIND)[number]

export const ADULT_CHANGING = ['changing_places', 'bench', 'none'] as const
export type AdultChanging = (typeof ADULT_CHANGING)[number]

/**
 * The things somebody filters on when the trip is wasted without them.
 *
 * Kept as one list rather than a field per need: the viewport function takes
 * them as an array for the same reason, and a need that exists in one place
 * and not the other is a filter that silently does nothing.
 */
export const NEEDS = [
  'step_free', 'turning_space', 'grab_bars', 'unlocked',
  'changing', 'adult_changing', 'hoist',
  'sink_in_stall', 'shelf', 'gender_neutral',
  'open_now',
] as const
export type Need = (typeof NEEDS)[number]

export const NEED_LABELS: Record<Need, string> = {
  step_free: 'Step-free',
  turning_space: 'Room to turn',
  grab_bars: 'Grab bars',
  unlocked: 'Not locked',
  changing: 'Changing table',
  adult_changing: 'Adult changing',
  hoist: 'Hoist',
  sink_in_stall: 'Sink in the cubicle',
  shelf: 'Shelf',
  gender_neutral: 'All-gender',
  open_now: 'Open now',
}

export const ACCESS_LABELS: Record<AccessKind, string> = {
  open: 'Open — no code',
  code_required: 'Code required',
  ask_staff: 'Ask staff for the key',
  customers_only: 'Customers only',
}

/** One row as returned by the `bathrooms_in_view` RPC. Note: no code. */
export interface Bathroom {
  id: string
  lat: number
  lng: number
  name: string
  venue_type: VenueType
  access_kind: AccessKind
  has_code: boolean
  confirms: number
  troubles: number
  last_confirmed: string | null
  // Detail-only fields, absent from the viewport payload.
  address?: string | null
  floor_hint?: string | null
  /** Who runs the place. Provenance, not a location hint — see migration 017. */
  operator?: string | null
  wheelchair?: WheelchairAccess | null
  changing_table?: ChangingTableAccess | null
  gender_neutral?: boolean | null
  adult_changing?: AdultChanging | null
  hours?: HoursKind | null
  grab_bars?: boolean | null
  turning_space?: boolean | null
  accessible_locked?: boolean | null
  sink_in_stall?: boolean | null
  shelf?: boolean | null
  code?: string | null
  code_locked?: boolean
  code_cost?: number
  /** What people have said but nobody has corroborated yet. Detail-only. */
  claims?: AccessClaim[]
}

export const REPORT_KINDS = ['works', 'code_bad', 'gone', 'inaccessible', 'dirty'] as const
export type ReportKind = (typeof REPORT_KINDS)[number]

export interface Filters {
  venues: Set<VenueType>
  access: Set<AccessKind>
  hideTroubled: boolean
  needs: Set<Need>
}

/**
 * One unsettled answer. `claims` is how many people have said this exact
 * thing; `disputed` means somebody has said something else about the same
 * field. Settled fields never appear here — they are on the row itself.
 */
export interface AccessClaim {
  field: string
  value: string
  claims: number
  disputed: boolean
}

export interface Bounds {
  minLng: number
  minLat: number
  maxLng: number
  maxLat: number
}

/**
 * Whether anybody has confirmed this place.
 *
 * This used to pick the marker colour: unconfirmed meant grey, whatever the
 * access kind was. That overwrote one channel with another, and it did it
 * most completely when the map was new — every row imported from NYC Open
 * Data arrives with no confirmations, so the whole map read grey and the
 * access legend described colours that appeared nowhere.
 *
 * Confirmation is now a treatment rather than a hue: access kind always sets
 * the colour, and this decides whether the pin is filled or hollow. Both
 * channels survive, and a place lights up when someone confirms it.
 */
export function isConfirmed(b: Bathroom): boolean {
  return b.confirms > 0
}

export function isTroubled(b: Bathroom): boolean {
  return b.troubles >= 2 && b.troubles > b.confirms
}
