const env = import.meta.env

export const SUPABASE_URL = env.VITE_SUPABASE_URL ?? ''
export const SUPABASE_ANON_KEY = env.VITE_SUPABASE_ANON_KEY ?? ''

/** With no Supabase project configured the app runs off bundled seed data. */
export const USING_SEED_DATA = !SUPABASE_URL || !SUPABASE_ANON_KEY

export const MAP_STYLE_LIGHT =
  env.VITE_MAP_STYLE_LIGHT ?? 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'
export const MAP_STYLE_DARK =
  env.VITE_MAP_STYLE_DARK ?? 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
export const GEOCODER_URL =
  env.VITE_GEOCODER_URL ?? 'https://photon.komoot.io/api/'

/** Where the map opens when geolocation is unavailable or declined. */
export const FALLBACK_CENTER: [number, number] = [-74.0090, 40.7110]
export const FALLBACK_ZOOM = 14.2
export const FALLBACK_LABEL = 'Lower Manhattan'

/** Above this, a browser fix is too coarse to centre a walking-distance map. */
export const ACCURACY_LIMIT_M = 5000
