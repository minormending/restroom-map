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
    text: troubles > 0 ? `${base} ${plural(troubles, 'report')} of trouble.` : base,
    tone: troubles > 0 ? 'warn' : 'good',
  }
}
