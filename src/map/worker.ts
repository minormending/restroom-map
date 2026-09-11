import { setWorkerUrl } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'

/**
 * MapLibre 6 derives its worker URL at runtime from `import.meta.url`:
 *
 *   const t = url.endsWith('-dev.mjs') ? 'maplibre-gl-worker-dev.mjs' : 'maplibre-gl-worker.mjs'
 *   return new URL(`./${t}`, url).href
 *
 * That string is invisible to any bundler, so the worker is never emitted and
 * the built app requests a file that isn't there. The request 404s to the SPA
 * shell, the worker never starts, and because MapLibre parses GeoJSON and
 * vector tiles in that worker the map renders nothing at all — no error, just
 * a blank canvas. Hand it a URL Vite has actually built.
 *
 * Importing this module for its side effect must happen before any Map is
 * constructed.
 */
setWorkerUrl(workerUrl)
