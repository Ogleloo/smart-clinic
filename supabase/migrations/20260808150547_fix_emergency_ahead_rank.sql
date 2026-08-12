-- Migration 0025: fix notify_emergency_ahead().
--
-- Two defects in 0024:
--   1. count(*) returns bigint; nth_waiting_entry takes int -> the call
--      never resolved and the trigger raised 42883 at runtime. It could
--      not have been caught by anything except executing it.
--   2. The rank arithmetic was an unreadable nested subquery. Replaced
--      with an explicit window function over the ADR-023 ordering.
--
-- Behaviour is unchanged from the intended design: notify ONLY the entry
-- immediately behind the newly promoted emergency. No "is it rank #1"
-- gate — an emergency placed behind another emergency still displaces
-- somebody, and that person is the one entitled to know.

create or replace function public.notify_emergency_ahead()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
declare behind_id uuid; behind_patient uuid;
begin
  if new.priority > 0 and coalesce(old.priority, 0) = 0 and new.status = 'waiting' then

    with ranked as (
      select q.id, q.patient_id,
             row_number() over (
               order by q.priority desc, q.checked_in_at asc, q.token_number asc
             ) as rn
      from public.queue_entries q
      where q.service_id = new.service_id
        and q.queue_date = current_date
        and q.status = 'waiting'
    )
    select r2.id, r2.patient_id into behind_id, behind_patient
    from ranked r1
    join ranked r2 on r2.rn = r1.rn + 1
    where r1.id = new.id;

    if behind_id is not null then
      insert into public.notifications
        (recipient_id, kind, title, body, queue_entry_id)
      values (behind_patient, 'emergency_ahead',
              'An emergency was added ahead of you',
              'A patient needing urgent care was placed ahead of you. Your wait may be longer.',
              behind_id);
    end if;
  end if;
  return new;
end $$;

notify pgrst, 'reload schema';
