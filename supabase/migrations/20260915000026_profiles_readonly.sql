-- The last write grant that nothing used.
--
-- profiles carried UPDATE for authenticated with a policy of `id = auth.uid()`,
-- so the worst available move was editing your own row. Nothing in the client
-- ever did: profiles is read for a display name on a note and nowhere else, and
-- the name itself is derived by the signup trigger, which runs as the owner.
--
-- This one was left alone in 025 on purpose, and is being closed on a decision
-- rather than as an oversight — worth writing down, because the shape here is
-- the opposite of the others. Those had a function to route through, so taking
-- the grant away changed nothing about what was possible. This has no function
-- behind it, so afterwards there is NO path to a display name at all.
--
-- That is the intended state and not a gap to be patched around: a name is
-- derived at signup, shown next to what somebody contributes, and until there
-- is a reason to let it change, the honest posture is that it cannot. Whoever
-- wants an editor should add set_display_name() with whatever rate limit and
-- profanity question that deserves, and grant execute on the function — not
-- put this back.
--
-- The read policy stays. Display names are public and the map needs them.

set search_path = public, extensions;

revoke update on profiles from anon, authenticated;

drop policy if exists profiles_update_own on profiles;
