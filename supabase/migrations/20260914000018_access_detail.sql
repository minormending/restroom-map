-- What a restroom is like, for the people who have to know before they go.
--
-- The map already says whether a place is step-free, has a changing table and
-- has an all-gender option. That is enough to answer "is there a toilet" and
-- not enough to answer the question this project is actually for: will it work
-- for me. Those are different questions, and the second one is the one nobody
-- else answers. Google Maps knows the restroom exists.
--
-- Every column here had to pass the same test: can somebody standing in the
-- room answer it in two seconds, without a tape measure. A field that needs
-- measuring is a field that stays null, and migration 015 already recorded
-- what null columns do to a feature — they make filters that can only ever
-- return nothing.
--
-- Each one serves a named group rather than a vague notion of accessibility:
--
--   adult_changing   carers of adults and older children. A bench and a hoist
--                    is the single most searched-for and least recorded thing
--                    in every restroom map that exists. Without one, a day out
--                    ends when the nappy does.
--   grab_bars        anyone who transfers, or who cannot lower themselves
--                    unaided.
--   turning_space    wheelchair users. Note this is the one field best
--                    answered by somebody who uses a chair — a standing
--                    contributor will guess, and guessing yes here costs
--                    somebody a wasted journey.
--   accessible_locked  the accessible stall kept locked, key with staff. An
--                    accessible toilet you cannot get into is not one, and
--                    "it exists" is the answer that sends you there.
--   sink_in_stall    ostomy and catheter care, and anybody who cannot cross a
--                    room mid-task. A sink outside the cubicle makes a private
--                    task public.
--   shelf            ostomy care needs somewhere to put supplies that is not
--                    the floor. Cited more often than almost anything else,
--                    recorded almost nowhere.
--
-- Nothing populates these on day one. That is deliberate and it is the point:
-- NYC Open Data does not carry any of them, no open dataset does, and that is
-- precisely why the map is worth contributing to. The submission path and the
-- detail sheet come next; until then they read as unknown, which is honest.

set search_path = public, extensions;

-- A bench alone and a full Changing Places facility are different answers to
-- the same question, and somebody in the room can tell which by whether there
-- is a hoist on the ceiling.
do $$ begin
  create type adult_changing_kind as enum ('changing_places', 'bench', 'none');
exception when duplicate_object then null;
end $$;

alter table bathrooms
  add column if not exists adult_changing    adult_changing_kind,
  add column if not exists grab_bars         boolean,
  add column if not exists turning_space     boolean,
  add column if not exists accessible_locked boolean,
  add column if not exists sink_in_stall     boolean,
  add column if not exists shelf             boolean;

comment on column bathrooms.adult_changing is
  'Adult-sized changing bench. changing_places means a hoist as well, which is '
  'the difference between a facility somebody can use and one they cannot.';
comment on column bathrooms.turning_space is
  'Room to turn a wheelchair. Best answered by somebody who uses one — a '
  'standing contributor guesses, and a wrong yes costs a wasted journey.';
comment on column bathrooms.accessible_locked is
  'The accessible stall is kept locked. Not a reason to hide the place: it is '
  'a reason to say so, since the key is usually behind a counter.';

-- ---------------------------------------------------------------------------
-- Filtering. The viewport function was growing one boolean per need, which was
-- already three and would now be nine — a signature nobody can read and every
-- caller has to pass positionally. One array instead, so adding a need later
-- is a value rather than another migration of the same function.
-- ---------------------------------------------------------------------------
drop function if exists bathrooms_in_view(
  float8, float8, float8, float8, venue_type[], access_kind[], int,
  boolean, boolean, boolean);

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
    -- Unknown is never a match, for any of these. Somebody filtering on a need
    -- is telling you the trip is wasted without it, and "we don't know" is not
    -- a reason to send them.
    and (needs is null or (
      (not ('changing'       = any(needs)) or b.changing_table in ('any','women_only','men_only'))
      -- 'partial' does not satisfy step-free. A partly accessible restroom is
      -- exactly the journey a wheelchair user cannot afford to waste.
      and (not ('step_free'      = any(needs)) or b.wheelchair = 'full')
      and (not ('gender_neutral' = any(needs)) or b.gender_neutral is true)
      and (not ('adult_changing' = any(needs)) or b.adult_changing in ('changing_places','bench'))
      and (not ('hoist'          = any(needs)) or b.adult_changing = 'changing_places')
      and (not ('grab_bars'      = any(needs)) or b.grab_bars is true)
      and (not ('turning_space'  = any(needs)) or b.turning_space is true)
      and (not ('sink_in_stall'  = any(needs)) or b.sink_in_stall is true)
      and (not ('shelf'          = any(needs)) or b.shelf is true)
      -- Expressed as an absence, but held to the same standard as the rest:
      -- known to be unlocked, not merely not known to be locked. `is not true`
      -- would quietly admit every place nobody has checked, which is the one
      -- rule this list does not bend.
      and (not ('unlocked'       = any(needs)) or b.accessible_locked is false)
    ))
  order by f.confirms_90d desc nulls last
  limit max_results;
$$;

grant execute on function bathrooms_in_view(
  float8, float8, float8, float8, venue_type[], access_kind[], int, text[])
  to anon, authenticated;
