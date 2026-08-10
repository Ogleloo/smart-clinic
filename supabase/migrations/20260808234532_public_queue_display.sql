-- Migration 0032: waiting-room display board (accessibility for patients
-- with no smartphone).
--
-- SECURITY NOTE — read this before changing anything here.
--
-- This is the ONLY function in the system executable by `anon`. That is a
-- deliberate, narrow exception and it is safe only because of what it does
-- NOT return: no names, no profile ids, no queue_entry ids, no appointment
-- data, no phone numbers. Tokens only — which exist precisely so a person
-- can be identified by their place in a queue rather than by who they are.
--
-- The alternative — letting a public page read queue_entries with an anon
-- RLS policy — would be the most dangerous change possible to this
-- codebase, because RLS on that table is what stops patients reading each
-- other's rows. This function keeps the aggregate-only principle already
-- used by get_wait_estimate: the caller learns the shape of the queue
-- without being able to read anybody's row.

create or replace function public.get_public_queue_display(p_service_id uuid)
returns table (
  service_name      text,
  now_serving_token text,
  next_token        text,
  waiting_count     int,
  estimated_wait_minutes int,
  confidence        text,
  is_being_served   boolean,
  updated_at        timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  svc    public.services;
  nurses int;
  stats  record;
begin
  select * into svc from public.services
   where id = p_service_id and is_active;
  if not found then raise exception 'Service not found'; end if;

  service_name := svc.name;
  nurses := public.available_nurses(p_service_id);
  select * into stats from public.service_consultation_stats(p_service_id);

  select q.token into now_serving_token
  from public.queue_entries q
  where q.service_id = p_service_id
    and q.queue_date = current_date
    and q.status = 'in_progress'
  order by q.called_at desc nulls last
  limit 1;

  select q.token into next_token
  from public.queue_entries q
  where q.service_id = p_service_id
    and q.queue_date = current_date
    and q.status = 'waiting'
  order by q.priority desc, q.checked_in_at asc, q.token_number asc
  limit 1;

  select count(*)::int into waiting_count
  from public.queue_entries q
  where q.service_id = p_service_id
    and q.queue_date = current_date
    and q.status = 'waiting';

  is_being_served := nurses > 0;

  -- The useful number on a display board is "if you check in now, how
  -- long?" — i.e. everyone currently waiting, ahead of you.
  if nurses > 0 then
    estimated_wait_minutes := ceil(
      (waiting_count::numeric / nurses)
      * coalesce(stats.avg_minutes, svc.default_consultation_minutes));
    confidence := public.confidence_label(
      p_service_id, stats.sample_count, stats.stddev_minutes);
  else
    -- Same honesty rule as the patient screen: no nurse on duty means no
    -- number, rather than a number the clinic cannot stand behind.
    estimated_wait_minutes := null;
    confidence := null;
  end if;

  updated_at := now();
  return next;
end;
$$;

-- Deliberately granted to anon: a waiting-room screen has no login.
grant execute on function public.get_public_queue_display(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
