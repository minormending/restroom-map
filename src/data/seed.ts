import type { Bathroom, AccessKind, VenueType } from '../lib/types'
import rows from './seed.json'

/**
 * Bundled starter data for Lower Manhattan, used when no Supabase project is
 * configured so the map is never empty on first run.
 *
 * The rows live in seed.json so this file and scripts/seed-to-sql.mjs stay in
 * step — edit the JSON, not a copy.
 *
 * HONESTY NOTE — read before trusting any of this:
 *  - Locations are well-known public sites whose restrooms are widely
 *    documented, but NONE have been verified in person. Coordinates are
 *    approximate to the building, not the restroom door.
 *  - No door codes are included. Entries marked `code_required` carry
 *    `has_code: false`, meaning "there is a keypad, nobody has recorded the
 *    code yet". Inventing codes would be worse than having none.
 *  - Amenity flags are null (unknown) rather than guessed. This also exercises
 *    the unknown-state UI, which you'll see a lot of early on.
 *  - `confirms` / `troubles` are synthetic values chosen to exercise the marker
 *    encoding. Delete them the moment real reports exist.
 */

interface SeedRow {
  name: string
  lat: number
  lng: number
  venue_type: string
  access_kind: string
  has_code: boolean
  confirms: number
  troubles: number
  last_confirmed_days?: number
  address: string | null
  floor_hint: string | null
  wheelchair: boolean | null
  changing_table: boolean | null
  gender_neutral: boolean | null
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()

export const SEED_BATHROOMS: Bathroom[] = (rows as SeedRow[]).map((r, i) => {
  const { last_confirmed_days, venue_type, access_kind, ...rest } = r
  return {
    ...rest,
    venue_type: venue_type as VenueType,
    access_kind: access_kind as AccessKind,
    id: `seed-${String(i + 1).padStart(3, '0')}`,
    last_confirmed: last_confirmed_days === undefined ? null : daysAgo(last_confirmed_days),
    code: null,
  }
})
