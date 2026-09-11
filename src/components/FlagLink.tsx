import { useState } from 'react'
import { USING_SEED_DATA } from '../lib/config'
import { submitFlag } from '../lib/reports'

interface Props { bathroomId: string }

/**
 * Also the business-removal path. Anyone asking for their premises to come off
 * the map arrives here, and lands in the same queue as everything else.
 */
export default function FlagLink({ bathroomId }: Props) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (USING_SEED_DATA) return null
  if (sent) return <p className="flag-sent">Thanks — we'll take a look.</p>

  if (!open) {
    return (
      <button type="button" className="flag-open" onClick={() => setOpen(true)}>
        Report a problem with this listing
      </button>
    )
  }

  const send = async () => {
    setBusy(true)
    setError(null)
    try {
      await submitFlag(bathroomId, reason, email)
      setSent(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send that.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flag-form">
      <label htmlFor="flag-reason">What's wrong with it?</label>
      <textarea
        id="flag-reason"
        rows={3}
        value={reason}
        placeholder="Wrong location, shouldn't be listed, offensive content…"
        onChange={(e) => setReason(e.target.value)}
      />
      <label htmlFor="flag-email">Email, if you want a reply (optional)</label>
      <input
        id="flag-email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      {error && <p className="report-error">{error}</p>}
      <div className="flag-actions">
        <button type="button" className="flag-cancel" onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button
          type="button"
          className="flag-send"
          disabled={busy || reason.trim().length === 0}
          onClick={() => void send()}
        >
          {busy ? 'Sending…' : 'Send'}
        </button>
      </div>
    </div>
  )
}
