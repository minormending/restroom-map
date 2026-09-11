-- M1: auto-hide, flagging, and a queue to review both.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Auto-hide needs TWO conditions to fire, not one. A single motivated person
-- must not be able to delete a real bathroom off the map — and a business
-- owner or a competitor will try. Recent confirmations fight back through the
-- decay term in bathroom_confidence.score.
-- ---------------------------------------------------------------------------
create or replace function apply_auto_hide()
returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_score    numeric;
  v_troubles int;
begin
  if NEW.kind not in ('gone', 'code_bad') then
    return NEW;
  end if;

  select score, troubles_90d into v_score, v_troubles
  from bathroom_confidence where bathroom_id = NEW.bathroom_id;

  if coalesce(v_score, 0) < -3 and coalesce(v_troubles, 0) >= 3 then
    update bathrooms set status = 'hidden'
    where id = NEW.bathroom_id and status = 'active';

    insert into flags (target_type, target_id, reason)
    values ('bathroom', NEW.bathroom_id, 'auto-hidden: sustained trouble reports');
  end if;

  return NEW;
end $$;

create trigger reports_auto_hide after insert on reports
  for each row execute function apply_auto_hide();

-- ---------------------------------------------------------------------------
-- Flagging. Same rate limiter as reporting so the queue can't be flooded.
-- ---------------------------------------------------------------------------
create or replace function submit_flag(
  p_target_type   text,
  p_target_id     uuid,
  p_reason        text,
  p_contact_email text default null)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_fp text := client_fingerprint();
begin
  if p_target_type not in ('bathroom', 'comment') then
    raise exception 'unknown target type: %', p_target_type using errcode = '22023';
  end if;
  if coalesce(length(trim(p_reason)), 0) = 0 then
    raise exception 'a reason is required' using errcode = '22023';
  end if;

  if not rl_take('flag:' || v_fp, interval '1 day', 10) then
    raise exception 'too many reports, try later' using errcode = '53400';
  end if;

  insert into flags (target_type, target_id, reporter_id, reason, contact_email)
  values (p_target_type, p_target_id, auth.uid(),
          left(trim(p_reason), 2000), nullif(trim(p_contact_email), ''));

  return jsonb_build_object('ok', true);
end $$;

grant execute on function submit_flag(text, uuid, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- The review queue. No grants: service_role and the SQL editor only.
-- This is also the business-removal path — a request arriving through
-- flags.contact_email shows up here alongside everything else.
-- ---------------------------------------------------------------------------
create view moderation_queue as
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
  c.score
from flags f
left join bathrooms b on f.target_type = 'bathroom' and b.id = f.target_id
left join bathroom_confidence c on c.bathroom_id = b.id
where f.resolved_at is null
order by f.created_at desc;
