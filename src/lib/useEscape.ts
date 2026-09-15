import { useEffect } from 'react'

/**
 * Escape closes it.
 *
 * Pulled out when the second thing needed it. The detail sheet went months
 * without one, for the reason these are usually missing: at a desk you reach
 * for the key without thinking, and the person who could not get out of the
 * sheet was on a phone, where the key does not exist and the only way back
 * was a 30px ring in a corner. Anything that covers the screen gets both —
 * this, and something to tap away from.
 */
export function useEscape(onEscape: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onEscape() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onEscape])
}
