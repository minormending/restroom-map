import { useState } from 'react'
import { USING_SEED_DATA } from '../lib/config'
import { rememberReport, reportedKind } from '../lib/reported'
import { submitReport, type ReportResult } from '../lib/reports'
import type { Bathroom, ReportKind } from '../lib/types'

interface Props {
  bathroom: Bathroom
  near: [number, number] | null
  onReported: (id: string, patch: Partial<Bathroom>) => void
}

const LABELS: Record<string, string> = {
  works: 'Worked',
  code_bad: 'Code was wrong',
  gone: "Wasn't there",
}

/**
 * The whole point of this milestone: will a stranger tap a button for someone
 * else's benefit? Keep it to one question and the fewest answers that carry
 * real information.
 */
export default function ReportBox({ bathroom, near, onReported }: Props) {
  const [done, setDone] = useState<ReportKind | null>(() => reportedKind(bathroom.id))
  // Distinguishes "we recorded that" from "you'd already told us", which are
  // different facts and shouldn't share a message.
  const [duplicate, setDuplicate] = useState(false)
  const [busy, setBusy] = useState<ReportKind | null>(null)
  const [error, setError] = useState<string | null>(null)

  const options: ReportKind[] = bathroom.access_kind === 'code_required'
    ? ['works', 'code_bad', 'gone']
    : ['works', 'gone']

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

  const send = async (kind: ReportKind) => {
    setBusy(kind)
    setError(null)
    try {
      const res: ReportResult = await submitReport(bathroom.id, kind, near)
      rememberReport(bathroom.id, kind)
      setDone(kind)
      if (res.ok) {
        onReported(bathroom.id, {
          confirms: res.confirms ?? bathroom.confirms,
          troubles: res.troubles ?? bathroom.troubles,
          last_confirmed: res.last_confirmed ?? bathroom.last_confirmed,
        })
      } else {
        setDuplicate(res.reason === 'already_reported')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that report.")
    } finally {
      setBusy(null)
    }
  }

  if (done) {
    return (
      <div className="report is-done">
        <span className="report-q">
          {duplicate
            ? 'You already reported this one today.'
            : `Thanks — logged as “${LABELS[done] ?? done}”.`}
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
            {busy === kind ? '…' : LABELS[kind]}
          </button>
        ))}
      </div>
      {error && <p className="report-error">{error}</p>}
    </div>
  )
}
