const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

export function relativeDays(iso: string | null): string | null {
  if (!iso) return null
  const days = Math.round((Date.parse(iso) - Date.now()) / 86_400_000)
  if (days > -1) return rtf.format(0, 'day')
  if (days > -30) return rtf.format(days, 'day')
  return rtf.format(Math.round(days / 30), 'month')
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * The sentence that makes a rotating-code database usable instead of harmful.
 * Freshness first, because a stale confirmation is worth less than a new one.
 */
export function confidenceLine(
  confirms: number,
  troubles: number,
  lastConfirmed: string | null,
): { text: string; tone: 'good' | 'warn' | 'unknown' } {
  if (confirms === 0 && troubles === 0) {
    return { text: 'Nobody has confirmed this one yet.', tone: 'unknown' }
  }

  const troubleNote = `${plural(troubles, 'report')} of trouble.`

  // Nothing to be confident about yet, but somebody has complained.
  if (confirms === 0) {
    return { text: `Nobody has confirmed this yet. ${troubleNote}`, tone: 'warn' }
  }

  if (troubles >= 2 && troubles > confirms) {
    return {
      text: `${plural(troubles, 'recent report')} say this is gone or the code has changed.`,
      tone: 'warn',
    }
  }

  const when = relativeDays(lastConfirmed)
  const who = plural(confirms, 'person').replace('persons', 'people')
  const base = when
    ? `Confirmed working ${when} by ${who}.`
    : `Confirmed by ${who}.`

  return {
    text: troubles > 0 ? `${base} ${troubleNote}` : base,
    tone: troubles > 0 ? 'warn' : 'good',
  }
}

/** Metres between two [lng, lat] pairs. Haversine; good enough under a few km. */
export function metresBetween(a: [number, number], b: [number, number]): number {
  const R = 6_371_000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b[1] - a[1])
  const dLng = toRad(b[0] - a[0])
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** Walking distances, rounded the way a person would say them. */
export function describeDistance(metres: number): string {
  if (metres < 100) return `${Math.round(metres / 10) * 10} m away`
  if (metres < 1000) return `${Math.round(metres / 50) * 50} m away`
  return `${(metres / 1000).toFixed(metres < 10_000 ? 1 : 0)} km away`
}
