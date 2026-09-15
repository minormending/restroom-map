import BuildTag from './BuildTag'
import Sheet from './Sheet'

interface Props {
  onClose: () => void
  onAbout: () => void
  onFeedback: () => void
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
 * it, and it is the only row here that is a form rather than a link.
 *
 * "What is this?" goes above it even so. Somebody opening this menu is more
 * often lost than cross, and the shorter answer should not be underneath a
 * form — a question reads past in a second, whereas the form is the largest
 * thing in the panel and pushes everything under it off a phone screen.
 *
 * It writes to the moderation queue, not to GitHub. The issue tracker is
 * named as the contact in both legal pages, and it serves the people least
 * likely to need it: somebody with an account already open. Everybody else
 * was being asked to sign up somewhere before they could say a door code was
 * wrong.
 *
 * The form itself lives in its own sheet. Expanded here it was 456px of a
 * 790px menu and pushed Privacy, Terms and the build number below the fold —
 * see FeedbackSheet. What stays is a row, like the rest of them, so this is
 * four lines somebody can read without scrolling.
 */
export default function Menu({ onClose, onAbout, onFeedback }: Props) {
  return (
    <Sheet label="Menu" className="menu-sheet" onClose={onClose}>
      <header className="sheet-head">
        <h2>Restroom Map</h2>
      </header>

      <button type="button" className="menu-row" onClick={onAbout}>
        <span className="menu-label">What is this?</span>
        <span className="menu-note">The short version, again.</span>
      </button>

      <button type="button" className="menu-row is-primary menu-feedback" onClick={onFeedback}>
        <span className="menu-label">Tell us what is wrong</span>
        <span className="menu-note">
          Bugs, a place that is wrong, anything missing. No account needed.
        </span>
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
    </Sheet>
  )
}
