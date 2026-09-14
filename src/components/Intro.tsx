import { useEffect, useRef } from 'react'

const KEY = 'restroom-map/intro-seen/v1'

export function introSeen(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    // Private windows throw on access. Showing it again is a smaller problem
    // than crashing, so treat an unreadable store as a first visit.
    return false
  }
}

function remember() {
  try {
    localStorage.setItem(KEY, '1')
  } catch {
    // It will show again next time. Acceptable.
  }
}

interface Props {
  onDismiss: () => void
}

/**
 * What this is, for somebody who has just landed on it.
 *
 * The feedback was that people arrive and do not know what the app is or what
 * to do, and the cause was not subtle: the only <h1> is sr-only, so the page
 * never said its own name to anybody looking at it. A screen reader user got a
 * better introduction than a sighted one.
 *
 * Three things and no more — what it is, what to do, and why almost every pin
 * is hollow, which is the single most confusing thing on screen right now and
 * the one a newcomer is most likely to read as breakage.
 *
 * It sits at the bottom rather than over the middle, and it goes away on one
 * tap or Escape. Somebody opening this app may be in a hurry in a way most
 * software never has to think about, and a splash screen between them and a
 * toilet would be a poor trade for an explanation they can get later.
 */
export default function Intro({ onDismiss }: Props) {
  const card = useRef<HTMLElement>(null)

  useEffect(() => {
    card.current?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') dismiss() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const dismiss = () => {
    remember()
    onDismiss()
  }

  return (
    <section className="intro" aria-label="About this map" ref={card} tabIndex={-1}>
      <h2 className="intro-title">Restroom Map</h2>

      <p>
        Public restrooms, and whether one will actually work for you — step-free,
        grab bars, an adult changing bench, a sink you can reach.
      </p>
      <p>
        Tap a pin for the detail, or switch to <strong>List</strong>.
        {' '}<strong>Filters</strong> narrows the map to what you need.
      </p>
      <p className="intro-note">
        Most pins are hollow because nobody has recorded what is there yet. Two
        people have to agree before an answer is shown as fact.
      </p>

      <button type="button" className="btn-primary intro-go" onClick={dismiss}>
        Got it
      </button>
    </section>
  )
}
