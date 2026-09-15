import { useState } from 'react'
import SearchBar from './SearchBar'
import { placeLabel, type Place } from '../lib/geocode'
import { submitBathroom, type SubmitResult } from '../lib/submissions'
import {
  ACCESS_KINDS, ACCESS_LABELS, VENUE_LABELS, VENUE_TYPES,
  type AccessKind, type VenueType,
} from '../lib/types'

interface Props {
  center: [number, number]
  onFlyTo: (center: [number, number], zoom: number) => void
  onCancel: () => void
  onAdded: (id: string) => void
}

/** Close enough to see a doorway, so nudging the crosshair moves metres. */
const DOORWAY_ZOOM = 18

/**
 * Two steps on purpose. Positioning a pin and describing a place are different
 * jobs, and doing both at once on a phone means the keyboard covers the map.
 *
 * TWO WAYS TO PLACE IT, AND THE TYPED ONE IS FIRST
 *
 * The crosshair was the only way in, and beta testers said the same thing
 * about it: they knew the address, and lining a reticle up with a building
 * they could not see was work they had no way to do well. Somebody who can
 * type "180 Maiden Lane" should not have to find it on a map first — that is
 * the geocoder's job, and this app already runs one for the search bar.
 *
 * So an address goes straight through to the description, carrying its own
 * coordinates. The crosshair stays for the case the typed one cannot serve —
 * a bathroom in a park, at a beach, anywhere without a street number — and
 * for anyone who wants to correct where the geocoder landed.
 */
export default function AddPlace({ center, onFlyTo, onCancel, onAdded }: Props) {
  const [step, setStep] = useState<'place' | 'describe'>('place')
  const [at, setAt] = useState<[number, number]>(center)
  /** Whether `at` came from a typed address rather than the crosshair. */
  const [searched, setSearched] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [venue, setVenue] = useState<VenueType>('cafe')
  const [access, setAccess] = useState<AccessKind>('open')
  const [address, setAddress] = useState('')
  const [hint, setHint] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [duplicate, setDuplicate] = useState<string | null>(null)

  /**
   * An address answers the question outright, so this does not hand the person
   * back to the crosshair to confirm what they just typed.
   *
   * The map is flown there anyway. Not for this step — for the "move" link on
   * the next one, so that if the geocoder put the pin on the wrong side of the
   * block, the crosshair is already looking at the right block when they go
   * back to fix it.
   */
  const choose = (place: Place) => {
    const point: [number, number] = [place.lng, place.lat]
    setAt(point)
    setSearched(placeLabel(place))
    if (!address) setAddress(placeLabel(place))
    onFlyTo(point, DOORWAY_ZOOM)
    setStep('describe')
  }

  if (step === 'place') {
    return (
      <div className="placing">
        <p className="placing-title">Where is it?</p>
        <SearchBar
          near={center}
          onPick={choose}
          placeholder="Type the address"
          label="Search for the address of the new place"
          dropUp
        />
        <p className="placing-note">
          No address? Line the crosshair up with the bathroom instead — drag and
          zoom the map, and get as close as you can.
        </p>
        <div className="placing-actions">
          <button type="button" className="btn-quiet" onClick={onCancel}>Cancel</button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => { setAt(center); setSearched(null); setStep('describe') }}
          >
            Use the crosshair
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
          {searched ?? `${at[1].toFixed(5)}, ${at[0].toFixed(5)}`}
          <button type="button" className="linkish" onClick={() => setStep('place')}>
            move
          </button>
        </p>
        {searched && (
          // A geocoded address lands on the building, which is not the same as
          // the door and is sometimes not even the right side of it. Worth one
          // line, because the person who typed it is the only one who knows.
          <p className="placing-note">
            Placed from the address. Use <strong>move</strong> if the pin should
            sit somewhere more exact.
          </p>
        )}
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
