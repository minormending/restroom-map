-- apply_auto_hide() still writes a flag the way this app's own flags table
-- took one. That table is now the shared public.flags: `reason` is `message`,
-- and every row names the app it belongs to.
--
-- Without this the auto-hide trigger fails outright, so a place with sustained
-- trouble reports stays on the map and the clawback never runs.

set search_path = restroom, public, extensions;

create or replace function restroom.apply_auto_hide()
returns trigger
language plpgsql security definer set search_path = restroom, public, extensions as $$
declare
  v_score numeric;
  v_reporters int;
  v_owner uuid;
begin
  select score, distinct_reporters into v_score, v_reporters
    from restroom.bathroom_confidence where bathroom_id = NEW.bathroom_id;

  if coalesce(v_score, 0) > -3 or coalesce(v_reporters, 0) < 3 then
    return NEW;
  end if;

  update restroom.bathrooms
     set status = 'hidden',
         hidden_at = now(),
         hidden_reason = format('auto-hidden: score %s from %s reporters', v_score, v_reporters)
   where id = NEW.bathroom_id and status = 'active'
  returning created_by into v_owner;

  if not found then
    return NEW;
  end if;

  -- Only claw back what was actually paid out.
  if v_owner is not null and exists (
    select 1 from restroom.credit_ledger
     where reason = 'submission_verified' and ref_id = NEW.bathroom_id
  ) then
    insert into restroom.credit_ledger (user_id, delta, reason, ref_type, ref_id)
    values (v_owner, -10, 'fraud_clawback', 'bathroom', NEW.bathroom_id)
    on conflict do nothing;
  end if;

  -- The flag is the audit trail: without it a hidden place is unexplainable.
  insert into public.flags (app, target_type, target_id, kind, message)
  values ('restroom-map', 'bathroom', NEW.bathroom_id, 'auto',
          'auto-hidden: sustained trouble reports');

  return NEW;
end $$;
