-- Grants for the moved objects.
--
-- The import carried tables, types, functions, views, indexes, policies and
-- triggers, but not GRANT statements — so anon and authenticated had no
-- privileges on anything in restroom and the app could not read a row. RLS
-- policies do not help when the role cannot reach the table at all.

set search_path = restroom, public, extensions;

GRANT ALL ON FUNCTION restroom.bathrooms_in_view(min_lng double precision, min_lat double precision, max_lng double precision, max_lat double precision, types restroom.venue_type[], access restroom.access_kind[], max_results integer, needs text[]) TO anon;
GRANT ALL ON FUNCTION restroom.bathrooms_in_view(min_lng double precision, min_lat double precision, max_lng double precision, max_lat double precision, types restroom.venue_type[], access restroom.access_kind[], max_results integer, needs text[]) TO authenticated;
REVOKE ALL ON FUNCTION restroom.get_code(p_bathroom_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION restroom.get_code(p_bathroom_id uuid) TO anon;
GRANT ALL ON FUNCTION restroom.get_code(p_bathroom_id uuid) TO authenticated;
GRANT ALL ON FUNCTION restroom.settled_value(p_bathroom uuid, p_field restroom.access_field) TO anon;
GRANT ALL ON FUNCTION restroom.settled_value(p_bathroom uuid, p_field restroom.access_field) TO authenticated;
GRANT ALL ON FUNCTION restroom.submit_access_claim(p_bathroom_id uuid, p_field text, p_value text) TO authenticated;
GRANT ALL ON FUNCTION restroom.submit_bathroom(p_name text, p_lat double precision, p_lng double precision, p_venue_type text, p_access_kind text, p_address text, p_floor_hint text, p_code text, p_wheelchair text, p_changing_table text, p_gender_neutral boolean) TO authenticated;
GRANT ALL ON FUNCTION restroom.submit_code(p_bathroom_id uuid, p_code text) TO authenticated;
GRANT ALL ON FUNCTION restroom.submit_report(p_bathroom_id uuid, p_kind text, p_code_id uuid, p_lat double precision, p_lng double precision) TO anon;
GRANT ALL ON FUNCTION restroom.submit_report(p_bathroom_id uuid, p_kind text, p_code_id uuid, p_lat double precision, p_lng double precision) TO authenticated;
GRANT ALL ON FUNCTION restroom.unlock_code(p_bathroom_id uuid) TO authenticated;
GRANT ALL ON FUNCTION restroom.unlock_cost() TO anon;
GRANT ALL ON FUNCTION restroom.unlock_cost() TO authenticated;
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE restroom.access_claims TO anon;
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE restroom.access_claims TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE restroom.access_claims TO service_role;
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE restroom.access_claim_state TO anon;
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE restroom.access_claim_state TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE restroom.access_claim_state TO service_role;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE restroom.bathroom_codes TO anon;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE restroom.bathroom_codes TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE restroom.bathroom_codes TO service_role;
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE restroom.bathrooms TO anon;
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE restroom.bathrooms TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE restroom.bathrooms TO service_role;
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE restroom.reports TO anon;
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE restroom.reports TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE restroom.reports TO service_role;
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE restroom.bathroom_confidence TO anon;
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE restroom.bathroom_confidence TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE restroom.bathroom_confidence TO service_role;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE restroom.code_unlocks TO anon;
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE restroom.code_unlocks TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE restroom.code_unlocks TO service_role;
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE restroom.comments TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE restroom.comments TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE restroom.comments TO service_role;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE restroom.credit_ledger TO anon;
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE restroom.credit_ledger TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE restroom.credit_ledger TO service_role;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE restroom.moderation_queue TO anon;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE restroom.moderation_queue TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE restroom.moderation_queue TO service_role;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE restroom.user_credits TO anon;
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE restroom.user_credits TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE restroom.user_credits TO service_role;
