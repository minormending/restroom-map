-- Accessibility facts, and what it takes to believe one.
--
-- Migration 018 added six columns and nothing that could fill them. This is
-- the filling, and it is not a form that writes to a column — because one
-- person saying "there is a hoist" is not the same fact as two people saying
-- it, and somebody may cross a city on the strength of the difference.
--
-- So claims are rows, the way codes and credits already are here. A column
-- holds what is SETTLED. The claims table holds what individual people have
-- said. A field becomes settled when two people independently say the same
-- thing, and until then the sheet says who claimed what and that nobody has
-- corroborated it.
--
-- Three states fall out of that, and all three are worth showing:
--
--   settled      the column is set: either an official import, or two people
--                who agree. Shown as fact.
--   unconfirmed  exactly one person has said it. Shown, attributed, and
--                marked as resting on one account.
--   disputed     people have said different things and none has reached two.
--                Shown as the disagreement it is. Hiding it would be choosing
--                a side by silence.
--
-- FILL-ONLY. A claim is refused outright for a field that is already settled.
-- That keeps this migration small and keeps the hardest question — whose
-- answer wins when a settled fact is wrong — out of a release that is not
-- ready to answer it. The cost is real and belongs written down: a hoist that
-- gets removed stays on the map until somebody edits the database by hand.
-- Correcting settled facts needs its own design.

set search_path = public, extensions;

-- Naming the claimable fields as an enum rather than free text: a typo would
-- otherwise create a phantom field that silently collects claims forever.
create type access_field as enum (
  'wheelchair', 'changing_table', 'gender_neutral',
  'adult_changing', 'grab_bars', 'turning_space',
  'accessible_locked', 'sink_in_stall', 'shelf');

create table access_claims (
  bathroom_id uuid         not null references bathrooms(id) on delete cascade,
  field       access_field not null,
  value       text         not null,
  user_id     uuid         not null references profiles(id),
  created_at  timestamptz  not null default now(),
  -- One claim per person per field. Changing your mind replaces your own
  -- answer; it never touches anybody else's.
  primary key (bathroom_id, field, user_id)
);

create index access_claims_tally on access_claims (bathroom_id, field, value);

alter table access_claims enable row level security;

-- Everyone can read the tally: "one person said so" is information a reader
-- needs in order to weigh the answer, and hiding it would leave them unable
-- to tell a corroborated fact from a single account.
create policy claims_read on access_claims for select to anon, authenticated
  using (true);
-- No insert or update policy. submit_access_claim below is the only way in.
grant select on access_claims to anon, authenticated;

-- ---------------------------------------------------------------------------
-- What a field currently holds, in one place, so the sheet and the tests agree.
-- ---------------------------------------------------------------------------
create or replace function settled_value(p_bathroom uuid, p_field access_field)
returns text
language plpgsql stable security definer set search_path = public, extensions as $$
declare v text;
begin
  execute format('select %I::text from bathrooms where id = $1', p_field)
    into v using p_bathroom;
  return v;
end $$;

/**
 * The state of every field somebody has claimed, per place.
 *
 * Settled fields are absent from this view by design — once a column is set
 * the claims behind it stop being the interesting thing. What is left is the
 * work in progress: what people have said and whether anybody agrees.
 */
create or replace view access_claim_state with (security_invoker = true) as
with tally as (
  select bathroom_id, field, value, count(*)::int as claims
  from access_claims
  group by 1, 2, 3
)
select
  t.bathroom_id,
  t.field,
  t.value,
  t.claims,
  -- Disputed is about the field, not the value: it means somebody has said
  -- something else about this same field.
  (count(*) over (partition by t.bathroom_id, t.field)) > 1 as disputed
from tally t
where settled_value(t.bathroom_id, t.field) is null;

grant select on access_claim_state to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Promotion. Two people who agree settle the field.
-- ---------------------------------------------------------------------------
create or replace function promote_access_claim()
returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_winner text;
  v_winners int;
begin
  -- Values with enough agreement behind them. Two is the threshold: one is an
  -- account, two is a corroboration.
  select count(*), min(value) into v_winners, v_winner
  from (
    select value from access_claims
    where bathroom_id = NEW.bathroom_id and field = NEW.field
    group by value having count(*) >= 2
  ) agreed;

  -- Exactly one value reached two. If two different values both did, the
  -- field is genuinely contested and settling it would be picking a side.
  if v_winners = 1 then
    -- Still fill-only: never write over a column that already holds something.
    execute format(
      'update bathrooms set %I = $1::%s where id = $2 and %I is null',
      NEW.field,
      case NEW.field
        when 'wheelchair'     then 'wheelchair_access'
        when 'changing_table' then 'changing_table_access'
        when 'adult_changing' then 'adult_changing_kind'
        else 'boolean'
      end,
      NEW.field)
    using v_winner, NEW.bathroom_id;
  end if;

  return NEW;
end $$;

create trigger access_claims_promote after insert or update on access_claims
  for each row execute function promote_access_claim();

-- ---------------------------------------------------------------------------
-- Making a claim.
-- ---------------------------------------------------------------------------
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

  -- A value the column could not hold is a bug in the caller, and storing it
  -- would poison the tally for everybody.
  v_ok := case v_field
    when 'wheelchair'     then p_value in ('full','partial','none')
    when 'changing_table' then p_value in ('any','women_only','men_only','none')
    when 'adult_changing' then p_value in ('changing_places','bench','none')
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

grant execute on function submit_access_claim(uuid, text, text) to authenticated;
grant execute on function settled_value(uuid, access_field) to anon, authenticated;
