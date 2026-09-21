-- Restore apply_auto_hide() to its original body.
--
-- Migration 029 rewrote it from a partial reading and got four things wrong:
-- it dropped the guard on NEW.kind, used distinct_reporters instead of
-- trouble_reporters_90d, inverted the score comparison, and lost the rounding
-- in the hidden_reason text. This is the original, with exactly one change:
-- the flag it writes goes to the shared public.flags, where `reason` is
-- `message` and every row names its app.

set search_path = restroom, public, extensions;

create or replace function restroom.apply_auto_hide()
returns trigger
language plpgsql security definer set search_path to 'restroom', 'public', 'extensions' as $$
declare
  v_score     numeric;
  v_reporters int;
  v_owner     uuid;
begin
  if NEW.kind not in ('gone', 'code_bad') then
    return NEW;
  end if;

  select score, trouble_reporters_90d into v_score, v_reporters
  from bathroom_confidence where bathroom_id = NEW.bathroom_id;

  if coalesce(v_score, 0) < -3 and coalesce(v_reporters, 0) >= 3 then
    update bathrooms
    set status = 'hidden',
        hidden_at = now(),
        hidden_reason = format('auto-hidden: score %s from %s reporters',
                               round(v_score, 2), v_reporters)
    where id = NEW.bathroom_id and status = 'active'
    returning created_by into v_owner;

    if v_owner is not null and exists (
      select 1 from credit_ledger
      where reason = 'submission_verified' and ref_id = NEW.bathroom_id
    ) then
      insert into credit_ledger (user_id, delta, reason, ref_type, ref_id)
      values (v_owner, -10, 'fraud_clawback', 'bathroom', NEW.bathroom_id)
      on conflict do nothing;
    end if;

    insert into public.flags (app, target_type, target_id, kind, message)
    values ('restroom-map', 'bathroom', NEW.bathroom_id, 'auto',
            'auto-hidden: sustained trouble reports');
  end if;

  return NEW;
end $$;
