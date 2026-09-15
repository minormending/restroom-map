-- Somewhere to complain that is not GitHub.
--
-- The contact address in both legal pages is the issue tracker, and the menu
-- linked to it. That works for the people least likely to need it: a beta
-- tester with an account already open. Most people this map is for do not have
-- a GitHub account and will not make one to report that a door code is wrong,
-- so the channel existed and collected nothing.
--
-- WHY A TABLE AND NOT A FLAG
--
-- flags.target_id is not null and its target_type is bathroom or comment: a
-- flag is a complaint *about a row*. Feedback about the app has no row to point
-- at, and squeezing it in would mean a nullable target and a check constraint
-- that lies about what it holds.
--
-- WHAT IT DOES SHARE IS THE QUEUE
--
-- A table nobody reads is worse than no table. moderation_queue is what
-- `pnpm db:queue` prints and what the weekday check reads, so feedback goes
-- into it alongside the flags rather than somewhere new that has to be
-- remembered. Anything with a contact address still sorts to the top, because
-- somebody is waiting on an answer.
--
-- ANONYMOUS, DELIBERATELY
--
-- Requiring sign-in would rebuild the barrier this replaces — sign-in here is
-- Google OAuth, which is a bigger ask than a GitHub account for some people.
-- So the rate limit does the work the account would have: five a day per
-- fingerprint, which is the same hashed-IP counter every other write uses.

set search_path = public, extensions;

create type feedback_kind as enum ('bug', 'idea', 'complaint');

create table feedback (
  id            uuid primary key default gen_random_uuid(),
  kind          feedback_kind not null,
  message       text not null,
  -- Optional, and the only reason to hold an address: so somebody can be told
  -- what happened. Not public, same as flags.contact_email.
  contact_email text,
  user_id       uuid references profiles(id),
  -- Which build they were looking at. The version indicator exists to be read
  -- out when something looks wrong; this saves them reading it.
  build         text,
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz
);

create index feedback_open on feedback (created_at desc) where resolved_at is null;

alter table feedback enable row level security;

-- Anyone may write; nobody may read it back but service_role. Same shape as
-- flags: a report box is not a public wall, and the people who write to it
-- have no reason to see what anybody else wrote.
create policy feedback_insert_auth on feedback for insert to authenticated
  with check (user_id = auth.uid() or user_id is null);
create policy feedback_insert_anon on feedback for insert to anon
  with check (user_id is null);

create or replace function submit_feedback(
  p_kind          text,
  p_message       text,
  p_contact_email text default null,
  p_build         text default null)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_kind feedback_kind;
begin
  begin
    v_kind := p_kind::feedback_kind;
  exception when invalid_text_representation then
    raise exception 'unknown kind: %', p_kind using errcode = '22023';
  end;

  if coalesce(length(trim(p_message)), 0) = 0 then
    raise exception 'say what happened' using errcode = '22023';
  end if;

  -- Five a day. Generous enough that nobody with a real complaint hits it,
  -- tight enough that this is not a free megaphone into the queue.
  if not rl_take('feedback:' || client_fingerprint(), interval '1 day', 5) then
    raise exception 'that is a lot of feedback for one day, try tomorrow'
      using errcode = '53400';
  end if;

  insert into feedback (kind, message, contact_email, user_id, build)
  values (v_kind,
          left(trim(p_message), 2000),
          nullif(trim(p_contact_email), ''),
          auth.uid(),
          left(nullif(trim(p_build), ''), 40));

  return jsonb_build_object('ok', true);
end $$;

grant execute on function submit_feedback(text, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- The queue gains a second source. Column names and types are unchanged, so
-- `pnpm db:queue` and the weekday check need no edit — which is the point.
--
-- The subject line carries the kind and the build, because "feedback: bug ·
-- v87" is the whole of what you need before reading the message itself.
-- ---------------------------------------------------------------------------
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

union all

select
  d.id,
  d.created_at,
  'feedback: ' || d.kind::text || coalesce(' · ' || d.build, ''),
  null::uuid,
  d.message,
  d.contact_email,
  null::text,
  null::bathroom_status,
  null::int,
  null::int,
  null::numeric(6,2),
  (d.contact_email is not null)
from feedback d
where d.resolved_at is null

order by awaiting_reply desc, created_at desc;
