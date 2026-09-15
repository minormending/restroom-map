-- The other three doors beside the locked ones.
--
-- Same shape as the flags bypass closed in 024: a table-level INSERT grant
-- sitting next to a security-definer function that is the only path anything
-- actually takes. Checked before revoking — every client write goes through an
-- RPC (src/lib/submissions.ts, src/lib/reports.ts), and the importers and
-- db.mjs write as the owner, which grants do not apply to.
--
-- None of these was as bad as flags, which was anonymous and unbounded on the
-- table that receives takedown requests. Each of these policies binds the row
-- to the account writing it, and two of them carry a real limit. What a direct
-- insert skipped was the part the function does and the policy cannot:
--
--   reports         both rate limits in submit_report — 40 an hour per address
--                   and the per-place one. The policy still pins user_id and
--                   forces geo_verified = false, so a forged "I was there"
--                   was never possible, and auto-hide counts distinct
--                   reporters, so one account could not hide a place. What was
--                   available was unbounded noise against somebody else's
--                   listing.
--
--   bathrooms       the 20m duplicate check. The policy caps submissions at
--                   five a day, so this was five junk pins a day rather than
--                   unlimited — still five that submit_bathroom would have
--                   refused for landing on top of an existing place.
--
--   bathroom_codes  the rotation and supersede logic in submit_code. A code
--                   written directly is a row the function would have made
--                   supersede the previous one, so the map could end up
--                   showing two current codes for one door.
--
-- comments keeps its grant: the client genuinely inserts and deletes there
-- directly, and its policy is the access control rather than a decoration.
--
-- profiles keeps its UPDATE for now. Nothing in the client uses it either, but
-- unlike these three there is no function behind it to route through, so
-- revoking would leave no path at all for a display name somebody may well
-- want to edit. That one wants a decision, not a revoke.

set search_path = public, extensions;

revoke insert on reports        from anon, authenticated;
revoke insert on bathrooms      from anon, authenticated;
revoke insert on bathroom_codes from anon, authenticated;

-- The policies go with the grants. Unreachable, they read as protection —
-- which is exactly how the flags one survived long enough to be exploitable.
drop policy if exists reports_insert    on reports;
drop policy if exists bathrooms_insert  on bathrooms;
drop policy if exists codes_insert      on bathroom_codes;

-- The read policies stay. Only the write door is closing here: bathrooms are
-- still selectable by anybody, which is the whole map.
