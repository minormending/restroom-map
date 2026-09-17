# Restroom Map

**→ [minormending.github.io/restroom-map](https://minormending.github.io/restroom-map/)**

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

## Documentation

[`docs/`](docs/) is the long form: the system shape, the data model, how
something becomes a fact, who may write what, and the front end. Written for
somebody who has not seen this before, with the deeper detail folded into
"Advanced" blocks.

Start at [docs/README.md](docs/README.md). [docs/trust.md](docs/trust.md) is
the one to read before changing anything, and
[docs/triage.md](docs/triage.md) is what happens to a complaint after somebody
sends one.

## Importing

### NYC Open Data, "Public Restrooms"

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

### NYC Parks, which is three datasets

```bash
node scripts/import-parks.mjs           # dry run
node scripts/import-parks.mjs --apply   # write
```

The park restrooms were already here — `i7jb-7jku` is the same agency's same
facilities, and 646 of the 715 comfort stations NYC Parks maps already had a
pin within 30m. Re-importing the locations is close to a no-op. What that
dataset does not have is **how stale it is**: `i7jb-7jku` was last refreshed in
November 2025, and Parks' inspection list is refreshed weekly.

So this importer is mostly not about adding pins.

| Dataset | What it has | What it lacks |
| --- | --- | --- |
| `n8q6-i44s` NYC Parks Structures | every comfort station as a building footprint | any operational status at all |
| `9byw-znpj` PIP – Public Restrooms | long-term closures, winterisation | coordinates; only `prop_id` and `cs_id` |
| `buk3-3qpr` PIP – All Sites (MAPPED) | park property polygons | — |

Structures give locations, the inspection list gives status, and the polygons
join a `prop_id` to somewhere on a map. All three declare no licence, on the
same terms as `i7jb-7jku` above.

**The join is property-level and the importer says so.** Nothing published maps
a `cs_id` to a point, so a park with two comfort stations where one is closed
is genuinely ambiguous — those are printed for a person to decide, never acted
on. A pin is hidden only when every station in its park is closed and the map
shows no more pins than there are stations.

Two more rules, both about not overriding people:

- **A confirmation outranks the inspection record.** Somebody who reported
  using a restroom in the last 90 days beats a weekly municipal refresh; those
  are printed, not hidden. Removing a place somebody just confirmed teaches
  people that confirming does nothing.
- **Repairs end.** Anything this importer hid, it un-hides once Parks stops
  saying it is closed — otherwise the first run quietly becomes permanent.
  `hidden_reason` is stamped `nyc-parks:` so a later run can find its own work
  and leave operator takedowns alone.

Winterisation lands in `closed_in_winter`, which is a column rather than an
`hours_kind` because the two compose: a park restroom is open while the park
is, during the half of the year it is open at all. It deliberately does not
touch the `open_now` filter — every imported park row is `hours = 'venue'`,
which never matches `open_now` anyway, so wiring it in would be machinery with
no effect.

It is also not claimable. Nobody standing outside a restroom in July can see
whether it shuts in December; that one only ever comes from the operator.

### What no dataset has

No dataset anywhere carries door codes. That part cannot be imported, which is
both the bad news and the reason this project has a reason to exist.

Nor does any of them carry the six fields this map exists to collect — an adult
changing bench, grab bars, turning space, whether the accessible stall is
locked, a sink in the cubicle, a shelf. Not NYC, not Parks, not Refuge, not
OSM. Those can only be walked to.

## Still to settle before this goes public

Ordered by what actually stops a launch, not by how much work each is. Two of
these need a person to walk somewhere; the rest need a decision or a payment.

- **Neither legal page has been reviewed by a lawyer.** The placeholders are
  filled and governing law is New York, and both pages still carry a banner
  saying they describe this system accurately, which is not the same as being
  legally sufficient. That banner is deliberate and should stay until somebody
  qualified has read them. This is the only item here that is a hard no.

- **The map cannot yet answer the question it now asks.** The front page
  promises to say whether a restroom will work for you. Today:

  | | |
  | --- | --- |
  | places | 1,038 |
  | recording any of the six | **0** |
  | claims | 0 |
  | accounts | 1 |

  The six are an adult changing bench, grab bars, turning space, whether the
  accessible stall is locked, a sink in the cubicle, a shelf. No dataset
  anywhere carries them — not NYC, not Parks, not Refuge, not OSM — which is
  the reason this project exists and the reason importing cannot fix it.

  794 rows do carry a wheelchair yes/no from their source, so the map is not
  empty. It is empty on exactly the fields that make it different from the maps
  that already exist. The place count has gone 84 → 1,038 across three imports;
  the number under it has been zero the whole time, and no amount of work in
  this repo moves it.

  A promise with nothing behind it is worse than no promise. It wants about a
  dozen places filled in before anybody is invited.

  **Bootstrapping needs two people, not one.** A claim is shown as fact only
  once two people independently agree, which is the right rule and makes the
  cold start harder than it looks: the first person to record a hoist sees
  their answer sit as "on one person's word" until somebody else visits the
  same restroom. Walk the first dozen with somebody else, not alone.

- **Nobody disabled has used this.** The structural blockers are gone. Every
  pin used to live on a canvas and the accessibility tree held no places at
  all, so a screen reader user could filter and be handed nothing; there is a
  list view now, it is keyboard reachable, sheets take focus and announce
  themselves, controls in a sheet clear 44px, and the accessibility, layout and
  health checks pass across twelve screens at three widths.

  None of that is the same as somebody actually using it. Structure was
  verified; experience was not. For a project positioned on disability, one
  real session before launch protects more than it costs — and it is the same
  errand as the item above, because both need a person in a room with the app
  rather than another commit.

- **The sign-in screen says `supabase.co`, not Restroom Map.** Diagnosed and
  mitigated; not fixed. Google's consent screen reads "to continue to
  zfxrhykegdilxssghmyf.supabase.co", and on a page asking for a Google password
  an unrecognisable hostname reads as phishing. Contributing requires an
  account, so this screen stands between the project and the only mechanism by
  which it gets the data the item above is about.

  **App name is set** — that was the obvious guess and it was wrong. Google
  shows the name only when the callback host sits on a domain the project has
  verified, and `supabase.co` belongs to Supabase, not to us. The fix is a
  custom auth domain: a domain this project does not own, on a paid plan, with
  a paid add-on on top. A cost decision, not a configuration one.

  Until somebody makes it, the app says the host one step early — a short
  warning before the redirect naming what Google is about to name, and saying
  it is this map's database. That is a mitigation, not a fix, and it costs a
  tap on the flow this project most needs people to finish.

- **Correcting a settled fact has no design.** Claims are fill-only: once a
  field is settled, further claims are refused. A hoist that gets removed, or
  an import that was wrong, stays until somebody edits the database by hand.
  Fine while the map is small and a real problem before it is not.

- **Nothing reports a failure except a person choosing to.** No analytics, no
  error reporting, no crash channel — deliberate, and the privacy page promises
  it. The consequence is that the feedback form is the whole signal, and the
  form lives in the menu: a render error that blanks the page takes the way to
  report it down with it. Somebody's phone showing white is invisible here.
  The smallest honest repair is an error boundary that outlives the app and
  offers the form, not a tracking script.

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

- **Whether to seed from OpenStreetMap at all.** None of the three imports so
  far is OSM — NYC Open Data, NYC Parks and Refuge Restrooms are all permissive
  — so this decision is still ahead of the import it governs, which is where it
  belongs. ODbL has share-alike provisions on derived databases. Imports stay
  separable: every imported row records `import_source`, `import_id` and
  `import_licence`, so withdrawing one source is a single delete and the
  licence travels with the rows it governs rather than living in somebody's
  memory. Decide before that import, not after.
