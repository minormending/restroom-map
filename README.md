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

### Tiered codes

`can_view_code()` is the single gate. As of migration 011 a code costs
`unlock_cost()` credits, with three carve-outs: a place you submitted, a code
you submitted, and anything you have already unlocked are always free to you.

To turn gating **off** again, that is still one function:

```sql
create or replace function can_view_code(p_user uuid, p_bathroom uuid)
returns boolean language sql stable as $$ select true; $$;
```

Nothing else changes — no data migration, no client rewrite. Prices live in
`unlock_cost()`.

## Testing

```bash
pnpm test                          # every suite
pnpm test credits                  # suites matching a name
node scripts/test.mjs --verbose    # list passing tests too
```

Three suites — `harness`, `credits`, `codes` — over the two places where a
silent bug costs somebody money or hands out a code they did not pay for.

They run against the project database, because that is where the code under
test lives: Postgres functions sitting on PostGIS and Supabase's auth schema,
with no local Postgres and no container runtime on this machine. A mock of all
that would only ever test the mock.

So the isolation is real rather than promised. Every test runs inside a
transaction that is **always** rolled back — on pass, on failure, and on
process death, where the connection drops and Postgres does it for us. Tests
never touch existing rows: they create their own users and places, and the
places sit at Null Island so `submit_bathroom`'s 20m duplicate check cannot
collide with anything real.

That is the design. The enforcement is the canary that runs after every
rollback. It counts rows carrying the test marker, and re-hashes every function
body in `public` against the hash taken before the run. If either has moved,
the run stops on that test rather than carrying on against a live map. Both
paths have been checked by pointing them at things that do exist.

The function-body half matters more than it looks: the `codes` suite re-enables
the M4 body of `can_view_code()` inside its transaction, because a gate that is
currently off (migration 013) is otherwise a reversible decision nobody ever
exercises. One that leaked would put a paywall on every code on the map without
anything visibly breaking.

One thing deliberately not covered: two sessions racing the same balance.
`unlock_code()` locks the buyer's profile row before reading it, but proving
that needs a second session that can see the buyer — which needs a commit, and
nothing here commits. The suite covers what the lock protects, not the race it
protects against.

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

## Moderation

```bash
pnpm db:queue                          # open flags, takedown requests first
node scripts/db.mjs hide <id> "why"    # off the map immediately
node scripts/db.mjs unhide <id>        # put it back
node scripts/db.mjs resolve <flag-id>  # mark a flag dealt with
```

Hiding is a soft delete: the place, its reports and its notes all survive, so a
mistaken or disputed takedown is reversible. The reason is recorded on the row
and a resolved flag documents who did what, because nobody reconstructs that
later.

Business removal requests arrive through the same queue and sort to the top —
`awaiting_reply` marks anything with a contact address on it.

## Importing

```bash
node scripts/import-nyc.mjs --bbox seed           # dry run, seeded area
node scripts/import-nyc.mjs --bbox seed --apply   # write
```

NYC Open Data's "Public Restrooms" (`i7jb-7jku`): 1,066 rows, all with
coordinates, `location_type` mapping cleanly onto `venue_type`.

**It declares no licence.** No `license` field in its Socrata metadata, and
NYC's terms neither grant nor forbid redistribution — they only disclaim
warranty. That is ambiguity, not permission. Ask NYC Open Data before relying
on it publicly. Every imported row records `import_source`, `import_id` and
`import_licence`, so withdrawing them is one delete.

The importer skips rows that are not `Operational` — a pin at a closed restroom
sends someone on a walk to a locked door, which is the failure this whole app
exists to avoid. It also refuses anything within 30m of an existing pin, and
**reports** likely duplicates between 30m and 150m rather than acting on them:
NYC lists two Columbus Park restrooms 120m apart and they are genuinely two
buildings, so a radius wide enough to catch a carelessly placed pin is also
wide enough to merge real ones.

No dataset anywhere carries door codes. That part cannot be imported, which is
both the bad news and the reason this project has a reason to exist.

## Still to settle before this goes public

- **Fill in the placeholders** in `public/privacy.html` and `public/terms.html`:
  every `[contact address]` and `[jurisdiction]`. Both pages carry a visible
  banner saying so, which is deliberate — it should be impossible to ship them
  unnoticed. Both were drafted to describe this system accurately; that is not
  the same as being legally sufficient, and neither has been reviewed.
- **Google's consent screen** is in Testing mode. Moving it to Production needs
  the privacy policy URL — `https://<your site>/privacy.html`.
- **Tile provider.** CARTO's public styles need no key and are fine at this
  scale, but read their terms before real traffic.
- **Whether to seed from OpenStreetMap at all.** ODbL has share-alike
  provisions on derived databases; `bathrooms.osm_id` exists so imports stay
  separable, but decide before the first import, not after.
- **The 30 seeded places are unverified.** Real locations, but nobody has
  checked one in person. Consider deleting them in favour of a handful you have
  actually stood in front of.
