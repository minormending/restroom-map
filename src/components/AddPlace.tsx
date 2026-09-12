import { useState } from 'react'
import { submitBathroom, type SubmitResult } from '../lib/submissions'
import {
  ACCESS_KINDS, ACCESS_LABELS, VENUE_LABELS, VENUE_TYPES,
  type AccessKind, type VenueType,
} from '../lib/types'

interface Props {
  center: [number, number]
  onCancel: () => void
  onAdded: (id: string) => void
}

/**
 * Two steps on purpose. Positioning a pin and describing a place are different
 * jobs, and doing both at once on a phone means the keyboard covers the map.
 */
export default function AddPlace({ center, onCancel, onAdded }: Props) {
  const [step, setStep] = useState<'place' | 'describe'>('place')
  const [at, setAt] = useState<[number, number]>(center)
  const [name, setName] = useState('')
  const [venue, setVenue] = useState<VenueType>('cafe')
  const [access, setAccess] = useState<AccessKind>('open')
  const [address, setAddress] = useState('')
  const [hint, setHint] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [duplicate, setDuplicate] = useState<string | null>(null)

  if (step === 'place') {
    return (
      <div className="placing">
        <p className="placing-title">Line the crosshair up with the bathroom</p>
        <p className="placing-note">Drag and zoom the map. Get as close as you can.</p>
        <div className="placing-actions">
          <button type="button" className="btn-quiet" onClick={onCancel}>Cancel</button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => { setAt(center); setStep('describe') }}
          >
            It's here
          </button>
        </div>
      </div>
    )
  }

  const save = async () => {
    setBusy(true)
    setError(null)
    setDuplicate(null)
    try {
      const res: SubmitResult = await submitBathroom({
        name, lat: at[1], lng: at[0],
        venue_type: venue, access_kind: access,
        address: address || undefined,
        floor_hint: hint || undefined,
        code: access === 'code_required' && code ? code : undefined,
      })
      if (res.ok) onAdded(res.id)
      else setDuplicate(res.existing_name)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <aside className="sheet add-sheet" aria-label="Add a place">
      <button type="button" className="sheet-close" onClick={onCancel} aria-label="Cancel">×</button>
      <header className="sheet-head">
        <span className="sheet-kind">New place</span>
        <h2>Describe it</h2>
        <p className="sheet-addr">
          {at[1].toFixed(5)}, {at[0].toFixed(5)}
          <button type="button" className="linkish" onClick={() => setStep('place')}>
            move
          </button>
        </p>
      </header>

      <label className="field">
        <span>Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)}
               placeholder="e.g. Joe's Coffee" maxLength={120} />
      </label>

      <label className="field">
        <span>What kind of place is it?</span>
        <select value={venue} onChange={(e) => setVenue(e.target.value as VenueType)}>
          {VENUE_TYPES.map((v) => <option key={v} value={v}>{VENUE_LABELS[v]}</option>)}
        </select>
      </label>

      <label className="field">
        <span>How do you get in?</span>
        <select value={access} onChange={(e) => setAccess(e.target.value as AccessKind)}>
          {ACCESS_KINDS.map((a) => <option key={a} value={a}>{ACCESS_LABELS[a]}</option>)}
        </select>
      </label>

      {access === 'code_required' && (
        <label className="field">
          <span>Door code, if you know it</span>
          <input value={code} onChange={(e) => setCode(e.target.value)}
                 placeholder="Leave blank if you don't" maxLength={40} />
        </label>
      )}

      <label className="field">
        <span>Address <em>optional</em></span>
        <input value={address} onChange={(e) => setAddress(e.target.value)} maxLength={200} />
      </label>

      <label className="field">
        <span>How to find it <em>optional</em></span>
        <input value={hint} onChange={(e) => setHint(e.target.value)}
               placeholder="Back past the counter, down the stairs" maxLength={200} />
      </label>

      {duplicate && (
        <p className="report-error">
          There's already a place within 20 metres: <strong>{duplicate}</strong>. Add a
          report to that one instead of a second pin.
        </p>
      )}
      {error && <p className="report-error">{error}</p>}

      <div className="placing-actions">
        <button type="button" className="btn-quiet" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn-primary"
                disabled={busy || name.trim().length === 0}
                onClick={() => void save()}>
          {busy ? 'Saving…' : 'Add it'}
        </button>
      </div>
    </aside>
  )
}
