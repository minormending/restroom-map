# Restroom Map

A crowdsourced map of public restrooms, built around the question the other
maps do not answer: **will it work for me?**

Google Maps knows a restroom exists. It does not know whether you can get in
without steps, whether the accessible stall is kept locked and the key is
behind a counter, whether there is an adult changing bench, whether the sink is
inside the cubicle, whether there is anywhere to put anything down. For a lot
of people those are not details — they decide whether the journey is worth
making at all.

So the map is useful to anybody looking for a toilet, and it is built for the
people for whom the wrong answer costs a wasted trip they may not be able to
repeat.

Nothing else records most of this, which is the reason it is worth
contributing to and the reason most fields start empty. An accessibility
answer needs **two people who agree** before it is shown as fact; until then
the map says how thin the evidence is, and says so when people disagree.
Guessing is worse than not knowing here.

Static frontend on GitHub Pages, Postgres + PostGIS behind it. The browser is
treated as hostile throughout: it can read public data and propose writes, but
it never decides whether a write is legitimate.

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

## Offline

The service worker precaches the bundle and caches map tiles, so with no signal
the app opens and the streets draw. The pins were the one thing that still
needed a round trip, which made the worst case a working map of no bathrooms —
in a basement, on a platform, inside a building with one bar, which is where
this gets opened.

Rows the map has shown are kept in `localStorage` (`restroom-map/last-seen/v1`,
capped at 600). A failed query falls back to them, filtered through the same
bounds and filter helpers the bundled-seed path uses, and a banner says so.

The fallback is for **no signal**, not for a server error. Old pins beat no
pins when the problem is the tunnel you are standing in. When the server
answered and the answer was an error, walking outside will not help, and
painting familiar pins over an outage would erase the only sign that anything
is wrong. PostgREST failures carry an error code; a connection that never
completed does not.

Nothing expires on a timer. A restroom that existed last week almost certainly
still exists — what matters is that the reader is told which they are looking
at, not that the data is young.

## Marker encoding

Four dimensions across four visual channels, because one icon per combination
is unreadable at a glance and glance is the whole use case.

| Channel | Encodes |
| --- | --- |
| Glyph | Venue type — bag, tree, carriage, cup, building… |
| Hue | Access — green open, amber code required, blue ask staff, violet customers only |
| Fill | Confirmation — solid once somebody has confirmed it, hollow until then |
| Badge | Recent trouble reports outweighing confirmations |

Pin colours are deliberately theme-independent: they sit on a basemap that is
light or near-black depending on the viewer, so each hue holds contrast on both.
Both fills keep the same white halo around the pin edge, because that — not the
fill — is what separates a pin from either basemap.

**Confirmation used to be a hue**: an unconfirmed place went grey and its access
kind stopped being visible at all. That reads fine in a mature map and badly in
a new one. Every row imported from NYC Open Data arrives with no confirmations,
so all 84 places were grey, the access legend described four colours that
appeared nowhere on the map, and the encoding said only "nobody has been here" —
at the one moment it can least afford to say nothing else. Separating the two
channels keeps both, and gives a place somewhere to go when it earns it.
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

It reads four fields beyond name and location, and two of them do not fit a
boolean:

| Source field | Column | Note |
| --- | --- | --- |
| `accessibility` | `wheelchair` | `full` / `partial` / `none`. 49 rows citywide are partial |
| `restroom_type` | `gender_neutral` | any all-gender option counts |
| `changing_stations` | `changing_table` | `any` / `women_only` / `men_only` / `none` |
| `operator` | `operator` | NYC Parks, NYPL, BPL — provenance, and a trust signal |

`floor_hint` is deliberately not written by the importer. NYC supplies no such
hint, and it is the one field on an imported row somebody might later walk to
the place to fill in — so writing it every run would quietly delete the only
contributed thing those rows can hold.

Flattening either enum is how somebody ends up outside a door they cannot use.
"Partially accessible" rounded to yes wastes the trip a wheelchair user can
least afford; "yes, in the women's restroom" rounded to yes sends a father with
an infant to a table he cannot reach. The filters follow the same split —
step-free excludes `partial`, changing table includes the gendered ones and the
detail sheet says which.

