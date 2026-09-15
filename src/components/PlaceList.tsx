import { ACCESS_FIELDS, describe, settledValue } from '../lib/access'
import { describeDistance, metresBetween, placesInView } from '../lib/format'
import { ACCESS_LABELS, VENUE_LABELS, type Bathroom } from '../lib/types'

interface Props {
  bathrooms: Bathroom[]
  near: [number, number] | null
  onSelect: (id: string) => void
  capped: boolean
}

/**
 * The same places as the map, as text.
 *
 * The map draws every pin to a canvas, which is a blank rectangle to a screen
 * reader: the accessibility tree contained a heading, a search box, two
 * buttons and an empty region called "Map". Thirteen places were in view and
 * not one of them was reachable by keyboard or readable by assistive tech.
 * Somebody could filter to "step-free, grab bars" and be handed nothing at
 * all.
 *
 * That is disqualifying for a map about accessibility, so this is not a
 * fallback bolted on beside the real interface. For anybody who cannot use a
 * canvas it IS the interface, and it happens to be a better one for "what is
 * near me and which of these works" regardless of how you read it.
 *
 * Nearest first when a position is known, because the list cannot show
 * proximity the way a map does and that is usually the question.
 */
export default function PlaceList({ bathrooms, near, onSelect, capped }: Props) {
  const withDistance = bathrooms.map((b) => ({
    b,
    metres: near ? metresBetween(near, [b.lng, b.lat]) : null,
  }))

  withDistance.sort((x, y) => {
    if (x.metres != null && y.metres != null) return x.metres - y.metres
    return (y.b.confirms ?? 0) - (x.b.confirms ?? 0)
  })

  if (bathrooms.length === 0) {
    return (
      <div className="place-list is-empty">
        <p>Nothing in this view matches. Try moving the map or clearing a filter.</p>
      </div>
    )
  }

  return (
    <section className="place-list" aria-label={`${bathrooms.length} places in view`}>
      {/* A labelled landmark, because tab order alone is a poor way to find
          this: a screen reader user jumps by landmark and heading, and an
          unlabelled div is not somewhere you can jump to. The label carries
          the count, so arriving here tells you how much is here. */}
      <p className="place-list-count">{placesInView(bathrooms.length, capped)}</p>
      <ul>
        {withDistance.map(({ b, metres }) => {
          // Only what is settled. A list is a scanning surface, and "one
          // person said maybe" belongs in the sheet where it can be qualified.
          const known = ACCESS_FIELDS
            .map((f) => [f, settledValue(b, f)] as const)
            .filter(([, v]) => v != null)
            .map(([f, v]) => describe(f, v))
            .filter(([state]) => state === 'yes' || state === 'partial')
            .map(([, label]) => label)

          return (
            <li key={b.id}>
              <button type="button" className="place-item" onClick={() => onSelect(b.id)}>
                <span className="place-name">{b.name}</span>
                <span className="place-meta">
                  {VENUE_LABELS[b.venue_type]} · {ACCESS_LABELS[b.access_kind]}
                  {metres != null && <> · {describeDistance(metres)}</>}
                </span>
                <span className="place-access">
                  {known.length > 0 ? known.join(' · ') : 'Nothing recorded yet'}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
