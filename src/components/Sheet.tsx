import { useEffect, useRef, type ReactNode } from 'react'
import { useEscape } from '../lib/useEscape'

interface Props {
  /** Announced when the sheet takes focus, and used for the close button. */
  label: string
  /** Extra class on the panel, for anything that needs its own spacing. */
  className?: string
  onClose: () => void
  children: ReactNode
}

/**
 * A panel over the map, with the three ways out it has to have.
 *
 * Extracted at the third one. Two copies of "scrim, Escape, focus the panel,
 * a close button in the corner" were a coincidence; three is a pattern, and
 * the first version of this app shipped a sheet with none of them — a 30px
 * ring in the corner and nothing else — precisely because there was nowhere
 * for the answer to live.
 *
 * The detail sheet still has its own copy. It refocuses when the place
 * changes rather than only on mount, which is a different effect, and it is
 * the one screen here somebody uses while standing in the street. It can come
 * over when there is a reason to touch it.
 */
export default function Sheet({ label, className, onClose, children }: Props) {
  const panel = useRef<HTMLElement>(null)

  // A panel that opens without moving focus is a panel a screen reader is
  // never told about: it appears, and the reader is left wherever it was.
  useEffect(() => {
    panel.current?.focus({ preventScroll: true })
  }, [])

  useEscape(onClose)

  return (
    <>
      {/* Tapping away is how a phone closes a sheet. Below 48rem only — wider,
          this is a panel down the side and the map beside it stays usable. */}
      <div className="scrim" onClick={onClose} aria-hidden="true" />
      <aside
        className={className ? `sheet ${className}` : 'sheet'}
        aria-label={label}
        ref={panel}
        tabIndex={-1}
      >
        <button
          type="button"
          className="sheet-close"
          onClick={onClose}
          aria-label={`Close ${label.toLowerCase()}`}
        >
          ×
        </button>
        {children}
      </aside>
    </>
  )
}
