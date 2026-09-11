-- Auto-hide counted trouble ROWS, which is not the same as trouble PEOPLE.
--
-- 'gone' and 'code_bad' are separate rate-limit buckets, so one address can
-- lodge two troubles against the same bathroom. The intended "three reports"
-- threshold was therefore really "two people" — and one person with a VPN
-- toggle is two addresses. Count distinct reporters instead.

set search_path = public, extensions;

-- Adding a column at the end keeps create-or-replace legal.
create or replace view bathroom_confidence with (security_invoker = true) as
select
  b.id as bathroom_id,
  count(*) filter (where r.kind = 'works'
        and r.created_at > now() - interval '90 days')::int as confirms_90d,
  count(*) filter (where r.kind in ('gone','code_bad')
        and r.created_at > now() - interval '90 days')::int as troubles_90d,
  max(r.created_at) filter (where r.kind = 'works') as last_confirmed_at,
  coalesce(sum(
    case when r.kind = 'works' then 1.0 else -2.0 end
    * exp(-extract(epoch from now() - r.created_at) / 2592000.0)
  ), 0)::numeric(6,2) as score,
  -- One person counts once however many kinds they file.
  count(distinct coalesce(r.user_id::text, r.anon_id))
    filter (where r.kind in ('gone','code_bad')
        and r.created_at > now() - interval '90 days')::int as trouble_reporters_90d
from bathrooms b left join reports r on r.bathroom_id = b.id
group by b.id;

create or replace function apply_auto_hide()
returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_score     numeric;
  v_reporters int;
begin
  if NEW.kind not in ('gone', 'code_bad') then
    return NEW;
  end if;

  select score, trouble_reporters_90d into v_score, v_reporters
  from bathroom_confidence where bathroom_id = NEW.bathroom_id;

  -- Still two conditions, but the second now means three separate people.
  if coalesce(v_score, 0) < -3 and coalesce(v_reporters, 0) >= 3 then
    update bathrooms set status = 'hidden'
    where id = NEW.bathroom_id and status = 'active';

    insert into flags (target_type, target_id, reason)
    values ('bathroom', NEW.bathroom_id, 'auto-hidden: sustained trouble reports');
  end if;

  return NEW;
end $$;

grant select on bathroom_confidence to anon, authenticated;
