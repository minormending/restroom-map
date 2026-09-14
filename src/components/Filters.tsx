import {
  ACCESS_KINDS, ACCESS_LABELS, VENUE_LABELS, VENUE_TYPES,
  type AccessKind, type Filters, type VenueType,
} from '../lib/types'
import { placesInView } from '../lib/format'
import { accessColor } from '../map/icons'

interface Props {
  filters: Filters
  onChange: (next: Filters) => void
  open: boolean
  onToggle: () => void
  /** How many places survive the current view and filters, or null while the
   *  data is unusable. This is the feedback for filtering, so it belongs with
   *  the controls rather than on the map behind them. */
  resultCount: number | null
}

/**
 * Migration 015 shipped only the changing-table filter and said so: wheelchair
 * and gender_neutral were null on every row, and a filter that can only ever
 * return nothing is worse than its absence. Importing the two fields NYC Open
 * Data was already sending makes both of them answerable.
 */
const NEEDS = [
  ['needsStepFree', 'Step-free'],
  ['needsChanging', 'Changing table'],
  ['needsGenderNeutral', 'All-gender'],
] as const

function toggle<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  return next
}

export default function FiltersPanel({ filters, onChange, open, onToggle, resultCount }: Props) {
  const needs = [filters.needsChanging, filters.needsStepFree, filters.needsGenderNeutral]
  const count = filters.venues.size + filters.access.size + needs.filter(Boolean).length

  return (
    <div className={`filters${open ? ' is-open' : ''}`}>
      <button type="button" className="filters-toggle" onClick={onToggle} aria-expanded={open}>
        Filters{count > 0 && <span className="pip">{count}</span>}
      </button>

      {open && (
        <div className="filters-body">
          {resultCount !== null && (
            <p className="filters-count" role="status">{placesInView(resultCount)}</p>
          )}

          <fieldset>
            <legend>Access</legend>
            <div className="chips">
              {ACCESS_KINDS.map((a: AccessKind) => (
                <button
                  key={a}
                  type="button"
                  className={`chip${filters.access.has(a) ? ' is-on' : ''}`}
                  aria-pressed={filters.access.has(a)}
                  onClick={() => onChange({ ...filters, access: toggle(filters.access, a) })}
                >
                  <i className="swatch" style={{ background: accessColor(a) }} aria-hidden="true" />
                  {ACCESS_LABELS[a]}
                </button>
              ))}
            </div>
            <p className="legend-note">
              Hollow pins are places nobody has confirmed yet.
            </p>
          </fieldset>

          <fieldset>
            <legend>Needs</legend>
            <div className="chips">
              {NEEDS.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={`chip${filters[key] ? ' is-on' : ''}`}
                  aria-pressed={filters[key]}
                  onClick={() => onChange({ ...filters, [key]: !filters[key] })}
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend>Place</legend>
            <div className="chips">
              {VENUE_TYPES.map((v: VenueType) => (
                <button
                  key={v}
                  type="button"
                  className={`chip${filters.venues.has(v) ? ' is-on' : ''}`}
                  aria-pressed={filters.venues.has(v)}
                  onClick={() => onChange({ ...filters, venues: toggle(filters.venues, v) })}
                >
                  {VENUE_LABELS[v]}
                </button>
              ))}
            </div>
          </fieldset>

          {count > 0 && (
            <button
              type="button"
              className="clear"
              onClick={() =>
                onChange({
                  ...filters, venues: new Set(), access: new Set(),
                  needsChanging: false, needsStepFree: false, needsGenderNeutral: false,
                })
              }
            >
              Clear filters
            </button>
          )}
        </div>
      )}
    </div>
  )
}
