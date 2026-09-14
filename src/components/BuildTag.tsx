import { useState } from 'react'

/**
 * Which build you are actually looking at, and a way out when it is the wrong
 * one.
 *
 * The service worker precaches the bundle, so a deploy does not reach an open
 * tab until the SW swaps — and a hard refresh does not force it. Ctrl+Shift+R
 * bypasses the HTTP cache; the service worker still controls the navigation
 * and still answers with what it has. There is no browser control that fixes
 * this, which is why the README has carried a console snippet for it and why
 * that snippet should not be the only way.
 *
 * So: the id is here to be read out when something looks wrong, and clicking
 * it does what the snippet did — unregister every worker, drop every Cache API
 * entry, reload. localStorage is deliberately untouched: the saved places that
 * make the map work offline live there, and throwing them away to fix a stale
 * bundle would be a poor trade.
 */
export default function BuildTag() {
  const [clearing, setClearing] = useState(false)

  // A count renders as a version; anything else (a git-less build) is shown
  // as-is, so it cannot be mistaken for one.
  const label = /^\d+$/.test(__BUILD_ID__) ? `v${__BUILD_ID__}` : __BUILD_ID__

  const refresh = async () => {
    setClearing(true)
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations()
        await Promise.all(regs.map((r) => r.unregister()))
      }
      if ('caches' in window) {
        const keys = await caches.keys()
        await Promise.all(keys.map((k) => caches.delete(k)))
      }
    } catch {
      // Private windows and blocked storage throw here. Reloading is still
      // worth doing — it is the half that sometimes works on its own.
    }
    location.reload()
  }

  return (
    <button
      type="button"
      className="build-tag"
      onClick={() => void refresh()}
      disabled={clearing}
      title="Reload and fetch the newest version"
      // "Version v66" stutters; the spoken label takes the bare number.
      aria-label={`Version ${__BUILD_ID__}. Reload and fetch the newest version.`}
    >
      {clearing ? 'updating…' : label}
    </button>
  )
}
