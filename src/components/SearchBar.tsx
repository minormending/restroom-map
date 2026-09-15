import { useEffect, useRef, useState } from 'react'
import { geocode, type Place } from '../lib/geocode'

interface Props {
  near: [number, number] | null
  onPick: (place: Place) => void
  placeholder?: string
  label?: string
  /**
   * Open the results upward. For a panel anchored to the bottom of the screen,
   * where a list hanging off the input's bottom edge would be off-screen.
   */
  dropUp?: boolean
}

/**
 * Search is a co-primary way in, not a fallback. Desktop geolocation is
 * frequently wrong by miles, so this stays visible even when a fix succeeded.
 *
 * Used twice: to move the map, and to place a new pin by address. The second
 * one is why this takes its wording from props — the debounce, the abort, the
 * arrow keys and the listbox roles are the same job both times, and a second
 * copy of them would have drifted from this one within a release.
 */
export default function SearchBar({
  near, onPick, placeholder = 'Search a place',
  label = 'Search for a place', dropUp = false,
}: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Place[]>([])
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [active, setActive] = useState(-1)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (query.trim().length < 3) {
      setResults([])
      setError(null)
      return
    }
    const ctrl = new AbortController()
    const t = setTimeout(() => {
      geocode(query, near, ctrl.signal)
        .then((r) => { setResults(r); setError(null); setOpen(true); setActive(-1) })
        .catch((e: unknown) => {
          if (e instanceof DOMException && e.name === 'AbortError') return
          setError(e instanceof Error ? e.message : 'Search failed')
        })
    }, 300)
    return () => { clearTimeout(t); ctrl.abort() }
  }, [query, near])

  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [])

  const choose = (place: Place) => {
    onPick(place)
    setQuery(place.name)
    setOpen(false)
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setOpen(false); return }
    if (!results.length) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % results.length) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i <= 0 ? results.length : i) - 1) }
    if (e.key === 'Enter' && active >= 0) { e.preventDefault(); choose(results[active]) }
  }

  return (
    <div className={dropUp ? 'search is-up' : 'search'} ref={box}>
      <input
        type="search"
        value={query}
        placeholder={placeholder}
        aria-label={label}
        autoComplete="off"
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => results.length && setOpen(true)}
        onKeyDown={onKey}
      />
      {error && <p className="search-error">{error}</p>}
      {open && results.length > 0 && (
        <ul className="search-results" role="listbox">
          {results.map((r, i) => (
            <li key={`${r.lat},${r.lng},${r.name}`}>
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                className={i === active ? 'is-active' : undefined}
                onClick={() => choose(r)}
              >
                <b>{r.name}</b>
                {r.context && <span>{r.context}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
