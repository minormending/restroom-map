-- submit_flag's rate limit was optional, because the table took writes directly.
--
-- flags carried a table-level INSERT grant to anon and authenticated alongside
-- an RLS policy that asked only `reporter_id is null`. So the intended path —
-- submit_flag(), which takes ten a day per fingerprint — could be skipped
-- entirely by posting to the table, anonymously and without limit.
--
-- This is the table that receives takedown requests. Filling it is how you
-- bury one.
--
-- Nothing legitimate used that door: the client calls the RPC (lib/reports.ts),
-- and db.mjs writes as the owner, which grants do not apply to. So the fix is
-- to take the grant away and let the function be the only way in — the shape
-- `feedback` was given in migration 023, arrived at from the other direction.
--
-- The policies go with it. Unreachable without the grant, they would read as
-- protection to the next person, which is how this one survived: two rules
-- that both looked like access control, neither of them checking the thing
-- that mattered.

set search_path = public, extensions;

revoke insert on flags from anon, authenticated;

drop policy if exists flags_insert_anon on flags;
drop policy if exists flags_insert_auth on flags;

-- RLS stays on with no policies: deny everything that is not the function or
-- the owner. submit_flag is security definer and unaffected.
