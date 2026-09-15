-- Places that close for the winter.
--
-- NYC Parks winterises most of its comfort stations: 105 of the park restrooms
-- already on this map are recorded as shut from roughly November to April,
-- nearly all of them for the same reason — the building has no heat, so the
-- pipes would freeze.
--
-- WHY THIS IS A COLUMN AND NOT AN hours_kind
--
-- hours_kind answers "open at this hour". Seasonal closure answers "open this
-- month". They compose rather than replace each other: a park restroom is
-- open while the park is open, during the half of the year it is open at all.
-- Folding one into the other would force a choice between losing the daily
-- answer and losing the yearly one.
--
-- WHY IT DOES NOT TOUCH THE 'open_now' FILTER
--
-- It would be free to add, and it would change nothing. Every park restroom
-- imported from the city carries hours = 'venue', and 'venue' never matches
-- 'open now' — the filter already refuses to claim a park's hours it does not
-- know. Wiring seasonality into a filter that is already saying no would be
-- machinery with no effect, so this stays what it is: a fact shown on the
-- place, for somebody deciding whether to walk there in February.
--
-- NOT CLAIMABLE, deliberately. The corroboration rule needs two people to give
-- the same answer, and nobody standing outside a restroom in July can see
-- whether it shuts in December. This one only ever comes from the operator.

set search_path = public, extensions;

alter table bathrooms add column if not exists closed_in_winter boolean;

comment on column bathrooms.closed_in_winter is
  'True when the operator closes this for the season — almost always an '
  'unheated park comfort station. Imported from NYC Parks (9byw-znpj); not '
  'claimable, because it is not visible to somebody standing there today.';
