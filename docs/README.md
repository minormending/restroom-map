# How this thing works

Nine documents. Read them in order the first time; after that, jump.

| | what it answers |
| --- | --- |
| [architecture.md](architecture.md) | What are the pieces and how does a request get from a thumb to a row? |
| [data-model.md](data-model.md) | What is stored, and why is it shaped like that? |
| [shared-database.md](shared-database.md) | Which half of the database is this app's, and which half belongs to everybody? |
| [trust.md](trust.md) | How does something become a fact? This is the interesting one. |
| [security.md](security.md) | Who may write what, and what stops somebody flooding it? |
| [frontend.md](frontend.md) | Where does the React live and why is the map a problem? |
| [testing.md](testing.md) | What is checked, by which of the four systems, and what gates a merge? |
| [operations.md](operations.md) | How does a change reach a phone, and what do you check when it looks wrong? |
| [triage.md](triage.md) | What happens to a complaint after somebody sends it? |

Each one is written for somebody who has never seen this codebase. Where there
is a deeper answer, it is folded away like this:

<details>
<summary><b>Advanced</b> — what these look like</summary>

Detail that matters once you are changing the thing rather than reading it:
exact function signatures, the failure that caused a rule to exist, numbers and
where they were measured. Skip them on a first pass — nothing above them
depends on them.

</details>

## Before any of that

```bash
pnpm install
cp .env.example .env     # then fill in the Supabase keys
pnpm dev                 # http://localhost:5173/restroom-map/
```

With no Supabase keys the app still runs, on bundled sample data
(`USING_SEED_DATA` in [`src/lib/config.ts`](../src/lib/config.ts)). You get a
map and no writes. That is enough to work on layout and nothing else.

| command | what it does |
| --- | --- |
| `pnpm dev` | dev server |
| `pnpm build` | typecheck, bundle, and copy `index.html` to `404.html` for Pages |
| `pnpm typecheck` | types only, no bundle |
| `pnpm lint` | oxlint |
| `pnpm test` | the database suite — see below |
| `pnpm db:status` | applied and pending migrations |
| `pnpm db:migrate` | apply new migrations |
| `pnpm db:queue` | what is waiting to be moderated |

## The test suite talks to production

There is one database, and it is shared with other apps —
[shared-database.md](shared-database.md) is the shortest path to understanding
why half the table names below are not in this repo's migrations.

`pnpm test` connects to that database, and every test runs inside a transaction
that is **always rolled back** — there is no commit anywhere in the runner.
After each rollback it re-checks a fingerprint of every function in the schema
and the row counts of its own marker rows, so a test that somehow escaped its
transaction fails the next one loudly rather than silently leaving rows behind.

That is why the tests read oddly at first: they build users, places and reports
from scratch every time instead of relying on anything existing.

<details>
<summary><b>Advanced</b> — the canary, and why it is two things</summary>

`scripts/test.mjs` takes an md5 of `pg_get_functiondef` across every function
in `public`, ordered by oid, plus a count of rows carrying the harness marker —
including rows in the **shared** flags and feedback tables, where an escapee
would land in the real moderation queue for a person to read. Both are compared
after every rollback.

The hash alone would miss data left behind; the counts alone would miss a
migration applied mid-run by another process. Neither is theoretical — the
suite is pointed at the same database the live site reads.

(The hash half currently watches `public`, which is no longer where this app's
functions live. [testing.md](testing.md) has the detail.)

The harness distinction that catches people: `t.become(user)` sets the JWT
claims and the request IP, but the connection is still the **owner**, which
bypasses RLS and table grants entirely. `t.asRole('anon', …)` does `set local
role`, which is the only way to test a policy or a grant. A permission test
written with `become` passes against a wide-open schema. See
[security.md](security.md).

</details>
