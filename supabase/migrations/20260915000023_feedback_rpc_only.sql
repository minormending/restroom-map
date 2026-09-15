-- The two insert policies on `feedback` could never be evaluated, so they went.
--
-- They were copied from `flags`, which carries a table-level INSERT grant to
-- anon and authenticated alongside its policies. `feedback` has no such grant:
-- every write goes through submit_feedback(), which is security definer, and a
-- security definer function is not subject to either the grant or the policy.
--
-- So the policies described a path nothing could take. Left in place they read
-- as protection, and the next person to add a grant would believe the checking
-- had already been thought about.
--
-- No grant is the better shape here, and it is worth saying why rather than
-- treating it as an oversight in flags. submit_flag() rate-limits to ten a day
-- and a client can skip it entirely by inserting into flags directly, because
-- the grant is there. Feedback has one door, and rl_take is nailed to it.

set search_path = public, extensions;

drop policy if exists feedback_insert_auth on feedback;
drop policy if exists feedback_insert_anon on feedback;

-- RLS stays on with no policies at all: the deny-everything default, which is
-- what this table wants from every caller that is not the function.
