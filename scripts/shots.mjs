#!/usr/bin/env node
/**
 * Screenshots of named states, for putting before-and-after in a pull request.
 *
 *   node scripts/shots.mjs                  every state, to shots/
 *   node scripts/shots.mjs menu feedback    just those
 *   node scripts/shots.mjs --out before     somewhere else
 *   node scripts/shots.mjs --width 1280     desktop rather than a phone
 *
 * A reviewer looking at a CSS diff cannot tell whether it is right. Two
 * pictures answer that in a second, and this is how the triage process gets
 * them without a person at the keyboard.
 *
 * WHY THIS EXISTS SEPARATELY FROM ui-audit
 *
 * The audit compares this app against a baseline and fails when they differ.
 * That is a different job from *showing* somebody the difference, and it lives
 * in another repo with its own release cadence. These are this project's
 * states, described in this project, so a screen added here can be screenshotted
 * here in the same commit.
 *
 * DETERMINISM
 *
 * Built against a fixture host that does not exist, with every Supabase call
 * answered from fixtures/. No network, no live data, no writes — a screenshot
 * run must never be able to touch the real map. Date and Math.random are frozen
 * before any page script runs, and the map canvas is hidden: its tiles come
 * from a CDN and will never paint the same way twice.
 */
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join, resolve, extname } from 'node:path'
import { chromium } from 'playwright'
import { ROOT } from './lib/connect.mjs'

const DIST = join(ROOT, 'dist')
const BASE = '/restroom-map/'

/**
 * A fabricated session, so the states behind sign-in can be photographed.
 *
 * Nothing real: a made-up token for a project that does not exist, on an
 * origin where every request is already intercepted. supabase-js keys its
 * storage on the host, hence `sb-fixture-…`.
 */
const SESSION = {
  'sb-fixture-auth-token': JSON.stringify({
    access_token: 'shots-not-a-real-token',
    token_type: 'bearer',
    expires_at: 4102444800,
    expires_in: 3600,
    refresh_token: 'shots-not-a-real-token',
    user: {
      id: '00000000-0000-4000-8000-00000000f0a0',
      aud: 'authenticated',
      role: 'authenticated',
      email: 'shots@example.invalid',
      app_metadata: {},
      user_metadata: { full_name: 'Screenshot' },
      created_at: '2026-01-01T00:00:00Z',
    },
  }),
}

/** Somewhere with places around it, and close enough to one to be "at" it. */
const AT = { latitude: 40.705277, longitude: -74.005516, accuracy: 8 }

/**
 * The states worth showing in a pull request.
 *
 * `do` is a list of steps: a string clicks, {fill, text} types. Same shape the
 * audit uses, for the same reason — most of this app has no URL of its own,
 * and a screenshot of the front door proves nothing about the screen you
 * changed.
 */
const STATES = {
  home: { do: ['.intro-go'] },
  intro: { do: [] },
  filters: { do: ['.intro-go', '.filters-toggle'] },
  list: { do: ['.intro-go', '.view-toggle'] },
  detail: { do: ['.intro-go', '.view-toggle', '.place-list li button'] },
  menu: { do: ['.intro-go', '.menu-open'] },
  feedback: { do: ['.intro-go', '.menu-open', '.menu-feedback'] },
  nearby: { do: ['.intro-go'], at: AT },
  'signed-in': { do: ['.intro-go'], session: true },
  add: { do: ['.intro-go', '.add-place'], session: true },
  'add-describe': {
    do: ['.intro-go', '.add-place', '.placing-actions .btn-primary'],
    session: true,
  },
}

const args = process.argv.slice(2)

/** Flags that consume the next argument, so it is not mistaken for a state. */
const VALUED = new Set(['--out', '--width', '--height'])

const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? fallback : args[i + 1]
}
// resolve, not join: pr-shots.mjs hands this an absolute temp directory.
const outDir = resolve(ROOT, opt('out', 'shots'))
const width = Number(opt('width', 375))
const height = Number(opt('height', 812))

const positional = args.filter((a, i) =>
  !a.startsWith('--') && !VALUED.has(args[i - 1]))

