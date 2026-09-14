import CodeEditor from './CodeEditor'
import UnlockCode from './UnlockCode'
import Comments from './Comments'
import FlagLink from './FlagLink'
import ReportBox from './ReportBox'
import type { Account } from '../lib/auth'
import { useState } from 'react'
import { confidenceLine, describeDistance, metresBetween } from '../lib/format'
import {
  ACCESS_LABELS, VENUE_LABELS,
  type Bathroom, type ChangingTableAccess, type WheelchairAccess,
} from '../lib/types'
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

type AmenityState = 'yes' | 'partial' | 'no' | 'unknown'

const MARKS: Record<AmenityState, string> = {
  yes: '\u2713', partial: '!', no: '\u00d7', unknown: '?',
}

const STEP_FREE: Record<WheelchairAccess, [AmenityState, string]> = {
  full:    ['yes',     'Step-free access'],
  partial: ['partial', 'Partly step-free'],
  none:    ['no',      'Step-free access'],
}

const CHANGING: Record<ChangingTableAccess, [AmenityState, string]> = {
  any:        ['yes',     'Changing table'],
  women_only: ['partial', 'Changing table — women’s room only'],
  men_only:   ['partial', 'Changing table — men’s room only'],
  none:       ['no',      'Changing table'],
}

/**
 * Two of these are not yes/no, so a tick and a cross cannot carry them. A
 * changing table in the women's room is useless to a father with an infant,
 * and "partly step-free" is the difference between a trip worth making and
 * one that ends at the door — which is the whole reason the columns were
 * widened rather than left as booleans.
 */
function amenityRows(b: Bathroom): { key: string; state: AmenityState; label: string }[] {
  const lookup = <T extends string>(
    value: T | null | undefined,
    table: Record<T, [AmenityState, string]>,
    fallback: string,
  ): [AmenityState, string] => (value == null ? ['unknown', fallback] : table[value])

  const [stepState, stepLabel] = lookup(b.wheelchair, STEP_FREE, 'Step-free access')
  const [changeState, changeLabel] = lookup(b.changing_table, CHANGING, 'Changing table')

  return [
    { key: 'wheelchair', state: stepState, label: stepLabel },
    { key: 'changing_table', state: changeState, label: changeLabel },
    {
      key: 'gender_neutral',
      state: b.gender_neutral == null ? 'unknown' : b.gender_neutral ? 'yes' : 'no',
      label: 'All-gender restroom',
    },
  ]
}

export default function DetailSheet({
  bathroom, detail, loading, near, account, onClose, onReported, onSpent,
}: Props) {
  const [localCode, setLocalCode] = useState<string | null>(null)
  const merged = { ...bathroom, ...detail, ...(localCode ? { code: localCode } : {}) }
  const confidence = confidenceLine(merged.confirms, merged.troubles, merged.last_confirmed)
  const accent = accessColor(merged.access_kind)

  const away = near ? describeDistance(metresBetween(near, [merged.lng, merged.lat])) : null
  // Universal Maps URL: resolves to the platform's own app on iOS and Android
  // and to the web map on a desktop, without sniffing the user agent.
  const directions =
    `https://www.google.com/maps/dir/?api=1&destination=${merged.lat},${merged.lng}`

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
        <p className="sheet-go">
          {away && <span className="distance">{away}</span>}
          <a className="directions" href={directions} target="_blank" rel="noreferrer noopener">
            Directions
          </a>
        </p>
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
        {amenityRows(merged).map(({ key, state, label }) => (
          <li key={key} className={state}>
            <span className="amenity-mark" aria-hidden="true">{MARKS[state]}</span>
            {label}
            {state === 'unknown' ? <em>unknown</em> : null}
          </li>
        ))}
      </ul>

      <ReportBox bathroom={merged} near={near} onReported={onReported} />

      <Comments bathroomId={merged.id} account={account} />

      <div className="sheet-foot">
        <FlagLink bathroomId={merged.id} />
      </div>
    </aside>
  )
}
