-- Migration 0013: Nurse flow (Vertical Slice 5)
-- call next -> consult -> end. Ending a consultation records a real
-- duration, which feeds the Queue Engine's average and confidence.

-- ---------- duty toggle ----------
create or replace function public.set_duty(p_on_duty boolean, p_service_id uuid default null)
returns public.profiles
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  caller uuid := public.auth_profile_id();
  prof   public.profiles;
begin
  if public.auth_role() <> 'nurse' then
    raise exception 'Only nurses have a duty state';
  end if;

  update public.profiles
  set is_on_duty = p_on_duty,
      current_service_id = coalesce(p_service_id, current_service_id)
  where id = caller
  returning * into prof;

  if p_on_duty and prof.current_service_id is null then
    raise exception 'Assign a service before going on duty';
  end if;
  return prof;
end;
$$;

-- ---------- call next ----------
-- Picks the head of the queue under the SAME total ordering the
-- estimate uses, so what the patient sees and what the nurse gets
-- can never disagree.
create or replace function public.call_next_patient()
returns public.queue_entries
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  caller  uuid := public.auth_profile_id();
  prof    public.profiles;
  entry   public.queue_entries;
begin
  if public.auth_role() <> 'nurse' then
    raise exception 'Only nurses can call the next patient';
  end if;

  select * into prof from public.profiles where id = caller;
  if not prof.is_on_duty then raise exception 'You are off duty'; end if;
  if prof.current_service_id is null then
    raise exception 'You are not assigned to a service';
  end if;

  -- Don't hand out a second patient while one is still in progress.
  if exists (
    select 1 from public.consultations c
    where c.nurse_id = caller and c.ended_at is null
  ) then
    raise exception 'Finish your current consultation first';
  end if;

  -- Lock the head row so two nurses cannot claim the same patient.
  select * into entry
  from public.queue_entries q
  where q.service_id = prof.current_service_id
    and q.queue_date = current_date
    and q.status = 'waiting'
  order by q.priority desc, q.checked_in_at asc, q.token_number asc
  for update skip locked
  limit 1;

  if not found then raise exception 'No patients waiting'; end if;

  update public.queue_entries
  set status = 'in_progress', called_at = now()
  where id = entry.id
  returning * into entry;

  return entry;
end;
$$;

-- ---------- start / end consultation ----------
create or replace function public.start_consultation(p_queue_entry_id uuid)
returns public.consultations
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  caller uuid := public.auth_profile_id();
  entry  public.queue_entries;
  cons   public.consultations;
begin
  if public.auth_role() <> 'nurse' then
    raise exception 'Only nurses conduct consultations';
  end if;

  select * into entry from public.queue_entries where id = p_queue_entry_id;
  if not found then raise exception 'Queue entry not found'; end if;
  if entry.status <> 'in_progress' then
    raise exception 'Call this patient before starting the consultation';
  end if;

  insert into public.consultations (queue_entry_id, nurse_id, service_id, started_at)
  values (entry.id, caller, entry.service_id, now())
  returning * into cons;

  return cons;
end;
$$;

create or replace function public.end_consultation(p_queue_entry_id uuid)
returns table (consultation_id uuid, duration_minutes numeric,
               new_service_average numeric, new_confidence text)
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  caller uuid := public.auth_profile_id();
  cons   public.consultations;
  stats  record;
begin
  if public.auth_role() <> 'nurse' then
    raise exception 'Only nurses conduct consultations';
  end if;

  select * into cons from public.consultations
  where queue_entry_id = p_queue_entry_id and ended_at is null;
  if not found then raise exception 'No open consultation for this patient'; end if;
  if cons.nurse_id <> caller then
    raise exception 'This is another nurse''s consultation';
  end if;

  update public.consultations set ended_at = now()
  where id = cons.id returning * into cons;

  update public.queue_entries
  set status = 'done', completed_at = now()
  where id = p_queue_entry_id;

  -- Return the updated statistics so the UI can show the loop closing.
  select * into stats from public.service_consultation_stats(cons.service_id);

  consultation_id := cons.id;
  duration_minutes := round(extract(epoch from (cons.ended_at - cons.started_at))/60.0, 2);
  new_service_average := stats.avg_minutes;
  new_confidence := public.confidence_label(cons.service_id, stats.sample_count, stats.stddev_minutes);
  return next;
end;
$$;

-- ---------- skip / no-show ----------
create or replace function public.skip_patient(p_queue_entry_id uuid, p_no_show boolean default false)
returns public.queue_entries
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare entry public.queue_entries;
begin
  if public.auth_role() not in ('nurse','receptionist','admin') then
    raise exception 'Not authorised';
  end if;

  update public.queue_entries
  set status = case when p_no_show then 'no_show'::public.queue_entry_status
                    else 'skipped'::public.queue_entry_status end,
      completed_at = now()
  where id = p_queue_entry_id and status in ('waiting','in_progress')
  returning * into entry;

  if not found then raise exception 'That patient is not in an active state'; end if;
  return entry;
end;
$$;

-- ---------- emergency priority (BR-10) ----------
-- The ONLY write path to priority. Records who and when.
create or replace function public.set_emergency_priority(
  p_queue_entry_id uuid, p_emergency boolean
)
returns public.queue_entries
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  caller uuid := public.auth_profile_id();
  entry  public.queue_entries;
begin
  if public.auth_role() not in ('nurse','admin') then
    raise exception 'Only clinical staff can change emergency priority';
  end if;

  update public.queue_entries
  set priority = case when p_emergency then 1 else 0 end,
      priority_set_by = caller,
      priority_set_at = now()
  where id = p_queue_entry_id and status in ('waiting','in_progress')
  returning * into entry;

  if not found then raise exception 'That patient is not in an active state'; end if;
  return entry;
end;
$$;

revoke execute on function public.set_duty(boolean,uuid) from public, anon;
revoke execute on function public.call_next_patient() from public, anon;
revoke execute on function public.start_consultation(uuid) from public, anon;
revoke execute on function public.end_consultation(uuid) from public, anon;
revoke execute on function public.skip_patient(uuid,boolean) from public, anon;
revoke execute on function public.set_emergency_priority(uuid,boolean) from public, anon;
grant execute on function public.set_duty(boolean,uuid) to authenticated;
grant execute on function public.call_next_patient() to authenticated;
grant execute on function public.start_consultation(uuid) to authenticated;
grant execute on function public.end_consultation(uuid) to authenticated;
grant execute on function public.skip_patient(uuid,boolean) to authenticated;
grant execute on function public.set_emergency_priority(uuid,boolean) to authenticated;
