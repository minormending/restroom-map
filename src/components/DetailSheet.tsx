import CodeEditor from './CodeEditor'
import UnlockCode from './UnlockCode'
import Comments from './Comments'
import FlagLink from './FlagLink'
import ReportBox from './ReportBox'
import type { Account } from '../lib/auth'
import { useState } from 'react'
import { confidenceLine } from '../lib/format'
import { ACCESS_LABELS, VENUE_LABELS, fillFor, type Bathroom } from '../lib/types'
import { fillColor } from '../map/icons'

interface Props {
  bathroom: Bathroom
  detail: Partial<Bathroom> | null
  loading: boolean
  near: [number, number] | null
  account: Account | null
  onClose: () => void
  onReported: (id: string, patch: Partial<Bathroom>) => void
  onSpent: () => void
}

const AMENITIES = [
  ['wheelchair', 'Step-free access'],
  ['changing_table', 'Changing table'],
  ['gender_neutral', 'Gender neutral'],
] as const

export default function DetailSheet({
  bathroom, detail, loading, near, account, onClose, onReported, onSpent,
}: Props) {
  const [localCode, setLocalCode] = useState<string | null>(null)
  const merged = { ...bathroom, ...detail, ...(localCode ? { code: localCode } : {}) }
  const confidence = confidenceLine(merged.confirms, merged.troubles, merged.last_confirmed)
  const accent = fillColor(fillFor(merged))

  return (
    <aside className="sheet" aria-label={`Details for ${merged.name}`}>
      <button type="button" className="sheet-close" onClick={onClose} aria-label="Close details">
        ×
      </button>

      <header className="sheet-head">
        <span className="sheet-kind" style={{ color: accent }}>
          {VENUE_LABELS[merged.venue_type]} · {ACCESS_LABELS[merged.access_kind]}
        </span>
        <h2>{merged.name}</h2>
        {merged.address && <p className="sheet-addr">{merged.address}</p>}
      </header>

      <p className={`confidence tone-${confidence.tone}`}>{confidence.text}</p>

      {merged.access_kind === 'code_required' && (
        <div className="code-block">
          <span className="code-label">Door code</span>
          {loading ? (
            <span className="code-value is-pending">Checking…</span>
          ) : merged.code ? (
            <span className="code-value">{merged.code}</span>
          ) : merged.code_locked ? (
            <>
              <span className="code-value is-locked" aria-label="Locked">••••</span>
              <UnlockCode
                bathroomId={merged.id}
                cost={merged.code_cost ?? 2}
                account={account}
                onUnlocked={setLocalCode}
                onSpent={onSpent}
              />
            </>
          ) : (
            <span className="code-value is-empty">
              Not recorded yet — there's a keypad, but nobody has added the code.
            </span>
          )}
          {account && (
            <CodeEditor
              bathroomId={merged.id}
              currentCode={merged.code ?? null}
              onSaved={setLocalCode}
            />
          )}
        </div>
      )}

      {merged.floor_hint && (
        <p className="sheet-hint">
          <span className="hint-label">Finding it</span>
          {merged.floor_hint}
        </p>
      )}

      <ul className="amenities">
        {AMENITIES.map(([key, label]) => {
          const value = merged[key]
          return (
            <li key={key} className={value === true ? 'yes' : value === false ? 'no' : 'unknown'}>
              <span className="amenity-mark" aria-hidden="true">
                {value === true ? '✓' : value === false ? '×' : '?'}
              </span>
              {label}
              {value === null || value === undefined ? <em>unknown</em> : null}
            </li>
          )
        })}
      </ul>

      <ReportBox bathroom={merged} near={near} onReported={onReported} />

      <Comments bathroomId={merged.id} account={account} />

      <div className="sheet-foot">
        <FlagLink bathroomId={merged.id} />
      </div>
    </aside>
  )
}
