import { metresBetween } from './format'
import { reportedKind, wasDismissed } from './reported'
import type { Bathroom } from './types'

/**
 * Deciding that somebody is standing at a particular place, well enough to
 * interrupt them about it.
 *
 * Both numbers below are deliberately tighter than anything else in the app.
 * ACCURACY_LIMIT_M is 5km, which is the right question for "can we centre a
 * walking map on this" and the wrong one entirely for "which building is this
 * person in". The server's geo_verified radius is 150m, which is right for
 * "were you plausibly there" after the fact and far too loose to name a place
 * unprompted: in Lower Manhattan a 150m circle holds several of these.
 */

/** Close enough to call it "you are here" rather than "this is near you". */
export const STANDING_AT_M = 60

/**
 * A fix vaguer than this cannot distinguish one building from its neighbours,
 * and a prompt naming the wrong place is worse than no prompt: it asks for a
 * confirmation the person is not in a position to give, and the whole value of
 * a confirmation is that somebody was actually there.
 */
export const STANDING_ACCURACY_M = 40

export interface Fix {
  at: [number, number]
  accuracy: number
}

/**
 * The place you appear to be standing at, or null. Skips anything this browser
 * has already answered for today, and anything waved away recently — being
 * asked twice about the same door is how a helpful prompt becomes a nuisance.
 */
export function placeYouAreAt(fix: Fix | null, bathrooms: Bathroom[]): Bathroom | null {
  if (!fix || fix.accuracy > STANDING_ACCURACY_M) return null

  let best: Bathroom | null = null
  let bestMetres = STANDING_AT_M

  for (const b of bathrooms) {
    if (reportedKind(b.id) || wasDismissed(b.id)) continue
    const metres = metresBetween(fix.at, [b.lng, b.lat])
    if (metres <= bestMetres) {
      best = b
      bestMetres = metres
    }
  }

  return best
}
