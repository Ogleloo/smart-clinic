-- Migration 0037: report BOTH reasons a consultation misses the average.
--
-- Found in live testing: the nurse screen showed "Ended GC-077 · 0 min"
-- with no qualifier, implying it was recorded. It was not — a 0-minute
-- span falls below clinic_settings.min_plausible_consultation_minutes and
-- is filtered out inside service_consultation_stats().
--
-- There are two independent exclusion mechanisms:
--   1. exclude_from_prediction  — an explicit judgement (staff break,
--                                 skip, no-show), stored on the row
--   2. the plausibility band    — applied at read time by the stats
--                                 function, never stored
-- next_patient() only reported the first, so the second was invisible.
--
-- Adds ended_counted: whether the just-closed consultation will actually
-- contribute to the service average, accounting for both. The nurse then
-- learns the truth either way, which is the same principle the patient
-- screen follows when it refuses to state a wait it cannot justify.

create or replace function public.consultation_counts_towards_average(p_consultation_id uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select c.exclude_from_prediction = false
     and c.ended_at is not null
     and round(extract(epoch from (c.ended_at - c.started_at)) / 60.0)
         between coalesce(cs.min_plausible_consultation_minutes, 1)
             and coalesce(cs.max_plausible_consultation_minutes, 90)
  from public.consultations c
  join public.services s on s.id = c.service_id
  left join public.clinic_settings cs on cs.clinic_id = s.clinic_id
  where c.id = p_consultation_id;
$$;

grant execute on function public.consultation_counts_towards_average(uuid) to authenticated;

-- next_patient(): add ended_counted + ended_exclusion_reason to the result.
create or replace function public.next_patient(
  p_action_id     uuid,
  p_long_decision text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller uuid := public.auth_profile_id();
  prof   public.profiles; prev public.consultations;
  entry  public.queue_entries; cons public.consultations;
  cfg    public.clinic_settings; stats record;
  mins numeric; threshold numeric;
  is_break boolean := coalesce(p_long_decision = 'break', false);
  prior jsonb; out_j jsonb;
begin
  if public.auth_role() <> 'nurse' then
    raise exception 'Only nurses can advance the queue';
  end if;

  select result into prior from public.nurse_actions
   where nurse_id = caller and action_id = p_action_id;
  if found then return prior || jsonb_build_object('replayed', true); end if;

  select * into prof from public.profiles where id = caller for update;
  if not prof.is_on_duty then raise exception 'You are off duty'; end if;
  if prof.current_service_id is null then
    raise exception 'You are not assigned to a service';
  end if;

  select * into cfg from public.clinic_settings where clinic_id = prof.clinic_id;

  select * into prev from public.consultations
   where nurse_id = caller and ended_at is null
   order by started_at limit 1 for update;

  if found then
    mins := extract(epoch from (clock_timestamp() - prev.started_at)) / 60.0;
    select coalesce(avg_minutes, 15) * coalesce(cfg.long_consultation_multiplier, 2.0)
      into threshold from public.service_consultation_stats(prev.service_id);

    if mins > threshold and p_long_decision is null then
      return jsonb_build_object(
        'status','long_consultation',
        'queue_entry_id', prev.queue_entry_id,
        'duration_minutes', round(mins, 1),
        'threshold_minutes', round(threshold, 1));
    end if;

    update public.consultations
       set ended_at = greatest(clock_timestamp(), prev.started_at + interval '1 second'),
           exclude_from_prediction = is_break,
           exclusion_reason = case when is_break then 'staff_break' end
     where id = prev.id returning * into prev;

    update public.queue_entries set status='done', completed_at=clock_timestamp()
     where id = prev.queue_entry_id;
  end if;

  select * into entry
  from public.queue_entries q
  where q.service_id = prof.current_service_id
    and q.queue_date = current_date and q.status = 'waiting'
  order by q.priority desc, q.checked_in_at asc, q.token_number asc
  for update skip locked limit 1;

  if not found then
    out_j := jsonb_build_object(
      'status','queue_empty',
      'ended_consultation_id', prev.id,
      'ended_token', (select token from public.queue_entries where id = prev.queue_entry_id),
      'ended_minutes', case when prev.id is not null
        then round(extract(epoch from (prev.ended_at - prev.started_at))/60.0, 1) end,
      'ended_counted', case when prev.id is not null
        then public.consultation_counts_towards_average(prev.id) end,
      'ended_exclusion_reason', prev.exclusion_reason);
    insert into public.nurse_actions (nurse_id, action_id, result)
      values (caller, p_action_id, out_j);
    return out_j;
  end if;

  update public.queue_entries set status='in_progress', called_at=clock_timestamp()
   where id = entry.id returning * into entry;

  insert into public.consultations (queue_entry_id, nurse_id, service_id, started_at)
  values (entry.id, caller, entry.service_id, clock_timestamp())
  returning * into cons;

  select * into stats from public.service_consultation_stats(entry.service_id);

  out_j := jsonb_build_object(
    'status','called',
    'queue_entry_id', entry.id,
    'consultation_id', cons.id,
    'token', entry.token,
    'patient_name', (select full_name from public.profiles where id = entry.patient_id),
    'priority', entry.priority,
    'ended_consultation_id', prev.id,
    'ended_token', (select token from public.queue_entries where id = prev.queue_entry_id),
    'ended_minutes', case when prev.id is not null
      then round(extract(epoch from (prev.ended_at - prev.started_at))/60.0, 1) end,
    'ended_counted', case when prev.id is not null
      then public.consultation_counts_towards_average(prev.id) end,
    'ended_exclusion_reason', prev.exclusion_reason,
    'service_average', stats.avg_minutes,
    'confidence', public.confidence_label(entry.service_id, stats.sample_count, stats.stddev_minutes),
    'undo_window_seconds', coalesce(cfg.undo_window_seconds, 60));

  insert into public.nurse_actions (nurse_id, action_id, result)
    values (caller, p_action_id, out_j);

  return out_j;
end;
$$;

notify pgrst, 'reload schema';
