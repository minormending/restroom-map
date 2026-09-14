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

/**
 * Prompts waved away. Separate from reports on purpose: "not now" is not an
 * answer about the place, it is an answer about being asked, and it should
 * expire far sooner than a report does.
 */
const DISMISSED_KEY = 'restroom-map/not-now/v1'
const DISMISSED_TTL = 6 * 3_600_000

function readDismissed(): Record<string, number> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, number>
    const now = Date.now()
    return Object.fromEntries(
      Object.entries(parsed).filter(([, at]) => now - at < DISMISSED_TTL),
    )
  } catch {
    return {}
  }
}

export function wasDismissed(bathroomId: string): boolean {
  return bathroomId in readDismissed()
}

export function dismissNearby(bathroomId: string): void {
  try {
    const store = readDismissed()
    store[bathroomId] = Date.now()
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(store))
  } catch {
    // A prompt that reappears is a smaller problem than a crash here.
  }
}
