-- Filter by changing table.
--
-- The NYC import brought real data for this: 45 of 84 places know the answer,
-- 41 of them have one. It shows in the detail sheet but there was no way to
-- ask "only show me those", which is the question a parent with an infant is
-- actually asking.
--
-- Deliberately only this one. wheelchair and gender_neutral are null on every
-- row, and a filter that always returns nothing is worse than its absence.

set search_path = public, extensions;

drop function if exists bathrooms_in_view(
  float8, float8, float8, float8, venue_type[], access_kind[], int);

create function bathrooms_in_view(
  min_lng float8, min_lat float8, max_lng float8, max_lat float8,
  types   venue_type[]  default null,
  access  access_kind[] default null,
  max_results int default 300,
  needs_changing boolean default false)
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
    -- Unknown is not a match. Sending someone to a place that might not have
    -- one defeats the point of asking.
    and (not needs_changing or b.changing_table is true)
  order by f.confirms_90d desc nulls last
  limit max_results;
$$;

grant execute on function bathrooms_in_view(
  float8, float8, float8, float8, venue_type[], access_kind[], int, boolean)
  to anon, authenticated;
