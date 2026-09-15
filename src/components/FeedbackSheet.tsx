import FeedbackForm from './FeedbackForm'
import Sheet from './Sheet'

interface Props {
  onClose: () => void
}

/**
 * The complaint box, given its own screen.
 *
 * It spent a day expanded inside the menu, which measured badly: 456px of a
 * 790px menu on a 375px phone, pushing Privacy, Terms and the build number
 * below the fold. The build number is the thing somebody reads out when
 * something looks wrong, so the form was burying the first question anybody
 * asks about a bug underneath the form for reporting it.
 *
 * WHY A SHEET AND NOT AN EXPANDER
 *
 * The obvious fix is to collapse it in place. But the menu is already 78vh
 * and already scrolls, and a phone keyboard takes most of what is left — so
 * an expander puts a textarea in the worst place on the screen to type.
 * Its own sheet gives the form the whole panel with nothing above it.
 *
 * The tap this costs is only paid by somebody who has decided to complain,
 * and they are tapping a row that says "Tell us what is wrong". Everybody
 * else gets a menu they can read without scrolling.
 */
export default function FeedbackSheet({ onClose }: Props) {
  return (
    <Sheet label="Feedback" className="feedback-sheet" onClose={onClose}>
      <header className="sheet-head">
        <h2>Tell us what is wrong</h2>
        <p className="sheet-addr">
          Bugs, a place that is wrong, anything missing. No account needed, and
          no address unless you want an answer back.
        </p>
      </header>

      {/* Not closed on send. The form swaps itself for a thank-you, and a
          confirmation that vanishes on its own is worse than one somebody
          dismisses — especially here, where the whole question is whether the
          thing they wrote went anywhere. */}
      <FeedbackForm />
    </Sheet>
  )
}
