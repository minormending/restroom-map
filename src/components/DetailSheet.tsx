import CodeEditor from './CodeEditor'
import UnlockCode from './UnlockCode'
import AccessDetail from './AccessDetail'
import Comments from './Comments'
import FlagLink from './FlagLink'
import ReportBox from './ReportBox'
import type { Account } from '../lib/auth'
import { useEffect, useRef, useState } from 'react'
import { confidenceLine, describeDistance, metresBetween, seasonalLine } from '../lib/format'
import { ACCESS_LABELS, VENUE_LABELS, type Bathroom } from '../lib/types'
import { accessColor } from '../map/icons'

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

export default function DetailSheet({
  bathroom, detail, loading, near, account, onClose, onReported, onSpent,
}: Props) {
  const sheet = useRef<HTMLElement>(null)

  /**
   * Move focus into the sheet when it opens.
   *
   * Without this the sheet appears and focus stays wherever it was — on the
   * map, or on the Filters button. A sighted user sees a panel slide in; a
   * screen reader user is told nothing at all, and has to go looking for
   * something they have no reason to believe exists.
   *
   * Focus goes to the container rather than the close button: landing on
   * "Close details" as the first thing you hear is a strange way to be shown
   * a place. The container is labelled, so it announces the name.
   */
  useEffect(() => {
    sheet.current?.focus({ preventScroll: true })
  }, [bathroom.id])

  const [localCode, setLocalCode] = useState<string | null>(null)
  const merged = { ...bathroom, ...detail, ...(localCode ? { code: localCode } : {}) }
  const confidence = confidenceLine(merged.confirms, merged.troubles, merged.last_confirmed)
  const season = seasonalLine()
  const accent = accessColor(merged.access_kind)

  const away = near ? describeDistance(metresBetween(near, [merged.lng, merged.lat])) : null
  // Universal Maps URL: resolves to the platform's own app on iOS and Android
  // and to the web map on a desktop, without sniffing the user agent.
  const directions =
    `https://www.google.com/maps/dir/?api=1&destination=${merged.lat},${merged.lng}`

  return (
    <aside
      className="sheet"
      aria-label={`Details for ${merged.name}`}
      ref={sheet}
      tabIndex={-1}
    >
      <button type="button" className="sheet-close" onClick={onClose} aria-label="Close details">
        ×
      </button>

      <header className="sheet-head">
        <span className="sheet-kind" style={{ color: accent }}>
          {VENUE_LABELS[merged.venue_type]} · {ACCESS_LABELS[merged.access_kind]}
        </span>
        <h2>{merged.name}</h2>
        {merged.address && <p className="sheet-addr">{merged.address}</p>}
        {merged.operator && <p className="sheet-operator">Operated by {merged.operator}</p>}
        <p className="sheet-go">
          {away && <span className="distance">{away}</span>}
          <a className="directions" href={directions} target="_blank" rel="noreferrer noopener">
            Directions
          </a>
        </p>
      </header>

      <p className={`confidence tone-${confidence.tone}`}>{confidence.text}</p>

      {merged.closed_in_winter && <p className={`seasonal tone-${season.tone}`}>{season.text}</p>}

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

      <AccessDetail bathroom={merged} account={account} />

      <ReportBox bathroom={merged} near={near} onReported={onReported} />

      <Comments bathroomId={merged.id} account={account} />

      <div className="sheet-foot">
        <FlagLink bathroomId={merged.id} />
      </div>
    </aside>
  )
}
