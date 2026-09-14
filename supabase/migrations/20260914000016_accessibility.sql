-- Accessibility, as something other than a boolean.
--
-- NYC Open Data carries `accessibility` on 824 of its 975 operational rows and
-- `restroom_type` on 856. The importer read neither, so wheelchair and
-- gender_neutral were null on every row in the table — which is why migration
-- 015 shipped a changing-table filter and nothing else. That reasoning was
-- right and its premise was wrong: the data was there, it just was not being
-- read.
--
-- Two of these columns change shape on the way in, because the question they
-- answer is not yes/no.
--
-- WHEELCHAIR. 49 rows are "Partially Accessible" or "Limited Accessibility".
-- A boolean forces those to a lie in one direction or the other: true sends
-- somebody to a door they cannot get through, false hides places that would
-- have worked for them. Neither is acceptable when the person asking may not
-- be able to leave and try the next one.
--
-- CHANGING TABLE. 132 rows say yes and then qualify it — "in women's restroom
-- only", "in men's restroom only". Flattening that to true sends a father with
-- an infant to a table he cannot reach, which is the same walk-to-a-locked-door
-- failure the importer already refuses to cause for closed restrooms.
--
-- "Yes, in single-stall all gender restroom only" maps to `any`: it names where
-- the table is, not who may use it, and anyone can use an all-gender stall.

set search_path = public, extensions;

create type wheelchair_access     as enum ('full', 'partial', 'none');
create type changing_table_access as enum ('any', 'women_only', 'men_only', 'none');

-- ---------------------------------------------------------------------------
-- The two functions below read these columns, so they go first and come back
-- at the bottom rebuilt.
-- ---------------------------------------------------------------------------
drop function if exists bathrooms_in_view(
  float8, float8, float8, float8, venue_type[], access_kind[], int, boolean);

drop function if exists submit_bathroom(
  text, float8, float8, text, text, text, text, text, boolean, boolean, boolean);

-- ---------------------------------------------------------------------------
-- Widen in place, keeping the column names the client already uses.
-- ---------------------------------------------------------------------------
alter table bathrooms add column wheelchair_next     wheelchair_access;
alter table bathrooms add column changing_table_next changing_table_access;

update bathrooms set
  wheelchair_next = case
    when wheelchair is true  then 'full'::wheelchair_access
    when wheelchair is false then 'none'::wheelchair_access
  end,
  -- Every existing true came from the old flattening, so it means "there is
  -- one" and nothing about who may use it. The re-import corrects the 132
  -- qualified rows; until it runs, `any` is what the table actually claimed.
  changing_table_next = case
    when changing_table is true  then 'any'::changing_table_access
    when changing_table is false then 'none'::changing_table_access
  end;

alter table bathrooms drop column wheelchair;
alter table bathrooms drop column changing_table;
alter table bathrooms rename column wheelchair_next     to wheelchair;
alter table bathrooms rename column changing_table_next to changing_table;

-- Filtering on these is the point of importing them.
create index if not exists bathrooms_accessible on bathrooms (wheelchair)
  where status = 'active' and wheelchair is not null;
create index if not exists bathrooms_changing on bathrooms (changing_table)
  where status = 'active' and changing_table is not null;

-- ---------------------------------------------------------------------------
-- The viewport query, now with three needs instead of one.
-- ---------------------------------------------------------------------------
create function bathrooms_in_view(
  min_lng float8, min_lat float8, max_lng float8, max_lat float8,
  types   venue_type[]  default null,
  access  access_kind[] default null,
  max_results int default 300,
  needs_changing       boolean default false,
  needs_step_free      boolean default false,
  needs_gender_neutral boolean default false)
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
    -- Unknown is never a match. Sending someone to a place that might not
    -- have what they need defeats the point of their having asked.
    and (not needs_changing or b.changing_table in ('any','women_only','men_only'))
    -- 'partial' is not a match either. A partially accessible restroom is
    -- exactly the trip somebody in a wheelchair cannot afford to waste.
    and (not needs_step_free or b.wheelchair = 'full')
    and (not needs_gender_neutral or b.gender_neutral is true)
  order by f.confirms_90d desc nulls last
  limit max_results;
$$;

grant execute on function bathrooms_in_view(
  float8, float8, float8, float8, venue_type[], access_kind[], int,
  boolean, boolean, boolean) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Submission takes the wider types. The form does not collect any of these
-- today — it always sends null — but the signature has to admit the values
-- the column can now hold, or contributing one later means another migration.
-- ---------------------------------------------------------------------------
create function submit_bathroom(
  p_name           text,
  p_lat            float8,
  p_lng            float8,
  p_venue_type     text,
  p_access_kind    text,
  p_address        text    default null,
  p_floor_hint     text    default null,
  p_code           text    default null,
  p_wheelchair     text    default null,
  p_changing_table text    default null,
  p_gender_neutral boolean default null)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid := auth.uid();
  v_geog geography(Point,4326);
  v_near record;
  v_id   uuid;
begin
  if v_user is null then
    raise exception 'sign in to add a place' using errcode = '42501';
  end if;
  if is_banned(v_user) then
    raise exception 'this account cannot submit' using errcode = '42501';
  end if;
  if coalesce(length(trim(p_name)), 0) = 0 then
    raise exception 'a name is required' using errcode = '22023';
  end if;
  if p_lat is null or p_lng is null
     or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'a valid location is required' using errcode = '22023';
  end if;
  if daily_submissions(v_user) >= 5 then
    raise exception 'that is enough submissions for one day' using errcode = '53400';
  end if;

  v_geog := st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography;

  select b.id, b.name into v_near
  from bathrooms b
  where b.status = 'active' and st_dwithin(b.geog, v_geog, 20)
  limit 1;

  if found then
    return jsonb_build_object(
      'ok', false, 'reason', 'duplicate',
      'existing_id', v_near.id, 'existing_name', v_near.name);
  end if;

  insert into bathrooms (
    geog, name, venue_type, access_kind, address, floor_hint,
    wheelchair, changing_table, gender_neutral, created_by)
  values (
    v_geog, trim(p_name), p_venue_type::venue_type, p_access_kind::access_kind,
    nullif(trim(p_address), ''), nullif(trim(p_floor_hint), ''),
    p_wheelchair::wheelchair_access, p_changing_table::changing_table_access,
    p_gender_neutral, v_user)
  returning id into v_id;

  if nullif(trim(p_code), '') is not null then
    insert into bathroom_codes (bathroom_id, code, submitted_by)
    values (v_id, trim(p_code), v_user);
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

grant execute on function submit_bathroom(
  text, float8, float8, text, text, text, text, text, text, text, boolean)
  to authenticated;
