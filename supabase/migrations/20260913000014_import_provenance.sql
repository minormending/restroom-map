-- Generalise import provenance.
--
-- osm_id was added when OpenStreetMap was the only import anyone had in mind.
-- There are at least three plausible sources (OSM, NYC Open Data, Refuge
-- Restrooms), they carry different licences, and the licence is the thing that
-- determines what you may do with a row — so it has to be recorded per row,
-- not assumed.
--
-- Nothing has been imported yet (osm_id is null on all 32 rows), so this is a
-- rename rather than a migration of data.

set search_path = public, extensions;

-- The insert policy references osm_id, so it has to go first. Dropping with
-- CASCADE would have taken the policy with it silently and left the table
-- insertable by anyone authenticated.
drop policy if exists bathrooms_insert on bathrooms;

alter table bathrooms drop column if exists osm_id;

alter table bathrooms add column if not exists import_source  text;
alter table bathrooms add column if not exists import_id      text;
alter table bathrooms add column if not exists import_licence text;

-- Re-running an import must update rather than duplicate.
create unique index if not exists bathrooms_import_key
  on bathrooms (import_source, import_id)
  where import_source is not null;

create index if not exists bathrooms_imported
  on bathrooms (import_source) where import_source is not null;

comment on column bathrooms.import_source is
  'Null for user submissions. Set for imported rows so they stay separable — '
  'which matters for ODbL share-alike, and for telling contributed data from '
  'bulk-loaded data when judging whether the map is actually being used.';

-- Clients must not be able to claim a row is an import.
create policy bathrooms_insert on bathrooms for insert to authenticated
  with check (
    created_by = auth.uid()
    and import_source is null
    and status = 'active'
    and not is_banned(auth.uid())
    and daily_submissions(auth.uid()) < 5
  );
