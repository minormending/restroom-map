-- submit_code inserted the replacement before retiring the old row, so for
-- an instant two live codes existed for one bathroom. codes_one_live is a
-- plain (non-deferred) unique index, so the insert failed every time and a
-- code could never actually be rotated.
--
-- Retire first, then insert, then link the old row to its successor.

set search_path = public, extensions;

create or replace function submit_code(p_bathroom_id uuid, p_code text)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid := auth.uid();
  v_old  uuid;
  v_new  uuid;
begin
  if v_user is null then
    raise exception 'sign in to add a code' using errcode = '42501';
  end if;
  if is_banned(v_user) then
    raise exception 'this account cannot submit' using errcode = '42501';
  end if;
  if coalesce(length(trim(p_code)), 0) = 0 then
    raise exception 'a code is required' using errcode = '22023';
  end if;
  if not exists (select 1 from bathrooms
                 where id = p_bathroom_id and status = 'active') then
    raise exception 'no such place' using errcode = 'P0002';
  end if;

  select id into v_old from bathroom_codes
  where bathroom_id = p_bathroom_id and superseded_at is null;

  -- Same code again is a confirmation, not a change. Leave history alone.
  if v_old is not null and
     (select code from bathroom_codes where id = v_old) = trim(p_code) then
    return jsonb_build_object('ok', true, 'changed', false, 'id', v_old);
  end if;

  -- Retire the incumbent BEFORE inserting, or codes_one_live rejects the pair.
  if v_old is not null then
    update bathroom_codes set superseded_at = now() where id = v_old;
  end if;

  insert into bathroom_codes (bathroom_id, code, submitted_by)
  values (p_bathroom_id, trim(p_code), v_user)
  returning id into v_new;

  if v_old is not null then
    update bathroom_codes set superseded_by = v_new where id = v_old;
  end if;

  return jsonb_build_object('ok', true, 'changed', true, 'id', v_new);
end $$;
