import { useEffect, useRef } from 'react'
import BuildTag from './BuildTag'
import { useEscape } from '../lib/useEscape'

/** The contact address both legal pages already give. Same one, so a person
 *  who reads the privacy page and a person who taps here arrive together. */
const ISSUES = 'https://github.com/minormending/restroom-map/issues'

interface Props {
  onClose: () => void
  onAbout: () => void
}

/**
 * Everything that is about the app rather than about a bathroom.
 *
 * These four lived in a strip along the bottom of the map — Privacy, Terms,
 * "What is this?", and the build number — where they competed with the thing
 * the app is for and still had nowhere to put a fifth. A phone has no room to
 * spend on a permanent row of things nobody taps twice.
 *
 * The fifth is the point. A beta tester with a complaint had nowhere to put
 * it: the issue tracker is named in both legal pages as the way to reach
 * somebody, which is no use at all to a person who has not read the legal
 * pages. Now it is one tap from the map and the first thing in the list,
 * because a bug report is worth more than a version number.
 *
 * GITHUB, FOR NOW
 *
 * It costs nothing, it threads, and it is already the declared contact. What
 * it does not do is take a complaint from somebody without a GitHub account,
 * which is most people this map is for. The upgrade is a form that writes to
 * the same moderation queue the flags use; this is the thing that can ship
 * today, and swapping the destination is one line.
 */
export default function Menu({ onClose, onAbout }: Props) {
  const panel = useRef<HTMLElement>(null)

  // Same reasoning as the detail sheet: a panel that opens without moving
  // focus is a panel a screen reader is never told about.
  useEffect(() => {
    panel.current?.focus({ preventScroll: true })
  }, [])

  useEscape(onClose)

  return (
    <>
      <div className="scrim" onClick={onClose} aria-hidden="true" />
      <aside
        className="sheet menu-sheet"
        aria-label="About this app"
        ref={panel}
        tabIndex={-1}
      >
        <button type="button" className="sheet-close" onClick={onClose} aria-label="Close menu">
          ×
        </button>

        <header className="sheet-head">
          <h2>Restroom Map</h2>
        </header>

        <a
          className="menu-row is-primary"
          href={`${ISSUES}/new`}
          target="_blank"
          rel="noreferrer noopener"
        >
          <span className="menu-label">Report a problem or ask for something</span>
          <span className="menu-note">
            Bugs, a place that is wrong, anything missing. Opens the issue tracker.
          </span>
        </a>

        <button type="button" className="menu-row" onClick={onAbout}>
          <span className="menu-label">What is this?</span>
          <span className="menu-note">The short version, again.</span>
        </button>

        <a className="menu-row" href="privacy.html">
          <span className="menu-label">Privacy</span>
        </a>

        <a className="menu-row" href="terms.html">
          <span className="menu-label">Terms</span>
        </a>

        <div className="sheet-foot menu-foot">
          {/* Still readable out loud when something looks wrong, and still the
              button that clears a stale service worker — one tap further in
              than it was, which is the trade for the map getting its corner
              back. */}
          <span className="menu-note">Version</span>
          <BuildTag />
        </div>
      </aside>
    </>
  )
}
