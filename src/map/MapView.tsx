import './worker'
import { useEffect, useRef } from 'react'
import {
  GeoJSONSource,
  MapLibreMap,
  Marker,
  NavigationControl,
  type MapLayerMouseEvent,
} from 'maplibre-gl'
import type { FeatureCollection, Point as GeoPoint } from 'geojson'
import { MAP_STYLE_DARK, MAP_STYLE_LIGHT } from '../lib/config'
import { isConfirmed, isTroubled, type Bathroom } from '../lib/types'
import { BADGE_ICON_ID, pinIconId, registerIcons } from './icons'

const SOURCE = 'bathrooms'
const CLUSTER_INK = '#33414D'

interface Props {
  bathrooms: Bathroom[]
  center: [number, number]
  zoom: number
  flyTo: { center: [number, number]; zoom: number; nonce: number } | null
  userLocation: [number, number] | null
  dark: boolean
  onViewChange: (map: MapLibreMap) => void
  onSelect: (id: string) => void
}

function toGeoJSON(rows: Bathroom[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: rows.map((b) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [b.lng, b.lat] },
      properties: {
        id: b.id,
        // Precomputed so the style expressions stay trivial to read.
        icon: pinIconId(b.venue_type, b.access_kind, isConfirmed(b)),
        troubled: isTroubled(b),
      },
    })),
  }
}

/** Adds the source and the three layers. Re-run after every style load. */
function installLayers(map: MapLibreMap, data: FeatureCollection) {
  if (map.getSource(SOURCE)) return

  map.addSource(SOURCE, {
    type: 'geojson',
    data,
    cluster: true,
    clusterRadius: 44,
    clusterMaxZoom: 15,
  })

  map.addLayer({
    id: 'clusters',
    type: 'circle',
    source: SOURCE,
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': CLUSTER_INK,
      'circle-opacity': 0.92,
      'circle-stroke-color': '#FFFFFF',
      'circle-stroke-width': 2,
      'circle-radius': ['step', ['get', 'point_count'], 16, 10, 21, 30, 27],
    },
  })

  map.addLayer({
    id: 'cluster-count',
    type: 'symbol',
    source: SOURCE,
    filter: ['has', 'point_count'],
    layout: {
      'text-field': ['get', 'point_count_abbreviated'],
      'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
      'text-size': 13,
    },
    paint: { 'text-color': '#FFFFFF' },
  })

  map.addLayer({
    id: 'pins',
    type: 'symbol',
    source: SOURCE,
    filter: ['!', ['has', 'point_count']],
    layout: {
      'icon-image': ['get', 'icon'],
      'icon-anchor': 'bottom',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
  })

  map.addLayer({
    id: 'trouble-badges',
    type: 'symbol',
    source: SOURCE,
    filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'troubled'], true]],
    layout: {
      'icon-image': BADGE_ICON_ID,
      'icon-anchor': 'bottom',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
    // Screen-pixel offset is predictable in a way icon-offset is not.
    paint: { 'icon-translate': [11, -31] },
  })
}

export default function MapView({
  bathrooms, center, zoom, flyTo, userLocation, dark, onViewChange, onSelect,
}: Props) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const dataRef = useRef<FeatureCollection>(toGeoJSON([]))
  const userMarker = useRef<Marker | null>(null)

  // Create the map once. Style swaps are handled separately so that panning
  // state survives a theme change.
  useEffect(() => {
    if (!container.current) return

    const map = new MapLibreMap({
      container: container.current,
      style: dark ? MAP_STYLE_DARK : MAP_STYLE_LIGHT,
      center,
      zoom,
      attributionControl: { compact: true },
    })
    mapRef.current = map
    // Dev-only handle for poking at layers and rendered features in the console.
    if (import.meta.env.DEV) (window as unknown as { __map?: MapLibreMap }).__map = map

    map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right')

    // Tile and glyph failures are otherwise silent, which turns a network
    // problem into an unexplained blank map.
    map.on('error', (e) => {
      console.error('[map]', e.error?.message ?? e)
    })

    const onStyleLoad = async () => {
      // A failed icon must not cost us the whole map: install the layers
      // either way so clusters and hit-testing still work.
      try {
        await registerIcons(map)
      } catch (err) {
        console.error('[map] icon registration failed', err)
      }
      installLayers(map, dataRef.current)
      // setStyle() drops every custom source, and the rows we already hold
      // won't change again on their own — so push them back explicitly.
      ;(map.getSource(SOURCE) as GeoJSONSource | undefined)?.setData(dataRef.current)
    }
    map.on('style.load', onStyleLoad)

    const emitView = () => onViewChange(map)
    map.on('moveend', emitView)
    // Bounds are valid the moment the map exists. Waiting on 'load' delays the
    // first query behind tile fetches, and strands it entirely if tiles stall.
    emitView()


    const openFeature = (e: MapLayerMouseEvent) => {
      const id = e.features?.[0]?.properties?.id
      if (typeof id === 'string') onSelect(id)
    }
    map.on('click', 'pins', openFeature)

    map.on('click', 'clusters', (e: MapLayerMouseEvent) => {
      const feature = e.features?.[0]
      if (!feature) return
      const src = map.getSource(SOURCE) as GeoJSONSource
      void src
        .getClusterExpansionZoom(feature.properties.cluster_id as number)
        .then((z: number) => {
          map.easeTo({ center: (feature.geometry as GeoPoint).coordinates as [number, number], zoom: z })
        })
    })

    for (const layer of ['pins', 'clusters']) {
      map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer' })
      map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = '' })
    }

    return () => {
      map.remove()
      mapRef.current = null
    }
    // Deliberately mount-only: later prop changes are handled by the effects
    // below so the map is never torn down mid-session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Push new rows into the existing source without touching the viewport.
  useEffect(() => {
    dataRef.current = toGeoJSON(bathrooms)
    const src = mapRef.current?.getSource(SOURCE) as GeoJSONSource | undefined
    src?.setData(dataRef.current)
  }, [bathrooms])

  const themeSettled = useRef(false)
  useEffect(() => {
    // The map is constructed with the right style already; only a genuine
    // theme change should pay for a reload.
    if (!themeSettled.current) { themeSettled.current = true; return }
    const map = mapRef.current
    if (!map) return
    // setStyle wipes custom sources and layers; style.load re-installs them.
    map.setStyle(dark ? MAP_STYLE_DARK : MAP_STYLE_LIGHT)
  }, [dark])

  useEffect(() => {
    if (!flyTo || !mapRef.current) return
    mapRef.current.flyTo({ center: flyTo.center, zoom: flyTo.zoom, essential: true })
  }, [flyTo])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (!userLocation) {
      userMarker.current?.remove()
      userMarker.current = null
      return
    }
    if (!userMarker.current) {
      const el = document.createElement('div')
      el.className = 'user-dot'
      el.setAttribute('aria-hidden', 'true')
      userMarker.current = new Marker({ element: el }).setLngLat(userLocation).addTo(map)
    } else {
      userMarker.current.setLngLat(userLocation)
    }
  }, [userLocation])

  return <div ref={container} className="map-canvas" />
}
