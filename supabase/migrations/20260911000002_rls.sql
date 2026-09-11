-- Row-level security.
--
-- The governing principle: RLS DENIES BY DEFAULT. Once enabled on a table, an
-- operation with no matching policy is refused. So the absence of an `update`
-- policy on `bathrooms` is not an oversight — it is the mechanism. Clients
-- never mutate existing rows; edits route through functions.

-- ---------- guard helpers ----------
-- These must be `security definer`. An inline subquery in a policy runs under
-- the CALLER's RLS: a hidden bathroom would return no rows, the guard would
-- silently pass, and a user could farm reports against their own submissions.

set search_path = public, extensions;

create or replace function owns_bathroom(p_user uuid, p_bathroom uuid)
returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (
    select 1 from bathrooms
    where id = p_bathroom and created_by = p_user);   -- sees all rows
$$;

create or replace function is_banned(p_user uuid)
returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(
    (select banned_at is not null from profiles where id = p_user), false);
$$;

create or replace function daily_submissions(p_user uuid)
returns int
language sql stable security definer set search_path = public, extensions as $$
  select count(*)::int from bathrooms
  where created_by = p_user and created_at > now() - interval '24 hours';
$$;

-- ---------- enable ----------
alter table bathrooms      enable row level security;
alter table bathroom_codes enable row level security;
alter table reports        enable row level security;
alter table comments       enable row level security;
alter table credit_ledger  enable row level security;
alter table profiles       enable row level security;
alter table flags          enable row level security;

-- ---------- bathrooms ----------
create policy bathrooms_read on bathrooms for select
  using (status = 'active');

create policy bathrooms_insert on bathrooms for insert to authenticated
  with check (
    created_by = auth.uid()
    and osm_id is null          -- clients cannot claim to be an import
    and status = 'active'
    and not is_banned(auth.uid())
    and daily_submissions(auth.uid()) < 5
  );
-- No update/delete policy: clients cannot mutate or remove. By design.

-- ---------- codes ----------
-- NO select policy at all. Codes are only reachable through get_code().
create policy codes_insert on bathroom_codes for insert to authenticated
  with check (submitted_by = auth.uid() and not is_banned(auth.uid()));

-- ---------- reports ----------
create policy reports_read on reports for select using (true);

create policy reports_insert on reports for insert to authenticated
  with check (
    user_id = auth.uid()
    and geo_verified = false    -- only the edge function may set this true
    and not owns_bathroom(auth.uid(), bathroom_id)
  );
-- Anonymous reports get NO policy. They go through an edge function so they
-- can be IP rate-limited before insert.

-- ---------- comments ----------
create policy comments_read on comments for select
  using (hidden_at is null);
create policy comments_insert on comments for insert to authenticated
  with check (user_id = auth.uid() and not is_banned(auth.uid()));
create policy comments_delete_own on comments for delete to authenticated
  using (user_id = auth.uid());

-- ---------- profiles ----------
create policy profiles_read on profiles for select using (true);
create policy profiles_update_own on profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- ---------- flags ----------
-- Anyone may report; nobody may read the queue but staff (service_role).
create policy flags_insert_auth on flags for insert to authenticated
  with check (reporter_id = auth.uid() or reporter_id is null);
create policy flags_insert_anon on flags for insert to anon
  with check (reporter_id is null);

-- ---------- credits ----------
create policy ledger_read_own on credit_ledger for select to authenticated
  using (user_id = auth.uid());
-- NO insert/update/delete policy, for anyone, ever. Only service_role and
-- security-definer functions write credits.
