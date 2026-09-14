import type { Bathroom } from './types'

/**
 * The places this browser has already been shown, kept so the map is not empty
 * the one time it matters most.
 *
 * This is a bathroom finder. It gets opened in basements, on platforms, inside
 * buildings with one bar — the situations where you most need it are exactly
 * the ones where a live query does not come back. The service worker already
 * keeps the bundle and the map tiles, so the app loads and the streets draw;
 * the pins were the one thing that needed the network, which meant the failure
 * mode was a working map of nothing.
 *
 * Deliberately not the service worker's job. Those rows arrive from a POST,
 * which the Cache API will not store, and caching them there would also hide
 * staleness from the code that has to tell the reader about it.
 */
const KEY = 'restroom-map/last-seen/v1'

/**
 * Enough for a good walk around a dense city, small enough that the write stays
 * cheap and localStorage stays well inside its quota. At roughly 200 bytes a
 * row this is about 120KB at worst.
 */
const LIMIT = 600

interface Stored {
  at: number
  rows: Bathroom[]
}

/**
 * Nothing here expires on a timer. A restroom that existed last week almost
 * certainly still exists, and a stale pin you can walk to beats no pin at all —
 * the reader is told the data is old and can judge it. What matters is that
 * this never silently replaces fresh data, which is the caller's job.
 */
export function remember(rows: Bathroom[]): void {
  if (rows.length === 0) return
  try {
    const merged = new Map<string, Bathroom>()
    for (const b of read()) merged.set(b.id, b)
    // Newest wins: a row just fetched has the better confirm counts.
    for (const b of rows) merged.set(b.id, b)

    const kept = [...merged.values()].slice(-LIMIT)
    localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), rows: kept } satisfies Stored))
  } catch {
    // A full or blocked store costs the offline fallback, nothing else.
  }
}

export function read(): Bathroom[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    return (JSON.parse(raw) as Stored).rows ?? []
  } catch {
    // Private windows throw on access, and a half-written value throws on
    // parse. Either way there is simply no fallback available.
    return []
  }
}

/** When the kept rows were last refreshed, or null if there are none. */
export function rememberedAt(): number | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? ((JSON.parse(raw) as Stored).at ?? null) : null
  } catch {
    return null
  }
}
