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
