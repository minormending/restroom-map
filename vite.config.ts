import { execSync } from 'node:child_process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * Which build this is, so a person looking at a stale page can say so.
 *
 * The service worker precaches the bundle, and a hard refresh does not go
 * round it: the SW still controls the navigation and serves what it has. That
 * makes "am I looking at the current version" a question the page has to be
 * able to answer, because the browser's own controls cannot.
 *
 * The commit sha in CI and locally; a timestamp if git is unavailable, which
 * is still enough to tell two builds apart.
 */
function buildId(): string {
  const sha = process.env.GITHUB_SHA
  if (sha) return sha.slice(0, 7)
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim()
  } catch {
    return new Date().toISOString().slice(0, 16).replace('T', ' ')
  }
}

// GitHub Pages serves project sites from /<repo>/, so the bundle must be
// built with a matching base. Override with BASE_PATH when deploying elsewhere.
const base = process.env.BASE_PATH ?? '/restroom-map/'

export default defineConfig({
  base,
  define: { __BUILD_ID__: JSON.stringify(buildId()) },
  // MapLibre instantiates its worker with { type: 'module' }.
  worker: { format: 'es' },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Restroom Map',
        short_name: 'Restrooms',
        description: 'Find a bathroom near you.',
        theme_color: '#1F4E9C',
        background_color: '#EDF0F2',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml' },
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        // These are real files, not app routes — don't hand them index.html.
        navigateFallbackDenylist: [/privacy\.html$/, /terms\.html$/],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        // Map tiles are large and change rarely; cache them but cap the shelf.
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/(tiles\.)?basemaps\.cartocdn\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'basemap-tiles',
              expiration: { maxEntries: 600, maxAgeSeconds: 60 * 60 * 24 * 14 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
})
