import { USING_SEED_DATA } from '../lib/config'
import { REPORT_LABELS, useReport } from '../lib/useReport'
import type { Bathroom } from '../lib/types'

interface Props {
  bathroom: Bathroom
  near: [number, number] | null
  onReported: (id: string, patch: Partial<Bathroom>) => void
}

/**
 * The whole point of this milestone: will a stranger tap a button for someone
 * else's benefit? Keep it to one question and the fewest answers that carry
 * real information.
 */
export default function ReportBox({ bathroom, near, onReported }: Props) {
  const { done, duplicate, busy, error, options, send } = useReport(bathroom, near, onReported)

  if (USING_SEED_DATA) {
    return (
      <div className="report">
        <span className="report-q">Been here recently?</span>
        <p className="report-note">
          Sample data — reporting needs a database connection.
        </p>
      </div>
    )
  }

  if (done) {
    return (
      <div className="report is-done" role="status" aria-live="polite">
        <span className="report-q">
          {duplicate
            ? 'You already reported this one today.'
            : `Thanks — logged as “${REPORT_LABELS[done] ?? done}”.`}
        </span>
        <p className="report-note">You can report it again tomorrow.</p>
      </div>
    )
  }

  return (
    <div className="report">
      <span className="report-q">Been here recently?</span>
      <div className="report-buttons">
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
      </div>
      {error && <p className="report-error">{error}</p>}
    </div>
  )
}
