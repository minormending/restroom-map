-- When a place is open, to the precision anybody can actually answer.
--
-- "Open now" is the obvious filter and the dangerous one. Getting it wrong
-- sends somebody to a locked door, which is the single failure this map exists
-- to prevent — so it only ever claims what it can compute.
--
-- WHY NOT REAL OPENING HOURS
--
-- No source has them. Refuge carries none, NYC Open Data carries none, and
-- OSM has opening_hours on 7 of the 67 toilets in this bbox — not enough to
-- import, and ODbL besides. So hours can only be contributed, and contributed
-- hours have to survive the corroboration rule: two people must give the SAME
-- answer before it is shown as fact. "Mo-Fr 09:00-17:00" and "9am-5pm
-- weekdays" are the same fact and would never agree as strings, so a free-text
-- schedule can never settle. Three coarse answers can.
--
--   always    open around the clock. A transit hub, a 24-hour diner.
--   daylight  open while it is light — parks, plazas, anything that locks at
--             dusk. The commonest answer for the places already on this map.
--   venue     open while the business is. A café's toilet is open when the
--             café is, which is knowable by looking at the café and not by
--             this database.
--
-- WHAT 'OPEN NOW' WILL AND WILL NOT MATCH
--
--   always    always matches.
--   daylight  matches between 07:00 and 20:00 in New York. An approximation,
--             and deliberately narrower than real daylight so it errs toward
--             saying no.
--   venue     never matches, because this schema does not know the café's
--             hours and guessing is how the wasted trip happens.
--   unknown   never matches, like every other need.
--
-- A filter that says "no" when it cannot be sure is doing its job. One that
-- says "yes" hopefully is not.

set search_path = public, extensions;

create type hours_kind as enum ('always', 'daylight', 'venue');

alter table bathrooms add column if not exists hours hours_kind;

comment on column bathrooms.hours is
  'How long a place is open, coarsely, because that is the precision somebody '
  'standing outside can answer and the precision two people can agree on. '
  'Real schedules exist in no source and never corroborate as free text.';

create index if not exists bathrooms_hours on bathrooms (hours)
  where status = 'active' and hours is not null;

-- Claimable like the rest.
alter type access_field add value if not exists 'hours';

-- ---------------------------------------------------------------------------
-- Both functions below switch on the field. They compare it as text rather
-- than as an enum literal, because a value added by ALTER TYPE in this
-- transaction cannot be referenced as a literal inside the same one.
-- ---------------------------------------------------------------------------
create or replace function promote_access_claim()
returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_winner text;
  v_winners int;
begin
  select count(*), min(value) into v_winners, v_winner
  from (
    select value from access_claims
    where bathroom_id = NEW.bathroom_id and field = NEW.field
    group by value having count(*) >= 2
  ) agreed;

  if v_winners = 1 then
    execute format(
      'update bathrooms set %I = $1::%s where id = $2 and %I is null',
      NEW.field,
      case NEW.field::text
        when 'wheelchair'     then 'wheelchair_access'
        when 'changing_table' then 'changing_table_access'
        when 'adult_changing' then 'adult_changing_kind'
        when 'hours'          then 'hours_kind'
        else 'boolean'
      end,
      NEW.field)
    using v_winner, NEW.bathroom_id;
  end if;

  return NEW;
end $$;

create or replace function submit_access_claim(
  p_bathroom_id uuid, p_field text, p_value text)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user  uuid := auth.uid();
  v_field access_field;
  v_ok    boolean;
