-- Take back the privileges 028 handed out without meaning to.
--
-- 028 re-granted everything after the move into `restroom`, from a generated
-- list rather than by hand, and the list was wider than what it replaced.
-- Every table and view in the schema came out carrying TRUNCATE, REFERENCES,
-- TRIGGER and MAINTAIN for anon, authenticated and service_role. The file it
-- effectively replaced, 20260911000004_grants.sql, granted select, insert and
-- delete — each one deliberately, each with a comment saying why.
--
-- TRUNCATE is the one worth a migration. This project's rule is that a table
-- with a submit_* function in front of it has no write grant, because the
-- function is the door and its rate limits are not optional; bathrooms,
-- reports, bathroom_codes and access_claims all ended up holding a privilege
-- that empties the table, granted to anon.
--
-- It was not reachable. PostgREST maps HTTP onto SELECT, INSERT, UPDATE,
-- DELETE and RPC and never issues a TRUNCATE, so no request got there. That is
-- the reason this is a tidy-up rather than an incident, and not a reason to
-- leave it: the point of the rule is that the tables are closed, and "closed
-- except for a privilege nobody can currently reach" is a different and worse
-- claim to have to make.
--
-- service_role is included. It holds the same four on everything and nothing
-- in this project runs as service_role; after this it holds nothing here,
-- which is what the documentation already says.
--
-- SELECT is untouched, and so are INSERT and DELETE on comments — the one
-- deliberate exception, listed in scripts/tests/grants.test.mjs.

set search_path = restroom, public, extensions;

do $$
declare
  v_obj text;
begin
  -- Tables and views alike: a view carrying TRUNCATE is meaningless rather
  -- than dangerous, but leaving it makes the next reader wonder which of the
  -- two kinds of grant they are looking at.
  for v_obj in
    select quote_ident(n.nspname) || '.' || quote_ident(c.relname)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'restroom' and c.relkind in ('r', 'v', 'm', 'p')
    order by c.relname
  loop
    execute format(
      'revoke truncate, references, trigger, maintain on %s from anon, authenticated, service_role',
      v_obj);
  end loop;
end $$;

-- And stop the default from handing them out again. 0001 revoked default
-- privileges on tables for anon and authenticated; service_role was missed,
-- and a table created later would arrive with whatever the default says.
alter default privileges in schema restroom
  revoke all on tables from anon, authenticated, service_role;
