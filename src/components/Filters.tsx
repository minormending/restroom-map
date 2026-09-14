import {
  ACCESS_KINDS, ACCESS_LABELS, VENUE_LABELS, VENUE_TYPES,
  type AccessKind, type Filters, type VenueType,
} from '../lib/types'
import { accessColor } from '../map/icons'

interface Props {
  filters: Filters
  onChange: (next: Filters) => void
  open: boolean
  onToggle: () => void
}

function toggle<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  return next
}

export default function FiltersPanel({ filters, onChange, open, onToggle }: Props) {
  const count = filters.venues.size + filters.access.size + (filters.needsChanging ? 1 : 0)

  return (
    <div className={`filters${open ? ' is-open' : ''}`}>
      <button type="button" className="filters-toggle" onClick={onToggle} aria-expanded={open}>
        Filters{count > 0 && <span className="pip">{count}</span>}
      </button>

      {open && (
        <div className="filters-body">
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
              <button
                type="button"
                className={`chip${filters.needsChanging ? ' is-on' : ''}`}
                aria-pressed={filters.needsChanging}
                onClick={() => onChange({ ...filters, needsChanging: !filters.needsChanging })}
              >
                Changing table
              </button>
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
                onChange({ ...filters, venues: new Set(), access: new Set(), needsChanging: false })
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