begin
  if v_user is null then
    raise exception 'sign in to add accessibility detail' using errcode = '42501';
  end if;
  if is_banned(v_user) then
    raise exception 'this account cannot submit' using errcode = '42501';
  end if;

  begin
    v_field := p_field::access_field;
  exception when invalid_text_representation then
    raise exception 'unknown field: %', p_field using errcode = '22023';
  end;

  if not exists (select 1 from bathrooms
                 where id = p_bathroom_id and status = 'active') then
    raise exception 'no such place' using errcode = 'P0002';
  end if;

  v_ok := case p_field
    when 'wheelchair'     then p_value in ('full','partial','none')
    when 'changing_table' then p_value in ('any','women_only','men_only','none')
    when 'adult_changing' then p_value in ('changing_places','bench','none')
    when 'hours'          then p_value in ('always','daylight','venue')
    else p_value in ('true','false')
  end;
  if not v_ok then
    raise exception 'not a valid answer for %: %', p_field, p_value
      using errcode = '22023';
  end if;

  if settled_value(p_bathroom_id, v_field) is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_settled');
  end if;

  if not rl_take('claim:' || client_fingerprint(), interval '1 hour', 60) then
    raise exception 'that is a lot of detail at once, try later'
      using errcode = '53400';
  end if;

  insert into access_claims (bathroom_id, field, value, user_id)
  values (p_bathroom_id, v_field, p_value, v_user)
  on conflict (bathroom_id, field, user_id)
    do update set value = excluded.value, created_at = now();

  return jsonb_build_object(
    'ok', true,
    'settled', settled_value(p_bathroom_id, v_field) is not null);
end $$;

-- ---------------------------------------------------------------------------
-- The viewport filter gains one need. 'open_now' is evaluated against New York
-- time rather than the server's, because the map is of New York and a filter
-- that silently used UTC would be five hours wrong in the direction that sends
-- people out at night.
-- ---------------------------------------------------------------------------
create or replace function bathrooms_in_view(
  min_lng float8, min_lat float8, max_lng float8, max_lat float8,
  types   venue_type[]  default null,
  access  access_kind[] default null,
  max_results int default 300,
  needs   text[] default null)
returns table (
  id uuid, lat float8, lng float8, name text,
  venue_type venue_type, access_kind access_kind,
  has_code boolean, confirms int, troubles int, last_confirmed timestamptz)
language sql stable security definer set search_path = public, extensions as $$
  select
    b.id,
    st_y(b.geog::geometry), st_x(b.geog::geometry),
    b.name, b.venue_type, b.access_kind,
    exists(select 1 from bathroom_codes c
           where c.bathroom_id = b.id and c.superseded_at is null),
    coalesce(f.confirms_90d, 0),
    coalesce(f.troubles_90d, 0),
    f.last_confirmed_at
  from bathrooms b
  left join bathroom_confidence f on f.bathroom_id = b.id
  where b.status = 'active'
    and b.geog && st_makeenvelope(min_lng, min_lat, max_lng, max_lat, 4326)::geography
    and (types  is null or b.venue_type  = any(types))
    and (access is null or b.access_kind = any(access))
    and (needs is null or (
      (not ('changing'       = any(needs)) or b.changing_table in ('any','women_only','men_only'))
      and (not ('step_free'      = any(needs)) or b.wheelchair = 'full')
      and (not ('gender_neutral' = any(needs)) or b.gender_neutral is true)
      and (not ('adult_changing' = any(needs)) or b.adult_changing in ('changing_places','bench'))
      and (not ('hoist'          = any(needs)) or b.adult_changing = 'changing_places')
      and (not ('grab_bars'      = any(needs)) or b.grab_bars is true)
      and (not ('turning_space'  = any(needs)) or b.turning_space is true)
      and (not ('sink_in_stall'  = any(needs)) or b.sink_in_stall is true)
      and (not ('shelf'          = any(needs)) or b.shelf is true)
      and (not ('unlocked'       = any(needs)) or b.accessible_locked is false)
      -- Only what can be computed. 'venue' means the café's hours decide, and
      -- this database does not know them.
      and (not ('open_now' = any(needs)) or b.hours = 'always' or (
        b.hours = 'daylight'
        and extract(hour from (now() at time zone 'America/New_York')) between 7 and 19
      ))
    ))
  order by f.confirms_90d desc nulls last
  limit max_results;
$$;

grant execute on function bathrooms_in_view(
  float8, float8, float8, float8, venue_type[], access_kind[], int, text[])
  to anon, authenticated;
