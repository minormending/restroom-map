import { dismissNearby } from '../lib/reported'
import { REPORT_LABELS, useReport } from '../lib/useReport'
import type { Bathroom } from '../lib/types'

interface Props {
  bathroom: Bathroom
  near: [number, number] | null
  onReported: (id: string, patch: Partial<Bathroom>) => void
  onDismiss: (id: string) => void
}

/**
 * The map has 84 places on it and one confirmation. Every piece of machinery
 * behind that number — escrow, the geo-verified count, the thresholds that
 * release a payout — is waiting on an input that never arrives, because the
 * only way to file one is to remember to open a pin and scroll.
 *
 * This asks instead, once, at the only moment the answer is worth anything:
 * while you are standing there. A report sent from here carries coordinates,
 * so it counts as geo-verified, which is the kind escrow actually needs.
 *
 * It names the place rather than saying "this place", so a wrong guess is
 * obvious and can be waved away in one tap instead of being answered wrongly.
 */
export default function NearbyPrompt({ bathroom, near, onReported, onDismiss }: Props) {
  const { done, busy, error, options, send } = useReport(bathroom, near, onReported)

  // Answered from here, the prompt has done its job and should leave. The
  // thanks belongs in the sheet, where there is room for it.
  if (done) return null

  return (
    <aside className="nearby" aria-label={`Report on ${bathroom.name}`} role="status" aria-live="polite">
      <p className="nearby-q">
        You seem to be at <strong>{bathroom.name}</strong>. Does the bathroom work?
      </p>

      <div className="nearby-actions">
        {options.map((kind) => (
          <button
            key={kind}
            type="button"
            className={`report-btn is-${kind}`}
            disabled={busy !== null}
            onClick={() => void send(kind)}
          >
            {busy === kind ? '…' : REPORT_LABELS[kind]}
          </button>
        ))}
        <button
          type="button"
          className="nearby-dismiss"
          onClick={() => {
            dismissNearby(bathroom.id)
            onDismiss(bathroom.id)
          }}
        >
          Not now
        </button>
      </div>

      {error && <p className="report-error">{error}</p>}
    </aside>
  )
}
