-- Pre-launch: make removals auditable and reversible.
--
-- Hiding a place is the operation most likely to be done in a hurry — a
-- business rings up, or something defamatory appears. Record WHY at the moment
-- it happens, because nobody reconstructs that later.

set search_path = public, extensions;

alter table bathrooms add column if not exists hidden_reason text;
alter table bathrooms add column if not exists hidden_at timestamptz;

-- Existing auto-hides predate the columns; label them rather than leave nulls.
update bathrooms
set hidden_reason = coalesce(hidden_reason, 'auto-hidden: sustained trouble reports'),
    hidden_at = coalesce(hidden_at, now())
where status = 'hidden' and hidden_reason is null;

create or replace function apply_auto_hide()
returns trigger
language plpgsql security definer set search_path = public, extensions as $$
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

    insert into flags (target_type, target_id, reason)
    values ('bathroom', NEW.bathroom_id, 'auto-hidden: sustained trouble reports');
  end if;

  return NEW;
end $$;

-- The queue an operator actually reads. Takedown requests sort first: a
-- business waiting on a reply is the one clock that matters.
create or replace view moderation_queue as
select
  f.id,
  f.created_at,
  f.target_type,
  f.target_id,
  f.reason,
  f.contact_email,
  b.name   as bathroom_name,
  b.status as bathroom_status,
  c.confirms_90d,
  c.troubles_90d,
  c.score,
  (f.contact_email is not null) as awaiting_reply
from flags f
left join bathrooms b on f.target_type = 'bathroom' and b.id = f.target_id
left join bathroom_confidence c on c.bathroom_id = b.id
where f.resolved_at is null
order by (f.contact_email is not null) desc, f.created_at desc;
