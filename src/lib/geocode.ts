import { GEOCODER_URL } from './config'

export interface Place {
  name: string
  context: string
  lat: number
  lng: number
}

interface PhotonFeature {
  geometry: { coordinates: [number, number] }
  properties: Record<string, string | undefined>
}

/** Photon returns GeoJSON; build a readable two-line label from its fields. */
export async function geocode(
  query: string,
  near: [number, number] | null,
  signal: AbortSignal,
): Promise<Place[]> {
  if (query.trim().length < 3) return []

  const url = new URL(GEOCODER_URL)
  url.searchParams.set('q', query)
  url.searchParams.set('limit', '6')
  if (near) {
    url.searchParams.set('lon', String(near[0]))
    url.searchParams.set('lat', String(near[1]))
  }

  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`Search is unavailable (${res.status})`)

  const body = (await res.json()) as { features?: PhotonFeature[] }
  return (body.features ?? []).map((f) => {
    const p = f.properties
    const context = [p.street, p.city ?? p.district, p.state, p.country]
      .filter(Boolean)
      .join(', ')
    return {
      name: p.name || p.street || p.city || 'Unnamed place',
      context,
      lng: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
    }
  })
}

/**
 * A geocoder result as a line somebody would write on an envelope.
 *
 * Two repeats to clear, both of which Photon produces for ordinary addresses:
 *
 *   the street, twice — `name` is the most specific thing it found, which for
 *   a street address is the house number on the street that `context` then
 *   opens with: "180 Maiden Lane" + "Maiden Lane, ...".
 *
 *   the city and the state, when they are the same place. New York, New York.
 *
 * The street test only looks at the first part, which is the only one that can
 * be the street. Testing them all would eat the city out of "New York Public
 * Library, Fifth Avenue, New York".
 */
export function placeLabel({ name, context }: Place): string {
  const parts = context ? context.split(', ') : []
  if (parts[0] && name.toLowerCase().includes(parts[0].toLowerCase())) parts.shift()
  const deduped = parts.filter((part, i) => part !== parts[i - 1])
  return [name, ...deduped].filter(Boolean).join(', ').slice(0, 200)
}
