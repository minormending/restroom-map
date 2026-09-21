-- Restore the signup bonus, which the move to a shared database dropped.
--
-- This app's handle_new_user() did two jobs: create the profile, and award
-- five credits. In the shared database the profile half is map-kit's, shared
-- by every app, and it does not know about credits. Bolting the award onto it
-- would put one app's economy in the layer the others use.
--
-- So the award becomes this app's own trigger on the same event. The name
-- matters: same-event triggers fire in alphabetical order, and credit_ledger
-- references profiles(id), so this has to run after `on_auth_user_created`
-- has created the row. 'r' sorts after 'o'.

set search_path = restroom, public, extensions;

create or replace function restroom.award_signup_bonus()
returns trigger
language plpgsql security definer set search_path = restroom, public, extensions as $$
begin
  insert into restroom.credit_ledger (user_id, delta, reason, ref_type, ref_id)
  values (new.id, 5, 'signup_bonus', 'profile', new.id)
  on conflict do nothing;
  return new;
end $$;

drop trigger if exists restroom_signup_bonus on auth.users;
create trigger restroom_signup_bonus
  after insert on auth.users
  for each row execute function restroom.award_signup_bonus();
