-- M2: accounts, submissions, and code history.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- A profile row must exist before anything can reference it. Created on
-- signup rather than lazily, so the foreign keys on reports, comments and
-- credit_ledger can never dangle.
-- ---------------------------------------------------------------------------
create or replace function handle_new_user()
returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    -- Google gives us a name; fall back to the local part of the email rather
    -- than exposing the full address as a public display name.
    coalesce(
      nullif(new.raw_user_meta_data->>'full_name', ''),
      nullif(new.raw_user_meta_data->>'name', ''),
      split_part(coalesce(new.email, 'someone@'), '@', 1)
    )
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Backfill anyone who signed up before this ran.
insert into public.profiles (id, display_name)
select u.id, split_part(coalesce(u.email, 'someone@'), '@', 1)
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id);

-- ---------------------------------------------------------------------------
-- Submitting a bathroom, optionally with its code, as one atomic unit.
-- ---------------------------------------------------------------------------
create or replace function submit_bathroom(
  p_name           text,
  p_lat            float8,
  p_lng            float8,
  p_venue_type     text,
  p_access_kind    text,
  p_address        text    default null,
  p_floor_hint     text    default null,
  p_code           text    default null,
  p_wheelchair     boolean default null,
  p_changing_table boolean default null,
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

  -- Duplicates are the quiet killer of a crowdsourced map. Reject an obvious
  -- one and name what is already there, rather than silently stacking pins.
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
    p_wheelchair, p_changing_table, p_gender_neutral, v_user)
  returning id into v_id;

  if nullif(trim(p_code), '') is not null then
    insert into bathroom_codes (bathroom_id, code, submitted_by)
    values (v_id, trim(p_code), v_user);
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- ---------------------------------------------------------------------------
-- Codes rotate. A new one supersedes the old rather than overwriting it, so
-- the history is intact and "this changed last Tuesday" stays answerable.
-- ---------------------------------------------------------------------------
create or replace function submit_code(p_bathroom_id uuid, p_code text)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid := auth.uid();
  v_old  uuid;
  v_new  uuid;
begin
  if v_user is null then
    raise exception 'sign in to add a code' using errcode = '42501';
  end if;
  if is_banned(v_user) then
    raise exception 'this account cannot submit' using errcode = '42501';
  end if;
  if coalesce(length(trim(p_code)), 0) = 0 then
    raise exception 'a code is required' using errcode = '22023';
  end if;
  if not exists (select 1 from bathrooms
                 where id = p_bathroom_id and status = 'active') then
    raise exception 'no such place' using errcode = 'P0002';
  end if;

  select id into v_old from bathroom_codes
  where bathroom_id = p_bathroom_id and superseded_at is null;

  -- Same code again is a confirmation, not a change.
  if v_old is not null and
     (select code from bathroom_codes where id = v_old) = trim(p_code) then
    return jsonb_build_object('ok', true, 'changed', false, 'id', v_old);
  end if;

  insert into bathroom_codes (bathroom_id, code, submitted_by)
  values (p_bathroom_id, trim(p_code), v_user)
  returning id into v_new;

  if v_old is not null then
    update bathroom_codes
    set superseded_at = now(), superseded_by = v_new
    where id = v_old;
  end if;

  return jsonb_build_object('ok', true, 'changed', true, 'id', v_new);
end $$;

grant execute on function submit_bathroom(
  text, float8, float8, text, text, text, text, text, boolean, boolean, boolean)
  to authenticated;
grant execute on function submit_code(uuid, text) to authenticated;