No dataset anywhere carries door codes. That part cannot be imported, which is
both the bad news and the reason this project has a reason to exist.

## Still to settle before this goes public

Ordered by what actually stops a launch, not by how much work each is.

- **Neither legal page has been reviewed by a lawyer.** The placeholders are
  filled — contact is the GitHub issue tracker, governing law is New York — and
  both pages still carry a banner saying they describe this system accurately,
  which is not the same as being legally sufficient. That banner is deliberate
  and should stay until somebody qualified has read them. This is the only item
  here that is a hard no.

- **The map cannot yet answer the question it now asks.** The front page
  promises to say whether a restroom will work for you. Today: 84 places, and
  **zero** of them record an adult changing bench, grab bars, turning space,
  whether the accessible stall is locked, a sink in the cubicle or a shelf.
  Zero claims, one account, one confirmation.

  That gap is the reason the project exists — nobody else records this — but a
  promise with nothing behind it is worse than no promise. It wants a dozen
  places filled in before anybody is invited.

  **Bootstrapping needs two people, not one.** A claim is shown as fact only
  once two people independently agree, which is the right rule and makes the
  cold start harder than it looks: the first person to record a hoist sees
  their answer sit as "on one person's word" until somebody else visits the
  same restroom. Walk the first dozen with somebody else, not alone.

- **Nobody disabled has used this.** The structural blocker is gone — until
  recently every pin lived on a canvas and the accessibility tree held no
  places at all, so a screen reader user could filter and be handed nothing.
  There is a list view now, it is keyboard reachable, the sheet takes focus and
  announces itself, and the automated suite passes.

  None of that is the same as somebody actually using it. Structure was
  verified; experience was not. For a project positioned on disability, one
  real session before launch protects more than it costs.

- **The sign-in screen says `supabase.co`, not Restroom Map.** Google's consent
  screen reads "to continue to zfxrhykegdilxssghmyf.supabase.co". The privacy
  and terms links on it are correct, so the branding config saved — it is the
  name a person reads that is wrong, and on a page asking for a Google password
  an unrecognisable hostname reads as phishing.

  This costs more than it used to. Contributing requires an account, so this
  screen now stands between the project and the only mechanism by which it gets
  data. Check **App name** under Google Auth Platform → Branding first; Google
  falls back to the callback host when it is blank. If it is set, this is the
  shape of Supabase's hosted auth and the fix is a paid custom domain — a cost
  decision rather than a configuration one.

- **Correcting a settled fact has no design.** Claims are fill-only: once a
  field is settled, further claims are refused. A hoist that gets removed, or
  an import that was wrong, stays until somebody edits the database by hand.
  Fine while the map is small and a real problem before it is not.

- **Deletion requests arrive in public.** The privacy page routes them to the
  issue tracker, tells people not to post an email address there, and warns
  that identifying the account happens on the issue. It works. A private
  address would work better, and swapping it is two links and a paragraph.

- **Google sign-in depends on a second repo.**
  [minormending.github.io](https://github.com/minormending/minormending.github.io)
  serves the bare domain and holds the Search Console token in the `<head>` of
  its one page. **Do not delete it, make it private, or switch its Pages off.**
  Google re-checks verification, and losing it can start refusing sign-ins with
  the cause three steps removed from the symptom.

- **Tile provider.** CARTO's public styles need no key and are fine at this
  scale, but read their terms before real traffic. Offline behaviour leans on
  them: tiles come back from the service worker cache, so a first-ever visit
  with no signal draws pins on blank grey rather than on streets.

- **Whether to seed from OpenStreetMap at all.** ODbL has share-alike
  provisions on derived databases. Imports stay separable — every imported row
  records `import_source`, `import_id` and `import_licence`, so withdrawing one
  source is a single delete, and the licence travels with the rows it governs
  rather than living in somebody's memory. Decide before the first import, not
  after.
