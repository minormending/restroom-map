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

> **Dev-server caveat:** MapLibre parses GeoJSON and vector tiles in a web
> worker. Vite's dev server does not reliably serve that worker, so the map can
> render blank under `pnpm dev`. `pnpm build && pnpm preview` works correctly.
> See `src/map/worker.ts`.

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
