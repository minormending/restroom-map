-- M4: codes cost credits.
--
-- This is the change the schema was shaped around: can_view_code() was the
-- single gate from day one, so flipping it needs no migration of data, no
-- client rewrite, and no policy surgery. Reverting is equally one function.
--
-- Three carve-outs, because the failure mode of gating is a person standing
-- outside a locked door with an empty balance:
--   * a place you submitted is always free to you
--   * a code you submitted is always free to you
--   * an unlock is permanent — you never pay twice for the same door

set search_path = public, extensions;

create table code_unlocks (
  user_id     uuid not null references profiles(id) on delete cascade,
  bathroom_id uuid not null references bathrooms(id) on delete cascade,
  unlocked_at timestamptz not null default now(),
  primary key (user_id, bathroom_id)
);

alter table code_unlocks enable row level security;
create policy unlocks_read_own on code_unlocks for select to authenticated
  using (user_id = auth.uid());
-- No insert policy: unlock_code() is the only way in.
grant select on code_unlocks to authenticated;

-- One place to tune the price.
create or replace function unlock_cost()
returns int language sql immutable as $$ select 2; $$;

-- ---------------------------------------------------------------------------
-- The gate.
-- ---------------------------------------------------------------------------
create or replace function can_view_code(p_user uuid, p_bathroom uuid)
returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select p_user is not null and (
    exists (select 1 from bathrooms
            where id = p_bathroom and created_by = p_user)
    or exists (select 1 from bathroom_codes
               where bathroom_id = p_bathroom and submitted_by = p_user)
    or exists (select 1 from code_unlocks
               where user_id = p_user and bathroom_id = p_bathroom)
  );
$$;

-- ---------------------------------------------------------------------------
-- get_code now reports a locked code as a state, not an exception. Being
-- locked is an expected answer to a reasonable question, and the UI needs the
-- price to say anything useful about it.
-- ---------------------------------------------------------------------------
drop function if exists get_code(uuid);

create function get_code(p_bathroom_id uuid)
returns table (code text, submitted_at timestamptz, confirms int,
               locked boolean, cost int)
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_live   record;
  v_may    boolean := can_view_code(auth.uid(), p_bathroom_id);
begin
  select bc.id, bc.code, bc.created_at into v_live
  from bathroom_codes bc
  where bc.bathroom_id = p_bathroom_id and bc.superseded_at is null
  limit 1;

  if not found then
    return;   -- no code recorded; nothing to lock or reveal
  end if;

  return query select
    case when v_may then v_live.code else null end,
    v_live.created_at,
    (select count(*)::int from reports r
     where r.code_id = v_live.id and r.kind = 'works'),
    not v_may,
    unlock_cost();
end $$;

revoke execute on function get_code(uuid) from public;
grant  execute on function get_code(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Spending.
-- ---------------------------------------------------------------------------
create or replace function unlock_code(p_bathroom_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user    uuid := auth.uid();
  v_cost    int  := unlock_cost();
  v_balance int;
  v_code    text;
begin
  if v_user is null then
    raise exception 'sign in to unlock a code' using errcode = '42501';
  end if;

  -- Serialise this user's spending. Without the lock, two unlocks issued at
  -- once both read the old balance and a 2-credit account buys two doors.
  perform 1 from profiles where id = v_user for update;

  if can_view_code(v_user, p_bathroom_id) then
    select bc.code into v_code from bathroom_codes bc
    where bc.bathroom_id = p_bathroom_id and bc.superseded_at is null;
    return jsonb_build_object('ok', true, 'charged', 0, 'code', v_code);
  end if;

  select bc.code into v_code from bathroom_codes bc
  where bc.bathroom_id = p_bathroom_id and bc.superseded_at is null;
  if v_code is null then
    raise exception 'no code recorded for that place' using errcode = 'P0002';
  end if;

  select coalesce(sum(delta), 0)::int into v_balance
  from credit_ledger where user_id = v_user;

  if v_balance < v_cost then
    return jsonb_build_object(
      'ok', false, 'reason', 'insufficient',
      'balance', v_balance, 'cost', v_cost);
  end if;

  insert into credit_ledger (user_id, delta, reason, ref_type, ref_id)
  values (v_user, -v_cost, 'spend_unlock', 'bathroom', p_bathroom_id);

  insert into code_unlocks (user_id, bathroom_id)
  values (v_user, p_bathroom_id)
  on conflict do nothing;

  return jsonb_build_object(
    'ok', true, 'charged', v_cost, 'code', v_code,
    'balance', v_balance - v_cost);
end $$;

grant execute on function unlock_code(uuid) to authenticated;
grant execute on function unlock_cost() to anon, authenticated;
