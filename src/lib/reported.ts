import type { ReportKind } from './types'

/**
 * Remembers what this browser has already reported, so the UI stops inviting a
 * tap the server would only reject. The server is the actual authority — this
 * is courtesy, not enforcement, and it is fine for it to be missing or wrong.
 */
const KEY = 'restroom-map/reported/v1'
const DAY = 86_400_000

type Store = Record<string, { kind: ReportKind; at: number }>

function read(): Store {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Store
    const now = Date.now()
    return Object.fromEntries(
      Object.entries(parsed).filter(([, v]) => now - v.at < DAY),
    )
  } catch {
    // Private windows and blocked site data throw on access, not just on read.
    return {}
  }
}

export function reportedKind(bathroomId: string): ReportKind | null {
  return read()[bathroomId]?.kind ?? null
}

export function rememberReport(bathroomId: string, kind: ReportKind): void {
  try {
    const store = read()
    store[bathroomId] = { kind, at: Date.now() }
    localStorage.setItem(KEY, JSON.stringify(store))
  } catch {
    // Nothing to do — the server still enforces the real limit.
  }
}
