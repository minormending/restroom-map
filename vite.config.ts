import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages serves project sites from /<repo>/, so the bundle must be
// built with a matching base. Override with BASE_PATH when deploying elsewhere.
const base = process.env.BASE_PATH ?? '/restroom-map/'

export default defineConfig({
  base,
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
