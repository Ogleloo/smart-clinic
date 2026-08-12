-- Migration 0031: end_shift() — going off duty must not orphan a consultation.
--
-- set_duty(false) cleared duty state but left any open consultation open.
-- That is the mechanism behind the outlier durations already being
-- rejected by the plausibility ceiling: a consultation nobody closed,
-- accumulating hours until someone noticed.
--
-- Reuses the same "finish current safely" logic as next_patient() rather
-- than implementing a second version of it, so the two cannot drift apart.

create or replace function public.end_shift(
  p_long_decision text default null   -- null | 'record' | 'break'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller uuid := public.auth_profile_id();
  prof   public.profiles;
  cfg    public.clinic_settings;
  prev   public.consultations;
  mins numeric; threshold numeric;
  is_break boolean := coalesce(p_long_decision = 'break', false);
begin
  if public.auth_role() <> 'nurse' then
    raise exception 'Only nurses have shifts';
  end if;

  select * into prof from public.profiles where id = caller for update;
  select * into cfg  from public.clinic_settings where clinic_id = prof.clinic_id;

  select * into prev from public.consultations
   where nurse_id = caller and ended_at is null
   order by started_at limit 1 for update;

  if found then
    mins := extract(epoch from (clock_timestamp() - prev.started_at)) / 60.0;
    select coalesce(avg_minutes, 15) * coalesce(cfg.long_consultation_multiplier, 2.0)
      into threshold from public.service_consultation_stats(prev.service_id);

    -- Same guard as next_patient: do not silently average a long span.
    if mins > threshold and p_long_decision is null then
      return jsonb_build_object(
        'status','long_consultation',
        'duration_minutes', round(mins, 1),
        'threshold_minutes', round(threshold, 1));
    end if;

    update public.consultations
       set ended_at = greatest(clock_timestamp(), prev.started_at + interval '1 second'),
           exclude_from_prediction = is_break,
           exclusion_reason = case when is_break then 'staff_break' end
     where id = prev.id returning * into prev;

    update public.queue_entries
       set status = 'done', completed_at = clock_timestamp()
     where id = prev.queue_entry_id;
  end if;

  update public.profiles
     set is_on_duty = false, current_service_id = null, updated_at = now()
   where id = caller;

  return jsonb_build_object(
    'status','shift_ended',
    'closed_consultation', prev.id is not null,
    'closed_token', (select token from public.queue_entries where id = prev.queue_entry_id),
    'closed_minutes', case when prev.id is not null
      then round(extract(epoch from (prev.ended_at - prev.started_at))/60.0, 1) end,
    'excluded', is_break);
end;
$$;

revoke execute on function public.end_shift(text) from public, anon;
grant execute on function public.end_shift(text) to authenticated;

notify pgrst, 'reload schema';
