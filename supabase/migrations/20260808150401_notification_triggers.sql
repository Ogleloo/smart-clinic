-- Migration 0024: notification triggers.
--
-- Design constraint: NO fan-out. Each trigger does bounded work and
-- writes at most one row. Notifying every waiting patient whenever the
-- queue moves would turn one completion in a queue of 20 into 19 rows,
-- for no information the patient's own screen does not already show live.

-- Rank helper: who is currently #Nth waiting for a service today,
-- using the ADR-023 total ordering.
create or replace function public.nth_waiting_entry(p_service_id uuid, p_n int)
returns public.queue_entries
language sql stable security definer
set search_path = public, pg_temp
as $$
  select q.* from public.queue_entries q
  where q.service_id = p_service_id
    and q.queue_date = current_date
    and q.status = 'waiting'
  order by q.priority desc, q.checked_in_at asc, q.token_number asc
  offset greatest(p_n - 1, 0) limit 1;
$$;

-- 1. 'called' — one row, on the transition into in_progress.
create or replace function public.notify_called()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if new.status = 'in_progress' and old.status is distinct from 'in_progress' then
    insert into public.notifications (recipient_id, kind, title, body, queue_entry_id)
    -- recipient comes from the ROW, not auth_profile_id(): this trigger runs
    -- as the nurse, so the helper would address every notification to staff.
    values (new.patient_id, 'called', 'You have been called',
            'Please proceed. Your token is ' || new.token || '.', new.id);
  end if;
  return new;
end $$;

drop trigger if exists trg_notify_called on public.queue_entries;
create trigger trg_notify_called
  after update on public.queue_entries
  for each row execute function public.notify_called();

-- 2. 'you_are_next' — at most one row, and once ever per entry.
create or replace function public.notify_you_are_next()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
declare svc uuid; head public.queue_entries;
begin
  svc := coalesce(new.service_id, old.service_id);
  head := public.nth_waiting_entry(svc, 1);
  if head.id is null then return coalesce(new, old); end if;

  if not exists (
    select 1 from public.notifications n
    where n.queue_entry_id = head.id and n.kind = 'you_are_next'
  ) then
    insert into public.notifications (recipient_id, kind, title, body, queue_entry_id)
    values (head.patient_id, 'you_are_next', 'You are next',
            'You are first in line. Please stay nearby.', head.id);
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists trg_notify_you_are_next on public.queue_entries;
create trigger trg_notify_you_are_next
  after insert or update of status, priority on public.queue_entries
  for each row execute function public.notify_you_are_next();

-- 3. 'emergency_ahead' — notify ONLY the entry now immediately behind the
--    emergency. No "is it ranked #1" gate: an emergency inserted behind
--    another emergency still displaces someone, and that person is
--    entitled to know.
create or replace function public.notify_emergency_ahead()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
declare pos int; behind public.queue_entries;
begin
  if new.priority > 0 and coalesce(old.priority, 0) = 0 and new.status = 'waiting' then
    select count(*) into pos
    from public.queue_entries q
    where q.service_id = new.service_id
      and q.queue_date = current_date
      and q.status = 'waiting'
      and (q.priority, q.checked_in_at, q.token_number)
          >= (new.priority, new.checked_in_at, new.token_number);
    -- rank of the emergency entry = count of entries at or ahead of it
    behind := public.nth_waiting_entry(new.service_id,
              (select count(*) from public.queue_entries q
                where q.service_id = new.service_id and q.queue_date = current_date
                  and q.status = 'waiting'
                  and (q.priority > new.priority
                       or (q.priority = new.priority
                           and (q.checked_in_at, q.token_number)
                               < (new.checked_in_at, new.token_number)))) + 2);
    if behind.id is not null and behind.id <> new.id then
      insert into public.notifications (recipient_id, kind, title, body, queue_entry_id)
      values (behind.patient_id, 'emergency_ahead', 'An emergency was added ahead of you',
              'A patient needing urgent care was placed ahead of you. Your wait may be longer.',
              behind.id);
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_notify_emergency_ahead on public.queue_entries;
create trigger trg_notify_emergency_ahead
  after update of priority on public.queue_entries
  for each row execute function public.notify_emergency_ahead();

-- 4. 'appointment_cancelled' — one row.
create or replace function public.notify_appointment_cancelled()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    insert into public.notifications (recipient_id, kind, title, body, appointment_id)
    values (new.patient_id, 'appointment_cancelled', 'Appointment cancelled',
            'Your appointment has been cancelled.', new.id);
  end if;
  return new;
end $$;

drop trigger if exists trg_notify_appointment_cancelled on public.appointments;
create trigger trg_notify_appointment_cancelled
  after update on public.appointments
  for each row execute function public.notify_appointment_cancelled();

notify pgrst, 'reload schema';
