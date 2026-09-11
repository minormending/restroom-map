-- Restroom Map — core schema.
--
-- Two decisions here matter more than the rest:
--   * Codes are a HISTORY table, not a column, because codes rotate and a row
--     with no supersession history can't tell you whether it's still good.
--   * Credits are an APPEND-ONLY ledger, never a mutable balance, because you
--     will need to claw back fraud and you cannot audit a number.

create extension if not exists postgis;

create type venue_type as enum (
  'store','restaurant','cafe','gas_station','park',
  'transit','public_facility','library','hotel','other');

create type access_kind as enum (
  'open','code_required','ask_staff','customers_only');

create type bathroom_status as enum ('active','hidden','removed');

create table profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  trust_score  int not null default 0,
  created_at   timestamptz not null default now(),
  banned_at    timestamptz
);

create table bathrooms (
  id             uuid primary key default gen_random_uuid(),
  geog           geography(Point,4326) not null,
  name           text not null check (length(name) between 1 and 120),
  venue_type     venue_type not null,
  access_kind    access_kind not null default 'open',
  address        text,
  floor_hint     text,          -- "2nd floor, past the lockers"
  wheelchair     boolean,
  changing_table boolean,
  gender_neutral boolean,
  status         bathroom_status not null default 'active',
  created_by     uuid references profiles(id),
  osm_id         text unique,   -- set for imports, null for user submissions
  created_at     timestamptz not null default now()
);

create index bathrooms_geog_idx on bathrooms using gist (geog);
create index bathrooms_live_idx on bathrooms (venue_type, access_kind)
  where status = 'active';

create table bathroom_codes (
  id            uuid primary key default gen_random_uuid(),
  bathroom_id   uuid not null references bathrooms(id) on delete cascade,
  code          text not null check (length(code) between 1 and 40),
  submitted_by  uuid references profiles(id),
  created_at    timestamptz not null default now(),
  superseded_at timestamptz,
  superseded_by uuid references bathroom_codes(id)
);

-- At most one live code per bathroom.
create unique index codes_one_live on bathroom_codes (bathroom_id)
  where superseded_at is null;

create type report_kind as enum
  ('works','code_bad','gone','inaccessible','dirty');

create table reports (
  id           uuid primary key default gen_random_uuid(),
  bathroom_id  uuid not null references bathrooms(id) on delete cascade,
  code_id      uuid references bathroom_codes(id),  -- which code was tested
  user_id      uuid references profiles(id),        -- null = anonymous
  anon_id      text,                                -- rate limiting only
  kind         report_kind not null,
  geo_verified boolean not null default false,      -- checked server-side,
  created_at   timestamptz not null default now()   -- coordinate discarded
);

-- One report per user, per bathroom, per kind, per UTC day. The expression is
-- immutable because the timezone is a literal.
create unique index reports_daily_cap on reports
  (bathroom_id, user_id, kind, (date_trunc('day', created_at at time zone 'utc')))
  where user_id is not null;

create index reports_recent on reports (bathroom_id, created_at desc);

create table comments (
  id            uuid primary key default gen_random_uuid(),
  bathroom_id   uuid not null references bathrooms(id) on delete cascade,
  user_id       uuid not null references profiles(id),
  body          text not null check (length(body) between 1 and 1000),
  created_at    timestamptz not null default now(),
  hidden_at     timestamptz,
  hidden_reason text
);

-- Abuse reports and business removal requests share one queue.
create table flags (
  id            uuid primary key default gen_random_uuid(),
  target_type   text not null check (target_type in ('bathroom','comment')),
  target_id     uuid not null,
  reporter_id   uuid references profiles(id),
  reason        text not null,
  contact_email text,
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz
);

create type credit_reason as enum (
  'signup_bonus','submission_verified','code_verified',
  'passive_confirmation','fraud_clawback','spend_unlock','manual_adjustment');

create table credit_ledger (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id),
  delta      int not null,
  reason     credit_reason not null,
  ref_type   text,
  ref_id     uuid,
  created_at timestamptz not null default now()
);

-- The single most important constraint in the schema: one payout per
-- (user, reason, source event). A retry, a race or a replay cannot pay twice.
create unique index ledger_dedupe on credit_ledger (user_id, reason, ref_id)
  where ref_id is not null;

create view user_credits as
  select user_id, sum(delta)::int as balance
  from credit_ledger group by user_id;