const unknown = positional.filter((a) => !STATES[a])
if (unknown.length) {
  console.error(`unknown state(s): ${unknown.join(', ')}`)
  console.error(`known: ${Object.keys(STATES).join(', ')}`)
  process.exit(1)
}
const states = positional.length ? positional : Object.keys(STATES)

// --- build ------------------------------------------------------------------

const run = (cmd, cmdArgs, env) => new Promise((resolve, reject) => {
  const p = spawn(cmd, cmdArgs, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...env } })
  p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))))
})

console.log('building against the fixture host…')
await run('pnpm', ['build'], {
  VITE_SUPABASE_URL: 'https://fixture.supabase.co',
  VITE_SUPABASE_ANON_KEY: 'sb_publishable_fixture_not_a_real_key',
  // Pinned, so the version tag is not a difference between two shots.
  BUILD_ID: 'shots',
})

// --- serve ------------------------------------------------------------------

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
}

const server = createServer((req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  if (path.startsWith(BASE)) path = path.slice(BASE.length - 1)
  let file = join(DIST, path)
  try {
    const body = readFileSync(file)
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    // Single-page app: anything unresolved is a route.
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(readFileSync(join(DIST, 'index.html')))
  }
})
await new Promise((r) => server.listen(0, r))
const origin = `http://localhost:${server.address().port}`

// --- shoot ------------------------------------------------------------------

const fixture = readFileSync(join(ROOT, 'fixtures', 'bathrooms-in-view.json'), 'utf8')
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch()
const taken = []

for (const name of states) {
  const state = STATES[name]
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    // The tiles are the only thing here that comes off the network, and a
    // screenshot run must not be able to reach anything real.
    serviceWorkers: 'block',
    ...(state.at ? { permissions: ['geolocation'], geolocation: state.at } : {}),
  })

  await context.route('**/*', (route) => {
    const url = route.request().url()
    if (url.startsWith(origin)) return route.continue()
    if (url.includes('bathrooms_in_view')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: fixture })
    }
    if (url.includes('supabase.co')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    }
    // Tiles, fonts, anything else: refused rather than fetched.
    return route.abort()
  })

  const page = await context.newPage()

  await page.addInitScript((session) => {
    try {
      for (const [k, v] of Object.entries(session)) localStorage.setItem(k, v)
    } catch { /* private mode */ }
    const FIXED = new Date('2026-01-01T00:00:00Z').getTime()
    Date.now = () => FIXED
    const Real = Date
    // eslint-disable-next-line no-global-assign
    Date = class extends Real {
      constructor(...a) { super(...(a.length ? a : [FIXED])) }
      static now() { return FIXED }
    }
    let seed = 0x2f6e2b1
    Math.random = () => {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5
      return (seed >>> 0) / 0x100000000
    }
  }, state.session ? SESSION : {})

  await page.goto(`${origin}${BASE}`, { waitUntil: 'load' })
  await page.waitForSelector('.banner-count', { state: 'visible', timeout: 15_000 })

  // Motion off before pressing anything: a control still easing into place is
  // not stable, and a click that races a transition fails on a busy machine.
  await page.addStyleTag({
    content: `*, *::before, *::after {
      animation-duration: 0s !important; transition-duration: 0s !important;
      caret-color: transparent !important;
    }`,
  })
  // The canvas never paints the same way twice — its tiles are refused above,
  // so what is left is a grey rectangle that would only add noise to a diff.
  await page.addStyleTag({ content: '.maplibregl-canvas { visibility: hidden !important; }' })

  for (const step of state.do) {
    if (typeof step === 'string') await page.locator(step).first().click({ timeout: 10_000 })
    else await page.locator(step.fill).first().fill(step.text, { timeout: 10_000 })
  }

  await page.evaluate(() => document.fonts.ready)
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))

  const file = join(outDir, `${name}.png`)
  await page.screenshot({ path: file, fullPage: false })
  taken.push(name)
  console.log(`  ${name}`)
  await context.close()
}

await browser.close()
server.close()

writeFileSync(join(outDir, 'states.json'),
  JSON.stringify({ width, height, states: taken }, null, 2))
console.log(`\n${taken.length} shots at ${width}x${height} → ${outDir}`)
