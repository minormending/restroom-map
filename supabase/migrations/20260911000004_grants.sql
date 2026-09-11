-- Explicit Data API grants.
--
-- The project is created with "automatically expose new tables" OFF, so a new
-- table reaches the Data API only if it is granted here. That is the point:
-- privileges and RLS become two independent gates instead of one.
--
-- Read this alongside 002_rls.sql. A grant says "this role may attempt the
-- operation"; a policy says "on these rows". Both must pass.

set search_path = public, extensions;

grant usage on schema public to anon, authenticated;

-- ---------- bathrooms: world-readable, submissions need an account ----------
grant select on bathrooms to anon, authenticated;
grant insert on bathrooms to authenticated;

-- ---------- codes: NO select grant, to anyone, ever ----------
-- Codes are reachable only through get_code(), which is security definer and
-- owns the gating rule. 002 also declines to write a select policy; this is
-- the second, independent lock.
grant insert on bathroom_codes to authenticated;

-- ---------- reports ----------
grant select on reports to anon, authenticated;
grant insert on reports to authenticated;
-- Anonymous reports are deliberately absent: they go through an edge function
-- so they can be IP rate-limited before insert.

-- ---------- comments ----------
grant select on comments to anon, authenticated;
grant insert, delete on comments to authenticated;

-- ---------- flags: anyone may report, nobody may read the queue ----------
grant insert on flags to anon, authenticated;

-- ---------- profiles ----------
grant select on profiles to anon, authenticated;
grant update on profiles to authenticated;

-- ---------- credits: read your own balance, never write ----------
-- No insert/update/delete to any client role. Only service_role and the
-- security-definer award function touch the ledger.
grant select on credit_ledger to authenticated;
grant select on user_credits  to authenticated;

grant select on bathroom_confidence to anon, authenticated;
