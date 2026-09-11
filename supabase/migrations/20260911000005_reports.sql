-- M1: reporting, with abuse control that does not require an edge function.
--
-- Supabase fronts PostgREST with a proxy that appends the real client address,
-- and exposes the request headers to Postgres. That is enough to rate-limit by
-- IP inside a security-definer function, so anonymous reporting needs no Deno
-- runtime and deploys like every other migration.
--
-- Treat the IP limit as a cost multiplier on abuse, not a wall. It is trivially
-- sidestepped with a VPN. The defence that actually matters is economic:
-- anonymous reports never move credits (see award_on_report in 006).

set search_path = public, extensions;

create extension if not exists pgcrypto with schema extensions;

-- Short-lived counters. Never linked to a report row, never holds a raw
-- address, and pruned after two days.
create table rate_limit (
  key    text not null,
  bucket timestamptz not null,
  hits   int not null default 0,
  primary key (key, bucket)
);

alter table rate_limit enable row level security;
-- No policies and no grants, deliberately: only the functions below touch it.

-- A salt makes the stored digests useless on their own. IPv4 is a small enough
-- space that an unsalted hash is reversible by brute force.
create or replace function rl_salt()
returns text language sql immutable as $$ select 'restroom-map/v1'; $$;

create or replace function client_fingerprint()
returns text
language sql stable security definer set search_path = public, extensions as $$
  -- current_setting can come back as '' as well as NULL, and ''::json throws.
  with h as (
    select nullif(current_setting('request.headers', true), '')::json as j
  )
  select encode(digest(
    coalesce(
      nullif(h.j->>'cf-connecting-ip', ''),
      nullif(split_part(h.j->>'x-forwarded-for', ',', 1), ''),
      'unknown'
    ) || rl_salt(), 'sha256'), 'hex')
  from h;
$$;

-- Returns true when the call is within budget, and counts it.
create or replace function rl_take(p_key text, p_window interval, p_limit int)
returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_bucket timestamptz := to_timestamp(
    floor(extract(epoch from now()) / extract(epoch from p_window)) * extract(epoch from p_window));
  v_hits int;
begin
  insert into rate_limit (key, bucket, hits) values (p_key, v_bucket, 1)
  on conflict (key, bucket) do update set hits = rate_limit.hits + 1
  returning hits into v_hits;

  -- Opportunistic pruning; cheap enough amortised across calls.
  if random() < 0.01 then
    delete from rate_limit where bucket < now() - interval '2 days';
  end if;

  return v_hits <= p_limit;
end $$;

-- ---------------------------------------------------------------------------
-- The one entry point for reporting. Anonymous and authenticated both use it.
--
-- Coordinates are used to set a boolean and then DISCARDED. They are never
-- written to a table. A browser coordinate is spoofable from devtools, which
-- is exactly why it isn't worth keeping.
-- ---------------------------------------------------------------------------
create or replace function submit_report(
  p_bathroom_id uuid,
  p_kind        text,
  p_code_id     uuid    default null,
  p_lat         float8  default null,
  p_lng         float8  default null)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user   uuid := auth.uid();
  v_kind   report_kind;
  v_fp     text := client_fingerprint();
  v_geo    boolean := false;
  v_exists boolean;
  v_row    record;
begin
  begin
    v_kind := p_kind::report_kind;
  exception when invalid_text_representation then
    raise exception 'unknown report kind: %', p_kind using errcode = '22023';
  end;

  select true into v_exists
  from bathrooms where id = p_bathroom_id and status = 'active';
  if not found then
    raise exception 'no such bathroom' using errcode = 'P0002';
  end if;

  if owns_bathroom(v_user, p_bathroom_id) then
    raise exception 'you cannot report your own submission' using errcode = '42501';
  end if;

  -- Budget 1: overall volume from one address.
  if not rl_take('ip:' || v_fp, interval '1 hour', 40) then
    raise exception 'too many reports, try later' using errcode = '53400';
  end if;

  -- Budget 2: one verdict of a given kind per address per bathroom per day.
  -- For signed-in users the reports_daily_cap unique index says the same thing.
  if not rl_take(
       'rpt:' || v_fp || ':' || p_bathroom_id::text || ':' || p_kind,
       interval '1 day', 1) then
    return jsonb_build_object('ok', false, 'reason', 'already_reported');
  end if;

  if p_lat is not null and p_lng is not null then
    select st_dwithin(b.geog,
             st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography, 150)
      into v_geo
    from bathrooms b where b.id = p_bathroom_id;
  end if;

  begin
    insert into reports (bathroom_id, code_id, user_id, anon_id, kind, geo_verified)
    values (p_bathroom_id, p_code_id, v_user,
            case when v_user is null then left(v_fp, 16) end,
            v_kind, coalesce(v_geo, false));
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'already_reported');
  end;

  select coalesce(confirms_90d, 0) as confirms,
         coalesce(troubles_90d, 0) as troubles,
         last_confirmed_at
    into v_row
  from bathroom_confidence where bathroom_id = p_bathroom_id;

  return jsonb_build_object(
    'ok', true,
    'geo_verified', coalesce(v_geo, false),
    'confirms', coalesce(v_row.confirms, 0),
    'troubles', coalesce(v_row.troubles, 0),
    'last_confirmed', v_row.last_confirmed_at);
end $$;

revoke execute on function rl_take(text, interval, int) from public;
revoke execute on function client_fingerprint() from public;
grant  execute on function submit_report(uuid, text, uuid, float8, float8)
  to anon, authenticated;
