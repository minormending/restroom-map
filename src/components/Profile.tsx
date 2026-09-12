import { useEffect, useState } from 'react'
import type { Account } from '../lib/auth'
import { fetchBalance, fetchLedger, REASON_LABELS, type LedgerEntry } from '../lib/credits'
import { relativeDays } from '../lib/format'

interface Props {
  account: Account
  onClose: () => void
}

export default function Profile({ account, onClose }: Props) {
  const [balance, setBalance] = useState<number | null>(null)
  const [entries, setEntries] = useState<LedgerEntry[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    Promise.all([fetchBalance(), fetchLedger()])
      .then(([b, l]) => { if (live) { setBalance(b); setEntries(l) } })
      .catch((e: unknown) => {
        if (live) setError(e instanceof Error ? e.message : "Couldn't load your credits.")
      })
    return () => { live = false }
  }, [])

  return (
    <aside className="sheet profile-sheet" aria-label="Your credits">
      <button type="button" className="sheet-close" onClick={onClose} aria-label="Close">×</button>

      <header className="sheet-head">
        <span className="sheet-kind">{account.name}</span>
        <h2>Credits</h2>
      </header>

      <div className="balance">
        <span className="balance-number">{balance ?? '—'}</span>
        <span className="balance-label">earned so far</span>
      </div>

      <p className="balance-note">
        There's nothing to spend these on yet. They're a record of what you've
        contributed, and what a contribution turns out to be worth.
      </p>

      {error && <p className="report-error">{error}</p>}

      <h3 className="comments-title">History</h3>
      {entries.length === 0 && !error && (
        <p className="comments-empty">Nothing yet.</p>
      )}

      <ul className="ledger">
        {entries.map((e) => (
          <li key={e.id}>
            <span className="ledger-reason">{REASON_LABELS[e.reason] ?? e.reason}</span>
            <time dateTime={e.created_at}>{relativeDays(e.created_at)}</time>
            <span className={`ledger-delta${e.delta < 0 ? ' is-negative' : ''}`}>
              {e.delta > 0 ? `+${e.delta}` : e.delta}
            </span>
          </li>
        ))}
      </ul>

      <p className="sheet-foot">
        How credits are earned: adding a place that three people confirm, adding
        a code someone verifies, and a trickle each time your code is confirmed.
      </p>
    </aside>
  )
}
