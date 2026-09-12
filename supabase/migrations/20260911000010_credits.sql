-- M3: the credit economy.
--
-- Nothing pays out at submission time. Awards sit in escrow until independent
-- people confirm the thing is real, which is what makes a fake submission cost
-- effort and return nothing. Every write goes through this file's functions —
-- credit_ledger has no insert policy for any client role.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- code_id was never populated: the client doesn't send it, and it shouldn't,
-- because a client could name any code row it liked. Resolve the live code
-- server-side instead, so confirmations attach to the code actually on offer.
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
  v_code   uuid;
  v_row    record;
begin
  begin
    v_kind := p_kind::report_kind;
  exception when invalid_text_representation then
    raise exception 'unknown report kind: %', p_kind using errcode = '22023';
  end;

  perform 1 from bathrooms where id = p_bathroom_id and status = 'active';
  if not found then
    raise exception 'no such bathroom' using errcode = 'P0002';
  end if;

  if owns_bathroom(v_user, p_bathroom_id) then
    raise exception 'you cannot report your own submission' using errcode = '42501';
  end if;

  if not rl_take('ip:' || v_fp, interval '1 hour', 40) then
    raise exception 'too many reports, try later' using errcode = '53400';
  end if;

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

  -- Whatever the caller claimed, attach to the code currently live.
  select id into v_code from bathroom_codes
  where bathroom_id = p_bathroom_id and superseded_at is null;

  begin
    insert into reports (bathroom_id, code_id, user_id, anon_id, kind, geo_verified)
    values (p_bathroom_id, v_code, v_user,
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

-- ---------------------------------------------------------------------------
-- Caps
-- ---------------------------------------------------------------------------
create or replace function daily_passive(p_user uuid)
returns int
language sql stable security definer set search_path = public, extensions as $$
  select count(*)::int from credit_ledger
  where user_id = p_user
    and reason = 'passive_confirmation'
    and created_at > now() - interval '24 hours';
$$;

-- ---------------------------------------------------------------------------
-- Awards. The only thing in the system that writes to the ledger.
-- ---------------------------------------------------------------------------
create or replace function award_on_report()
returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_owner      uuid;
  v_confirms   int;
  v_geo        int;
  v_code_owner uuid;
begin
  -- Anonymous reports inform freshness. They never move credits: a cleared
  -- cookie must not be worth anything.
  if NEW.kind <> 'works' or NEW.user_id is null then
    return NEW;
  end if;

  select created_by into v_owner from bathrooms where id = NEW.bathroom_id;
  if v_owner is null then
    return NEW;   -- imported row, nobody to pay
  end if;

  -- ESCROW RELEASE. Confirmations only count from accounts older than a day,
  -- so a batch of sockpuppets minted this morning cannot release anything.
  select count(distinct r.user_id),
         count(distinct r.user_id) filter (where r.geo_verified)
    into v_confirms, v_geo
  from reports r
  join profiles p on p.id = r.user_id
  where r.bathroom_id = NEW.bathroom_id
    and r.kind = 'works'
    and r.user_id is distinct from v_owner
    and p.created_at < now() - interval '24 hours';

  if v_confirms >= 3 and v_geo >= 2 then
    insert into credit_ledger (user_id, delta, reason, ref_type, ref_id)
    values (v_owner, 10, 'submission_verified', 'bathroom', NEW.bathroom_id)
    on conflict do nothing;              -- ledger_dedupe pays exactly once
  end if;

  -- The code that was actually tested.
  if NEW.code_id is not null then
    select submitted_by into v_code_owner
    from bathroom_codes where id = NEW.code_id;

    if v_code_owner is not null and v_code_owner is distinct from NEW.user_id then
      -- First independent confirmation of this specific code row.
      insert into credit_ledger (user_id, delta, reason, ref_type, ref_id)
      values (v_code_owner, 5, 'code_verified', 'code', NEW.code_id)
      on conflict do nothing;

      -- And a trickle per confirmation, capped so a popular code is not a
      -- salary.
      if daily_passive(v_code_owner) < 10 then
        insert into credit_ledger (user_id, delta, reason, ref_type, ref_id)
        values (v_code_owner, 1, 'passive_confirmation', 'report', NEW.id)
        on conflict do nothing;
      end if;
    end if;
  end if;

  return NEW;
end $$;

drop trigger if exists reports_award on reports;
create trigger reports_award after insert on reports
  for each row execute function award_on_report();

-- ---------------------------------------------------------------------------
-- Signup bonus, so the profile page is not an empty box on day one.
-- ---------------------------------------------------------------------------
create or replace function handle_new_user()
returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data->>'full_name', ''),
      nullif(new.raw_user_meta_data->>'name', ''),
      split_part(coalesce(new.email, 'someone@'), '@', 1)
    )
  )
  on conflict (id) do nothing;

  insert into public.credit_ledger (user_id, delta, reason, ref_type, ref_id)
  values (new.id, 5, 'signup_bonus', 'profile', new.id)
  on conflict do nothing;

  return new;
end $$;

-- Anyone who signed up before this existed.
insert into credit_ledger (user_id, delta, reason, ref_type, ref_id)
select p.id, 5, 'signup_bonus', 'profile', p.id from profiles p
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Clawback. Only takes back what was actually paid, so a bogus submission
-- that never cleared escrow cannot push a balance negative.
-- ---------------------------------------------------------------------------
create or replace function apply_auto_hide()
returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_score     numeric;
  v_reporters int;
  v_owner     uuid;
begin
  if NEW.kind not in ('gone', 'code_bad') then
    return NEW;
  end if;

  select score, trouble_reporters_90d into v_score, v_reporters
  from bathroom_confidence where bathroom_id = NEW.bathroom_id;

  if coalesce(v_score, 0) < -3 and coalesce(v_reporters, 0) >= 3 then
    update bathrooms set status = 'hidden'
    where id = NEW.bathroom_id and status = 'active'
    returning created_by into v_owner;

    if v_owner is not null and exists (
      select 1 from credit_ledger
      where reason = 'submission_verified' and ref_id = NEW.bathroom_id
    ) then
      insert into credit_ledger (user_id, delta, reason, ref_type, ref_id)
      values (v_owner, -10, 'fraud_clawback', 'bathroom', NEW.bathroom_id)
      on conflict do nothing;
    end if;

    insert into flags (target_type, target_id, reason)
    values ('bathroom', NEW.bathroom_id, 'auto-hidden: sustained trouble reports');
  end if;

  return NEW;
end $$;
