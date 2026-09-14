-- Give the operator its own column.
--
-- The NYC importer had nowhere to put `operator`, so it wrote "Operated by NYC
-- Parks" into floor_hint and the detail sheet rendered it under "Finding it".
-- It is not a floor hint. floor_hint is for "back left, past the registers" —
-- the sentence that gets you through the door once you have arrived — and 60
-- of the 70 rows that had one were using it to say something else entirely.
--
-- Two things were wrong with that beyond the label. Nobody could ask "show me
-- the library ones", because the answer was buried in free text. And the first
-- person to contribute a real floor hint for an imported place would have had
-- to delete the provenance to do it.
--
-- Operator is worth keeping properly: NYC Parks, NYPL, BPL and QPL are known
-- quantities in a way that "public restroom" is not, and knowing a restroom is
-- run by the library system tells you roughly what to expect from it.

set search_path = public, extensions;

alter table bathrooms add column if not exists operator text;

-- Move the 60 borrowed values across. The prefix is exactly what the importer
-- wrote, so anything not matching it is a real floor hint and is left alone.
update bathrooms
set operator   = nullif(trim(substring(floor_hint from 13)), ''),
    floor_hint = null
where floor_hint like 'Operated by %';

create index if not exists bathrooms_operator on bathrooms (operator)
  where status = 'active' and operator is not null;

comment on column bathrooms.operator is
  'Who runs the place, when that is known and meaningful — NYC Parks, NYPL. '
  'Provenance and a trust signal, not a location hint: floor_hint is for '
  'finding the door once you are there.';
