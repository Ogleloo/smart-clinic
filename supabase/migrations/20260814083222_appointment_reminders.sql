-- Migration 0045: appointment reminders (proposal §3 and §12).
--
-- The proposal promises patients "reminders about upcoming appointments"
-- and lists it under the patient interface. The notification kind
-- 'appointment_reminder' existed from migration 0023, but nothing ever
-- generated one — zero had been sent. An in-scope requirement with a
-- placeholder and no implementation.
--
-- Built as a scheduled sweep rather than a trigger, for the same reason
-- as no-shows (ADR-024): the event is the PASSAGE OF TIME, and no row
-- changes when an appointment becomes due for a reminder. There is
-- nothing for a trigger to fire on.
--
-- Idempotent by construction: the NOT EXISTS guard means a reminder is
-- sent at most once per appointment, ever. Running the job twice, or
-- ten times, changes nothing. The schedule is therefore an optimisation,
-- not a dependency — the same property that makes the no-show sweep safe.

alter table public.clinic_settings
  add column if not exists appointment_reminder_lead_minutes int not null default 120;

create or replace function public.send_appointment_reminders()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare sent int := 0;
begin
  with due as (
    select a.id, a.patient_id, a.scheduled_time,
           s.name as service_name, c.timezone
    from public.appointments a
    join public.services s   on s.id = a.service_id
    join public.clinics  c   on c.id = s.clinic_id
    left join public.clinic_settings cs on cs.clinic_id = c.id
    where a.status = 'booked'                    -- not cancelled, not already checked in
      and a.scheduled_time > now()               -- never remind about a past appointment
      and a.scheduled_time <= now() + make_interval(
            mins => coalesce(cs.appointment_reminder_lead_minutes, 120))
      and not exists (                           -- at most one reminder, ever
        select 1 from public.notifications n
        where n.appointment_id = a.id
          and n.kind = 'appointment_reminder')
  ), ins as (
    insert into public.notifications (recipient_id, kind, title, body, appointment_id)
    select d.patient_id,
           'appointment_reminder',
           'Appointment reminder',
           'Your ' || d.service_name || ' appointment is '
           || case
                when (d.scheduled_time at time zone d.timezone)::date
                     = (now() at time zone d.timezone)::date
                then 'today at '
                else 'on ' || to_char(d.scheduled_time at time zone d.timezone,
                                      'Dy DD Mon') || ' at '
              end
           || to_char(d.scheduled_time at time zone d.timezone, 'HH24:MI')
           || '. Please check in at reception when you arrive.',
           d.id
    from due d
    returning 1
  )
  select count(*) into sent from ins;

  return sent;
end;
$$;

revoke execute on function public.send_appointment_reminders() from public, anon;
grant  execute on function public.send_appointment_reminders() to authenticated;

select cron.schedule(
  'send-appointment-reminders',
  '*/15 * * * *',
  $$select public.send_appointment_reminders();$$
);

notify pgrst, 'reload schema';
