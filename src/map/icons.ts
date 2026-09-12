import type { Map as MapLibreMap } from 'maplibre-gl'
import { VENUE_TYPES, type Fill, type VenueType } from '../lib/types'

/**
 * Three visual channels, so the reader decodes a pin at a glance instead of
 * matching it against a legend:
 *   glyph -> venue type      fill -> access kind      badge -> trouble state
 *
 * Pin colours are deliberately theme-independent. They sit on a basemap that
 * is light grey or near-black depending on the viewer, so each hue is picked
 * to hold contrast against both, and the disc behind the glyph stays white.
 */
const FILL_COLORS: Record<Fill, string> = {
  open: '#168A52',
  code_required: '#C8811A',
  ask_staff: '#2C6BD6',
  customers_only: '#8A4FBF',
  unverified: '#94A0A9',
}

export const FILLS = Object.keys(FILL_COLORS) as Fill[]

/** Each glyph is drawn in an 11×11 box, translated under the pin head. */
const GLYPHS: Record<VenueType, string> = {
  store:
    'M2 3.4h7v5.8H2z M3.9 3.4a1.6 1.6 0 0 1 3.2 0H6a0.5 0.5 0 0 0-1 0z',
  restaurant:
    'M1.8 7.6a3.7 3.7 0 0 1 7.4 0z M1.3 8.2h8.4v1H1.3z',
  cafe:
    'M2 2.6h4.6v3.3a2.3 2.3 0 0 1-4.6 0z M6.9 3.3h0.8a1.4 1.4 0 0 1 0 2.7h-0.8v-1h0.8a0.4 0.4 0 0 0 0-0.7h-0.8z M1.7 9h5.2v0.9H1.7z',
  gas_station:
    'M1.9 1.9h4.2v7.3H1.9z M6.9 3.1h0.9v3.4a0.75 0.75 0 0 0 1.5 0V4.7h0.8v1.8a1.55 1.55 0 0 1-3.1 0z',
  park:
    'M4.4 0.6a2.9 2.9 0 1 1 0 5.8 2.9 2.9 0 0 1 0-5.8z M3.8 5.9h1.2v3.3H3.8z',
  transit:
    'M1.9 1.8h5.2v3.4H1.9z M1.9 5.9h5.2a1 1 0 0 1-1 1H2.9a1 1 0 0 1-1-1z M2.3 7.4h1v1.4h-1z M6 7.4h1v1.4H6z',
  public_facility:
    'M2.1 2.1h4.8v7H2.1z',
  library:
    'M1.7 2.4h3.2v6.4H1.7z M5.9 2.4h3.2v6.4H5.9z M5.1 2h0.7v7h-0.7z',
  hotel:
    'M1.7 4.2h1.1v4.8H1.7z M2.8 6.1h5.4a1.1 1.1 0 0 1 1.1 1.1v1.8H2.8z M3.5 4.6h1.9v1.2H3.5z',
  other:
    'M4.4 2.1a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.2z',
}

/** Cut-outs punched back through the glyph in white, e.g. a door or a window. */
const GLYPH_HOLES: Partial<Record<VenueType, string>> = {
  public_facility: 'M3.9 6.1h1.2v3H3.9z',
  gas_station: 'M2.6 2.6h2.8v1.9H2.6z',
}

const PIN_BODY =
  'M16 1.6C8.6 1.6 2.6 7.6 2.6 15c0 9.7 13.4 26.8 13.4 26.8S29.4 24.7 29.4 15c0-7.4-6-13.4-13.4-13.4z'

function pinSvg(venue: VenueType, fill: Fill): string {
  const color = FILL_COLORS[fill]
  const hole = GLYPH_HOLES[venue]
  // An earlier version dashed the outline of unverified pins. At the size a
  // pin actually renders on a phone that reads as a torn edge, not a style —
  // and grey against four saturated hues already says "nobody has confirmed
  // this". Solid outline for every pin.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="88" viewBox="0 0 32 44">
<path d="${PIN_BODY}" fill="${color}" stroke="#FFFFFF" stroke-width="1.6"/>
<circle cx="16" cy="15" r="6.7" fill="#FFFFFF"/>
<g transform="translate(11.6,10.6)"><path d="${GLYPHS[venue]}" fill="${color}"/>${
    hole ? `<path d="${hole}" fill="#FFFFFF"/>` : ''
  }</g>
</svg>`
}

const BADGE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 18 18">
<circle cx="9" cy="9" r="7.6" fill="#B23131" stroke="#FFFFFF" stroke-width="1.8"/>
<path d="M8.1 4.2h1.8l-0.32 5.2H8.42z M9 10.9a1.05 1.05 0 1 1 0 2.1 1.05 1.05 0 0 1 0-2.1z" fill="#FFFFFF"/>
</svg>`

function rasterise(svg: string, w: number, h: number): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image(w, h)
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Marker icon failed to rasterise'))
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  })
}

export const pinIconId = (venue: VenueType, fill: Fill) => `pin-${venue}-${fill}`
export const BADGE_ICON_ID = 'badge-trouble'

/** Registers all 51 images. Idempotent, so a style reload can call it again. */
export async function registerIcons(map: MapLibreMap): Promise<void> {
  const jobs: Promise<void>[] = []

  const add = (id: string, svg: string, w: number, h: number) => {
    if (map.hasImage(id)) return
    jobs.push(
      rasterise(svg, w, h).then((img) => {
        // The style may have reloaded while we were rasterising.
        if (!map.hasImage(id)) map.addImage(id, img, { pixelRatio: 2 })
      }),
    )
  }

  for (const venue of VENUE_TYPES) {
    for (const fill of FILLS) add(pinIconId(venue, fill), pinSvg(venue, fill), 64, 88)
  }
  add(BADGE_ICON_ID, BADGE_SVG, 36, 36)

  await Promise.all(jobs)
}

/** Shared with the legend and detail sheet so one table drives every surface. */
export const fillColor = (fill: Fill) => FILL_COLORS[fill]
