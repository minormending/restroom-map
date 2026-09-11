export const VENUE_TYPES = [
  'store', 'restaurant', 'cafe', 'gas_station', 'park',
  'transit', 'public_facility', 'library', 'hotel', 'other',
] as const
export type VenueType = (typeof VENUE_TYPES)[number]

export const ACCESS_KINDS = [
  'open', 'code_required', 'ask_staff', 'customers_only',
] as const
export type AccessKind = (typeof ACCESS_KINDS)[number]

/** The fill channel of the marker. `unverified` is derived, not stored. */
export type Fill = AccessKind | 'unverified'

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
  wheelchair?: boolean | null
  changing_table?: boolean | null
  gender_neutral?: boolean | null
  code?: string | null
}

export interface Filters {
  venues: Set<VenueType>
  access: Set<AccessKind>
  hideTroubled: boolean
}

export interface Bounds {
  minLng: number
  minLat: number
  maxLng: number
  maxLat: number
}

/**
 * A bathroom nobody has confirmed reads grey and dashed regardless of how it
 * gets in. Confirmed ones take the colour of their access kind.
 */
export function fillFor(b: Bathroom): Fill {
  return b.confirms === 0 ? 'unverified' : b.access_kind
}

export function isTroubled(b: Bathroom): boolean {
  return b.troubles >= 2 && b.troubles > b.confirms
}
