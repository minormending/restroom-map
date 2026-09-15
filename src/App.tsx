import { useCallback, useEffect, useRef, useState } from 'react'
import type { MapLibreMap } from 'maplibre-gl'
import AddPlace from './components/AddPlace'
import AuthButton from './components/AuthButton'
import DetailSheet from './components/DetailSheet'
import NearbyPrompt from './components/NearbyPrompt'
import PlaceList from './components/PlaceList'
import BuildTag from './components/BuildTag'
import Intro, { introSeen } from './components/Intro'
import Profile from './components/Profile'
import FiltersPanel from './components/Filters'
import SearchBar from './components/SearchBar'
import {
  ACCURACY_LIMIT_M, FALLBACK_CENTER, FALLBACK_LABEL, FALLBACK_ZOOM, USING_SEED_DATA,
} from './lib/config'
import { currentAccount, onAccountChange, type Account } from './lib/auth'
import { fetchBalance } from './lib/credits'
import { MAX_IN_VIEW, fetchDetail, fetchInView } from './lib/data'
import { rememberedAt } from './lib/lastSeen'
import { placeYouAreAt, type Fix } from './lib/nearby'
import { placesInView, relativeDays } from './lib/format'
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
    venues: new Set(), access: new Set(), hideTroubled: false, needs: new Set(),
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
  const [account, setAccount] = useState<Account | null>(null)
  const [adding, setAdding] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [balance, setBalance] = useState<number | null>(null)
  const [mapCenter, setMapCenter] = useState<[number, number]>(FALLBACK_CENTER)
  // The fix that decides whether to ask about a nearby place. Separate from
  // userLocation, which only has to be good enough to centre the map.
  const [fix, setFix] = useState<Fix | null>(null)
  const [waved, setWaved] = useState<Set<string>>(() => new Set())
  // These pins came from the local store, not the network.
  const [stale, setStale] = useState(false)
  // Map or list. Not a preference so much as an access route: the map is a
  // canvas, and a canvas has nothing in it for a screen reader.
  const [asList, setAsList] = useState(false)
  const [intro, setIntro] = useState(() => !introSeen())

  const requestId = useRef(0)

  // Recomputed on render rather than stored: it is only read while the stale
  // banner is up, and a timestamp cached in state would itself go stale.
  const savedAt = stale ? rememberedAt() : null
  const savedWhen = savedAt ? relativeDays(new Date(savedAt).toISOString()) : null

  // Nothing to confirm on bundled data, and nothing to ask while a sheet or a
  // form is already in front of the person.
  const standingAt = USING_SEED_DATA
    ? null
    : placeYouAreAt(fix, bathrooms.filter((b) => !waved.has(b.id)))

  useEffect(() => {
    void currentAccount().then(setAccount)
    return onAccountChange(setAccount)
  }, [])

  // Credits change as a side effect of other people's actions, so re-read on
  // sign-in and whenever this session does something that could earn.
  const refreshBalance = useCallback(() => {
    if (!account) { setBalance(null); return }
    void fetchBalance().then(setBalance).catch(() => setBalance(null))
  }, [account])

  useEffect(refreshBalance, [refreshBalance])

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e: MediaQueryListEvent) => setDark(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  // Ask once on load. A refusal or a timeout is an ordinary outcome, not an
  // error state — the map still opens somewhere useful and search still works.
  useEffect(() => {
    // Dev-only location override: ?at=<lat>,<lng>. Testing anything that
    // depends on where you are is otherwise impossible from a desk.
    // import.meta.env.DEV is a compile-time constant, so this whole branch is
    // eliminated from production builds — it cannot be triggered by a visitor.
    if (import.meta.env.DEV) {
      const at = new URLSearchParams(window.location.search).get('at')
      const [lat, lng] = (at ?? '').split(',').map(Number)
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        setUserLocation([lng, lat])
        setFix({ at: [lng, lat], accuracy: 5 })
        setFlyTo({ center: [lng, lat], zoom: 16.5, nonce: Date.now() })
        setLocStatus('ok')
        return
      }
    }

    if (!navigator.geolocation) { setLocStatus('unsupported'); return }
    setLocStatus('locating')
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const coarse = coords.accuracy > ACCURACY_LIMIT_M
        setUserLocation([coords.longitude, coords.latitude])
        setFix({ at: [coords.longitude, coords.latitude], accuracy: coords.accuracy })
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

  /**
   * Take a fresh fix when the tab comes back to the front.
   *
   * The whole point of the nearby prompt is to catch somebody standing at a
   * place, and the most likely way to arrive there is to look the place up,
   * walk to it, and come back to the app — by which time the fix taken on load
   * is from wherever the walk started. This does not move the map or touch
   * locStatus; it only updates the position the prompt reasons about, and it
   * asks for a cheap cached fix rather than powering up the GPS every time the
   * tab is touched.
   */
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      if (!navigator.geolocation) return
      navigator.geolocation.getCurrentPosition(
        ({ coords }) =>
          setFix({ at: [coords.longitude, coords.latitude], accuracy: coords.accuracy }),
        () => {},
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 30_000 },
      )
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  const onViewChange = useCallback((map: MapLibreMap) => {
    const c = map.getCenter()
    setMapCenter([c.lng, c.lat])
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
        .then(({ rows, stale: fromStore }) => {
          if (id !== requestId.current) return
          setBathrooms(rows)
          setStale(fromStore)
          setError(null)
        })
        .catch((e: unknown) => {
          if (id !== requestId.current) return
          setStale(false)
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
  // Two of these say "search above", and while a place is being added there is
  // no search above — the top bar gives its box up to the panel's address
  // field. An instruction pointing at something that is not on screen is worse
  // than no instruction, and none of this is what somebody placing a pin is
  // being asked about anyway.
  const hint = adding ? undefined : LOCATION_HINT[locStatus]

  return (
    <div className="app">
      {/* The map carries no visible heading, so a screen reader had nothing to
          announce on arrival. Visually hidden, but present in the tree. */}
      <h1 className="sr-only">Restroom Map — find a bathroom near you</h1>

      <div className="top-bar">
        {/* One search box at a time. While a place is being added the panel
            has its own address field, and two identically styled boxes doing
            different things — one moves the map, one commits a location — is
            a trap: the difference is invisible, and this one would still be
            holding whatever was last searched. The spacer keeps the controls
            beside it where they were rather than letting them jump left. */}
        {adding ? (
          <div className="search-gap" />
        ) : (
          <SearchBar
            near={userLocation ?? FALLBACK_CENTER}
            onPick={(p) => setFlyTo({ center: [p.lng, p.lat], zoom: 15.5, nonce: Date.now() })}
          />
        )}
        <button
          type="button"
          className="view-toggle"
          aria-pressed={asList}
          onClick={() => setAsList((v) => !v)}
        >
          {asList ? 'Map' : 'List'}
        </button>
        <FiltersPanel
          filters={filters}
          onChange={setFilters}
          open={filtersOpen}
          onToggle={() => setFiltersOpen((o) => !o)}
          resultCount={error ? null : bathrooms.length}
          resultCapped={bathrooms.length >= MAX_IN_VIEW}
        />
        {account && !adding && (
          <button type="button" className="add-place" onClick={() => { setSelectedId(null); setAdding(true) }}>
            Add a place
          </button>
        )}
        <AuthButton
          account={account}
          balance={balance}
          onOpenProfile={() => { setSelectedId(null); setProfileOpen(true) }}
        />
      </div>

      {/* Everything this app says about state lives here — the place count,
          the location hint, errors, and whether the pins are from the network
          or the offline store. Without a live region a screen reader announces
          none of it: the count changes as you pan and filter, and the reader
          is never told. Polite rather than assertive, because none of it
          should interrupt. */}
      <div
        className={`banners${filtersOpen ? ' is-filtering' : ''}${asList ? ' is-listing' : ''}`}
        role="status"
        aria-live="polite"
      >
        {USING_SEED_DATA && (
          <p className="banner banner-info">
            Running on bundled sample data for {FALLBACK_LABEL} — unverified, and no door
            codes. Add Supabase credentials to switch to live data.
          </p>
        )}
        {hint && <p className="banner">{hint}</p>}
        {error && <p className="banner banner-error">{error}</p>}
        {stale && (
          <p className="banner banner-stale">
            No connection — showing places saved from your last visit
            {savedWhen ? `, ${savedWhen}` : ''}.
          </p>
        )}
        {!error && view && bathrooms.length === 0 && (
          <p className="banner">Nothing mapped in this view yet.</p>
        )}
        {!error && bathrooms.length > 0 && (
          <p className="banner banner-count">
            {placesInView(bathrooms.length, bathrooms.length >= MAX_IN_VIEW)}
          </p>
        )}
      </div>

      {asList && (
        <PlaceList
          bathrooms={bathrooms}
          near={userLocation}
          onSelect={setSelectedId}
          capped={bathrooms.length >= MAX_IN_VIEW}
        />
      )}

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

      {profileOpen && account && (
        <Profile account={account} onClose={() => setProfileOpen(false)} />
      )}

      <div className="page-foot">
        <nav className="legal-links" aria-label="Site information">
          <a href="privacy.html">Privacy</a>
          <a href="terms.html">Terms</a>
        </nav>
        <button type="button" className="what-is-this" onClick={() => setIntro(true)}>
          What is this?
        </button>
        <BuildTag />
      </div>

      {adding && <div className="crosshair" aria-hidden="true" />}

      {adding && (
        <AddPlace
          center={mapCenter}
          onFlyTo={(center, zoom) => setFlyTo({ center, zoom, nonce: Date.now() })}
          onCancel={() => setAdding(false)}
          onAdded={(id) => {
            setAdding(false)
            refreshBalance()
            // Re-query so the new pin appears, then open it.
            setView((v) => (v ? { ...v } : v))
            setSelectedId(id)
          }}
        />
      )}

      {standingAt && !intro && !selected && !adding && !profileOpen && (
        <NearbyPrompt
          bathroom={standingAt}
          near={userLocation}
          onReported={onReported}
          onDismiss={(id) => setWaved((w) => new Set(w).add(id))}
        />
      )}

      {intro && <Intro onDismiss={() => setIntro(false)} />}

      {selected && !adding && !profileOpen && (
        <DetailSheet
          bathroom={selected}
          detail={detail}
          loading={detailLoading}
          near={userLocation}
          account={account}
          onClose={() => setSelectedId(null)}
          onReported={onReported}
          onSpent={refreshBalance}
        />
      )}
    </div>
  )
}
