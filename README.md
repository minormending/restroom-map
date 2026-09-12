# Restroom Map

A crowdsourced bathroom finder. Static frontend on GitHub Pages, Postgres +
PostGIS behind it. The browser is treated as hostile throughout: it can read
public data and propose writes, but it never decides whether a write is
legitimate.

**Milestone M0 — read-only map.** The question this milestone exists to answer:
*can you find a bathroom faster here than in Google Maps?* No accounts, no
submissions, no credits. Those are M2 and M3.

## Running it

```bash
pnpm install
pnpm dev
```

Opens on the bundled Lower Manhattan sample data — no Supabase project needed.
Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env` and the same code
switches to live reads.

> **Testing something location-dependent?** In dev only, `?at=<lat>,<lng>`
> overrides the browser's position — e.g.
> `http://localhost:5173/restroom-map/?at=40.7115,-74.0111`. The branch is
> behind `import.meta.env.DEV`, a compile-time constant, so it is eliminated
> from production builds entirely.

> **If the dev server serves stale code** after an edit, its watcher has missed
> the change — restart it. This bites often enough to be worth knowing before
> you spend an hour debugging a fix that was never actually served.

> **Seeing stale content after a rebuild or deploy?** The PWA service worker
> precaches the bundle, so a fresh build can keep serving the old one. The SW
> now ships `skipWaiting` + `clientsClaim`, so updates apply on the next reload
> — but if you're ever unsure what you're looking at, run this in the browser
> console and reload:
>
> ```js
> for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister()
> for (const k of await caches.keys()) await caches.delete(k)
> ```
>
> To confirm which bundle is live, compare the hash in the page source against
> `dist/index.html`.

## Database

SQL in `supabase/migrations/` runs in order — paste into the Supabase SQL editor
or `supabase db push` if you have the CLI.

| File | What it does |
| --- | --- |
| `20260911000001_init.sql` | Tables, enums, indexes |
| `20260911000002_rls.sql` | Row-level security and its guard helpers |
| `20260911000003_rpc.sql` | Confidence view, viewport query, code gate |
| `20260911000004_grants.sql` | Data API grants (create the project with auto-expose OFF) |
| `seed.sql` | 30 Lower Manhattan starter rows (generated) |

### Running SQL

`scripts/db.mjs` connects directly to Postgres, so migrations and one-off
queries don't have to go through the dashboard SQL editor.

```bash
pnpm db:status                        # applied vs pending migrations
pnpm db:migrate                       # apply pending ones, each in a transaction
pnpm db:query "select count(*) from bathrooms"
node scripts/db.mjs file supabase/seed.sql
```

It needs one line in `.env`:

```
SUPABASE_DB_PASSWORD=your-database-password
```

Host, port and user are derived from `VITE_SUPABASE_URL`, and the password is
passed to the driver as a field rather than interpolated into a URL, so
characters like `@` and `:` need no escaping. Set `SUPABASE_DB_URL` instead if
you prefer a full connection string, or `SUPABASE_DB_HOST` if the derived
pooler host is wrong.

Unlike the publishable key, this password is a genuine secret: full database
access, bypassing RLS. `.env` is gitignored so it stays on your machine.

Note the direct-connection host (`db.<ref>.supabase.co`) is IPv6-only, which is
why this uses the pooler.

Migrations are tracked in a `schema_migrations` table by filename and checksum.
If the schema was built by hand before this tool existed, record the existing
files as already applied instead of re-running them:

```bash
node scripts/db.mjs migrate --baseline
```

Regenerate the seed after editing `src/data/seed.json`:

```bash
node scripts/seed-to-sql.mjs
```

Two design points worth not undoing:

- **Codes are a history table**, not a column. Codes rotate; a row with no
  supersession history can't tell you whether it's still good.
- **Credits are an append-only ledger**, never a mutable balance. You will need
  to claw back fraud, and you cannot audit a number.

`can_view_code()` returns `true` for everyone in v0. Tiered access is a change
to that one function — no migration, no client rewrite.

## Marker encoding

Three orthogonal dimensions across three visual channels, because one icon per
combination is unreadable at a glance and glance is the whole use case.

| Channel | Encodes |
| --- | --- |
| Glyph | Venue type — bag, tree, carriage, cup, building… |
| Fill | Access — green open, amber code required, blue ask staff, violet customers only, grey unverified |
| Badge | Recent trouble reports outweighing confirmations |

Pin colours are deliberately theme-independent: they sit on a basemap that is
light or near-black depending on the viewer, so each hue holds contrast on both.

## Deploying

Pushing to `main` builds and publishes via `.github/workflows/deploy.yml`.
`BASE_PATH` is derived from the repository name, so a fork or rename won't ship
a bundle with wrong asset paths.

For live data, add repository **variables** (not secrets — both values are
public by design and get baked into the bundle): `VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY`.

## Things to settle before this goes anywhere public

- Privacy policy and terms. Google's OAuth consent screen requires a privacy
  policy URL for production apps, so this lands with M2 at the latest.
- A business removal path — that's what `flags.contact_email` is for.
- Tile provider. CARTO's public styles need no key and are fine at this scale,
  but read their terms before real traffic.
- Whether to seed from OpenStreetMap at all. ODbL has share-alike provisions on
  derived databases; `bathrooms.osm_id` exists so imports stay separable, but
  decide before the first import, not after.
