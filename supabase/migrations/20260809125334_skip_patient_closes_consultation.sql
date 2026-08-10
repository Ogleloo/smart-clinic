-- Migration 0036: skip_patient() must not orphan an open consultation.
--
-- Found during nurse-UI work: skip_patient() accepts an 'in_progress'
-- entry but never touches `consultations`. Skipping a patient who had
-- already been called therefore left an OPEN consultation attached to a
-- 'skipped' queue entry. The next next_patient() call finds that open
-- row, ends it, and sets the entry back to 'done' — silently overwriting
-- the skip AND recording a fabricated duration for a consultation that
-- never happened.
--
-- The UI now only offers Skip on waiting rows, which avoids the path.
-- That is not sufficient: the RPC remains directly callable, and in this
-- system the database is the arbiter rather than the interface. A UI that
-- declines to make a dangerous call does not make the call safe.
--
-- Behaviour: closing the consultation rather than refusing the skip.
-- A nurse who calls a patient who does not appear has a real event to
-- record — the person was called and did not attend. The elapsed time is
-- meaningless as clinical duration, so it is preserved for audit but
-- excluded from the prediction average.

create or replace function public.skip_patient(
  p_queue_entry_id uuid,
  p_no_show boolean default false
)
returns public.queue_entries
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare entry public.queue_entries; closed int := 0;
begin
  if public.auth_role() not in ('nurse','receptionist','admin') then
    raise exception 'Not authorised';
  end if;

  -- Close any consultation still open against this entry BEFORE changing
  -- its status, so no later call can mistake it for live work.
  update public.consultations
     set ended_at = greatest(clock_timestamp(), started_at + interval '1 second'),
         exclude_from_prediction = true,
         exclusion_reason = case when p_no_show then 'patient_no_show'
                                 else 'patient_skipped' end
   where queue_entry_id = p_queue_entry_id
     and ended_at is null;
  get diagnostics closed = row_count;

  update public.queue_entries
  set status = case when p_no_show then 'no_show'::public.queue_entry_status
                    else 'skipped'::public.queue_entry_status end,
      completed_at = now()
  where id = p_queue_entry_id and status in ('waiting','in_progress')
  returning * into entry;

  if not found then
    raise exception 'That patient is not in an active state';
  end if;

  return entry;
end;
$function$;

notify pgrst, 'reload schema';
