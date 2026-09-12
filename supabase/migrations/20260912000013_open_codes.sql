-- Open the codes back up.
--
-- M4 works and is tested, but shipping it now puts a sign-in wall on the one
-- thing a first-time visitor came for, in an economy with one participant and
-- nothing yet worth earning. Gating is a lever to pull once contributed data
-- is worth something — not before anyone has seen the map.
--
-- Nothing is torn out. code_unlocks, unlock_code() and unlock_cost() all stay,
-- and prior unlocks stay recorded. Re-enabling is the body of this one
-- function again, which is exactly the property the schema was built for.

set search_path = public, extensions;

create or replace function can_view_code(p_user uuid, p_bathroom uuid)
returns boolean language sql stable as $$ select true; $$;
