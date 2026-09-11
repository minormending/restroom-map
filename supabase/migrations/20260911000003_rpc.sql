-- Freshness, the viewport read, and the single gate for code visibility.

-- A raw count is the wrong signal: twelve confirmations from eighteen months
-- ago mean less than two from Tuesday, because codes rotate. Weight by age.
create view bathroom_confidence as
select
  b.id as bathroom_id,
  count(*) filter (where r.kind = 'works'
        and r.created_at > now() - interval '90 days')::int as confirms_90d,
  count(*) filter (where r.kind in ('gone','code_bad')
        and r.created_at > now() - interval '90 days')::int as troubles_90d,
  max(r.created_at) filter (where r.kind = 'works') as last_confirmed_at,
  -- Exponential decay, 30-day half-life; trouble counts double.
  coalesce(sum(
    case when r.kind = 'works' then 1.0 else -2.0 end
    * exp(-extract(epoch from now() - r.created_at) / 2592000.0)
  ), 0)::numeric(6,2) as score
from bathrooms b left join reports r on r.bathroom_id = b.id
group by b.id;

-- Start as a plain view. Convert to a materialized view refreshed on a
-- schedule once this slows down, not before.

-- The query the whole app rests on: one indexed bbox test with the filters
-- applied in the same pass. Note what it does NOT return — the code.
create or replace function bathrooms_in_view(
  min_lng float8, min_lat float8, max_lng float8, max_lat float8,
  types   venue_type[]  default null,
  access  access_kind[] default null,
  max_results int default 300)
returns table (
  id uuid, lat float8, lng float8, name text,
  venue_type venue_type, access_kind access_kind,
  has_code boolean, confirms int, troubles int, last_confirmed timestamptz)
language sql stable security definer set search_path = public as $$
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
    -- Index-accelerated bbox test against the GiST index on geog.
    and b.geog && st_makeenvelope(min_lng, min_lat, max_lng, max_lat, 4326)::geography
    and (types  is null or b.venue_type  = any(types))
    and (access is null or b.access_kind = any(access))
  order by f.confirms_90d desc nulls last
  limit max_results;
$$;

-- v0: everyone sees codes. To ship tiers later, this ONE function changes.
-- No migration, no client rewrite, no policy surgery.
create or replace function can_view_code(p_user uuid, p_bathroom uuid)
returns boolean language sql stable as $$ select true; $$;

create or replace function get_code(p_bathroom_id uuid)
returns table (code text, submitted_at timestamptz, confirms int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not can_view_code(auth.uid(), p_bathroom_id) then
    raise exception 'code_locked' using errcode = '42501';
  end if;
  return query
    select bc.code, bc.created_at,
           (select count(*)::int from reports r
            where r.code_id = bc.id and r.kind = 'works')
    from bathroom_codes bc
    where bc.bathroom_id = p_bathroom_id and bc.superseded_at is null
    limit 1;
end $$;

revoke execute on function get_code(uuid) from public;
grant  execute on function get_code(uuid) to anon, authenticated;
grant  execute on function bathrooms_in_view(
  float8, float8, float8, float8, venue_type[], access_kind[], int)
  to anon, authenticated;

grant select on bathroom_confidence to anon, authenticated;
