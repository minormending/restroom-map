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
  wheelchair?: WheelchairAccess | null
  changing_table?: ChangingTableAccess | null
  gender_neutral?: boolean | null
  code?: string | null
  code_locked?: boolean
  code_cost?: number
}

export const REPORT_KINDS = ['works', 'code_bad', 'gone', 'inaccessible', 'dirty'] as const
export type ReportKind = (typeof REPORT_KINDS)[number]

export interface Filters {
  venues: Set<VenueType>
  access: Set<AccessKind>
  hideTroubled: boolean
  needsChanging: boolean
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
