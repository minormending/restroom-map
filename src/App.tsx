import { useCallback, useEffect, useRef, useState } from 'react'
import type { MapLibreMap } from 'maplibre-gl'
import DetailSheet from './components/DetailSheet'
import FiltersPanel from './components/Filters'
import SearchBar from './components/SearchBar'
import {
  ACCURACY_LIMIT_M, FALLBACK_CENTER, FALLBACK_LABEL, FALLBACK_ZOOM, USING_SEED_DATA,
} from './lib/config'
import { fetchDetail, fetchInView } from './lib/data'
import type { Bathroom, Bounds, Filters } from './lib/types'
import MapView from './map/MapView'
import 'maplibre-gl/dist/maplibre-gl.css'

type LocationStatus = 'idle' | 'locating' | 'ok' | 'coarse' | 'denied' | 'unsupported'

const LOCATION_HINT: Partial<Record<LocationStatus, string>> = {
  locating: 'Finding you…',
  coarse: `That fix is rough — search above if the map isn't where you are.`,
  denied: `Couldn't get your location. Showing ${FALLBACK_LABEL}; search above to move.`,
  unsupported: `This browser won't share a location. Showing ${FALLBACK_LABEL}.`,
}

export default function App() {
  const [bathrooms, setBathrooms] = useState<Bathroom[]>([])
  const [view, setView] = useState<Bounds | null>(null)
  const [filters, setFilters] = useState<Filters>({
    venues: new Set(), access: new Set(), hideTroubled: false,
  })
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<Partial<Bathroom> | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null)
  const [flyTo, setFlyTo] = useState<{ center: [number, number]; zoom: number; nonce: number } | null>(null)
  const [locStatus, setLocStatus] = useState<LocationStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [dark, setDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  )

  const requestId = useRef(0)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e: MediaQueryListEvent) => setDark(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  // Ask once on load. A refusal or a timeout is an ordinary outcome, not an
  // error state — the map still opens somewhere useful and search still works.
  useEffect(() => {
    if (!navigator.geolocation) { setLocStatus('unsupported'); return }
    setLocStatus('locating')
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const coarse = coords.accuracy > ACCURACY_LIMIT_M
        setUserLocation([coords.longitude, coords.latitude])
        setFlyTo({
          center: [coords.longitude, coords.latitude],
          zoom: coarse ? 12 : 15.5,
          nonce: Date.now(),
        })
        setLocStatus(coarse ? 'coarse' : 'ok')
      },
      () => setLocStatus('denied'),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
    )
  }, [])

  const onViewChange = useCallback((map: MapLibreMap) => {
    const b = map.getBounds()
    setView({
      minLng: b.getWest(), minLat: b.getSouth(),
      maxLng: b.getEast(), maxLat: b.getNorth(),
    })
  }, [])

  // Debounced, with a stale-response guard so a fast pan can't have an early
  // request land after a later one.
  useEffect(() => {
    if (!view) return
    const id = ++requestId.current
    const t = setTimeout(() => {
      fetchInView(view, filters)
        .then((rows) => { if (id === requestId.current) { setBathrooms(rows); setError(null) } })
        .catch((e: unknown) => {
          if (id !== requestId.current) return
          setError(e instanceof Error ? e.message : 'Could not load this area')
        })
    }, 250)
    return () => clearTimeout(t)
  }, [view, filters])

  useEffect(() => {
    if (!selectedId) { setDetail(null); return }
    let live = true
    setDetailLoading(true)
    fetchDetail(selectedId)
      .then((d) => { if (live) setDetail(d) })
      .catch(() => { if (live) setDetail(null) })
      .finally(() => { if (live) setDetailLoading(false) })
    return () => { live = false }
  }, [selectedId])

  // Patch the row in place so the pin re-colours the moment you report,
  // rather than waiting for the next viewport query.
  const onReported = useCallback((id: string, patch: Partial<Bathroom>) => {
    setBathrooms((rows) => rows.map((b) => (b.id === id ? { ...b, ...patch } : b)))
  }, [])

  const selected = bathrooms.find((b) => b.id === selectedId) ?? null
  const hint = LOCATION_HINT[locStatus]

  return (
    <div className="app">
      <div className="top-bar">
        <SearchBar
          near={userLocation ?? FALLBACK_CENTER}
          onPick={(p) => setFlyTo({ center: [p.lng, p.lat], zoom: 15.5, nonce: Date.now() })}
        />
        <FiltersPanel
          filters={filters}
          onChange={setFilters}
          open={filtersOpen}
          onToggle={() => setFiltersOpen((o) => !o)}
        />
      </div>

      <div className="banners">
        {USING_SEED_DATA && (
          <p className="banner banner-info">
            Running on bundled sample data for {FALLBACK_LABEL} — unverified, and no door
            codes. Add Supabase credentials to switch to live data.
          </p>
        )}
        {hint && <p className="banner">{hint}</p>}
        {error && <p className="banner banner-error">{error}</p>}
        {!error && view && bathrooms.length === 0 && (
          <p className="banner">Nothing mapped in this view yet.</p>
        )}
        {!error && bathrooms.length > 0 && (
          <p className="banner banner-count">
            {bathrooms.length} {bathrooms.length === 1 ? 'place' : 'places'} in view
          </p>
        )}
      </div>

      <MapView
        bathrooms={bathrooms}
        center={FALLBACK_CENTER}
        zoom={FALLBACK_ZOOM}
        flyTo={flyTo}
        userLocation={userLocation}
        dark={dark}
        onViewChange={onViewChange}
        onSelect={setSelectedId}
      />

      {selected && (
        <DetailSheet
          bathroom={selected}
          detail={detail}
          loading={detailLoading}
          near={userLocation}
          onClose={() => setSelectedId(null)}
          onReported={onReported}
        />
      )}
    </div>
  )
}
