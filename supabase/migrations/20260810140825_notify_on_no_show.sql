-- Migration 0043: tell the patient when their appointment is marked no-show.
--
-- Found in testing: mark_overdue_no_shows() correctly set status to
-- 'no_show', but nothing notified the patient. The system quietly recorded
-- them as absent and said nothing. A patient delayed in traffic learns of
-- it only on arrival — and the appointment is already gone.
--
-- The existing appointment_cancelled trigger does not cover this: a
-- no-show is not a cancellation, and telling someone their appointment was
-- "cancelled" when they did not cancel it is wrong wording for a
-- materially different event.
--
-- The message deliberately tells them what to do next rather than only
-- what happened. Being marked absent is not the end of the visit — a walk-in
-- queue exists, and the patient should know that.

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in (
    'queue_position','you_are_next','called',
    'appointment_reminder','appointment_cancelled','emergency_ahead',
    'appointment_no_show'));

create or replace function public.notify_appointment_no_show()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if new.status = 'no_show' and old.status is distinct from 'no_show' then
    insert into public.notifications
      (recipient_id, kind, title, body, appointment_id)
    values (
      new.patient_id,
      'appointment_no_show',
      'You missed your appointment',
      'Your appointment time has passed and you were not checked in. '
      || 'You can still be seen — come to the clinic and reception will '
      || 'add you to the walk-in queue, or book a new appointment.',
      new.id);
  end if;
  return new;
end $$;

drop trigger if exists trg_notify_appointment_no_show on public.appointments;
create trigger trg_notify_appointment_no_show
  after update on public.appointments
  for each row execute function public.notify_appointment_no_show();

notify pgrst, 'reload schema';
