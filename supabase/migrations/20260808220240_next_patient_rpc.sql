-- Migration 0029: next_patient() and undo_next_patient().

create or replace function public.next_patient(
  p_action_id       uuid,
  p_long_decision   text default null   -- null | 'record' | 'break'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller uuid := public.auth_profile_id();
  prof   public.profiles;
  prev   public.consultations;
  entry  public.queue_entries;
  cons   public.consultations;
  cfg    public.clinic_settings;
  stats  record;
  mins   numeric; threshold numeric;
  prior  jsonb;
  out_j  jsonb;
begin
  if public.auth_role() <> 'nurse' then
    raise exception 'Only nurses can advance the queue';
  end if;

  -- IDEMPOTENCY. A replayed request returns the original result rather
  -- than performing a second transition. This is the protection a
  -- disabled button cannot give: retries and duplicate tabs bypass the UI.
  select result into prior from public.nurse_actions
   where nurse_id = caller and action_id = p_action_id;
  if found then
    return prior || jsonb_build_object('replayed', true);
  end if;

  select * into prof from public.profiles where id = caller for update;
  if not prof.is_on_duty then raise exception 'You are off duty'; end if;
  if prof.current_service_id is null then
    raise exception 'You are not assigned to a service';
  end if;

  select * into cfg from public.clinic_settings where clinic_id = prof.clinic_id;

  -- ---------- FINISH CURRENT (if any) ----------
  select * into prev from public.consultations
   where nurse_id = caller and ended_at is null
   order by started_at limit 1 for update;

  if found then
    mins := extract(epoch from (clock_timestamp() - prev.started_at)) / 60.0;

    select coalesce(avg_minutes, 15) * coalesce(cfg.long_consultation_multiplier, 2.0)
      into threshold
    from public.service_consultation_stats(prev.service_id);

    -- Suspiciously long AND undecided: do not advance the queue. Asking
    -- is one extra tap in a rare case; silently averaging a lunch break
    -- into every future estimate is a permanent distortion.
    if mins > threshold and p_long_decision is null then
      return jsonb_build_object(
        'status','long_consultation',
        'queue_entry_id', prev.queue_entry_id,
        'duration_minutes', round(mins, 1),
        'threshold_minutes', round(threshold, 1));
    end if;

    update public.consultations
       set ended_at = greatest(clock_timestamp(), prev.started_at + interval '1 second'),
           exclude_from_prediction = (p_long_decision = 'break'),
           exclusion_reason = case when p_long_decision = 'break'
                                   then 'staff_break' else null end
     where id = prev.id
    returning * into prev;

    update public.queue_entries
       set status = 'done', completed_at = clock_timestamp()
     where id = prev.queue_entry_id;
  end if;

  -- ---------- TRY TO GET NEXT ----------
  -- Separable by design: an empty queue must NOT roll back the ending
  -- above, or the last patient of every session stays open forever.
  select * into entry
  from public.queue_entries q
  where q.service_id = prof.current_service_id
    and q.queue_date = current_date
    and q.status = 'waiting'
  order by q.priority desc, q.checked_in_at asc, q.token_number asc
  for update skip locked
  limit 1;

  if not found then
    out_j := jsonb_build_object(
      'status','queue_empty',
      'ended_consultation_id', prev.id,
      'ended_token', (select token from public.queue_entries where id = prev.queue_entry_id));
    insert into public.nurse_actions (nurse_id, action_id, result)
      values (caller, p_action_id, out_j);
    return out_j;
  end if;

  update public.queue_entries
     set status = 'in_progress', called_at = clock_timestamp()
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
    'ended_excluded', coalesce(prev.exclude_from_prediction, false),
    'service_average', stats.avg_minutes,
    'confidence', public.confidence_label(entry.service_id, stats.sample_count, stats.stddev_minutes),
    'undo_window_seconds', coalesce(cfg.undo_window_seconds, 60));

  insert into public.nurse_actions (nurse_id, action_id, result)
    values (caller, p_action_id, out_j);

  return out_j;
end;
$$;

revoke execute on function public.next_patient(uuid, text) from public, anon;
grant execute on function public.next_patient(uuid, text) to authenticated;


-- Undo is a COMPENSATING operation, not a rollback. Realtime events have
-- already fired and other nurses may have acted; distributed state cannot
-- simply be rewound. It therefore succeeds only while reversal is still safe.
create or replace function public.undo_next_patient(p_action_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller uuid := public.auth_profile_id();
  act    public.nurse_actions;
  cfg    public.clinic_settings;
  r      jsonb;
  window_s int;
begin
  select * into act from public.nurse_actions
   where nurse_id = caller and action_id = p_action_id for update;
  if not found then raise exception 'Action not found'; end if;
  if act.undone_at is not null then raise exception 'Already undone'; end if;

  select cs.* into cfg from public.clinic_settings cs
  join public.profiles p on p.clinic_id = cs.clinic_id where p.id = caller;
  window_s := coalesce(cfg.undo_window_seconds, 60);

  if now() - act.created_at > make_interval(secs => window_s) then
    raise exception 'This action can no longer be undone';
  end if;

  -- Any later action by this nurse means the state has moved on.
  if exists (select 1 from public.nurse_actions
              where nurse_id = caller and created_at > act.created_at) then
    raise exception 'A later action has occurred; this can no longer be undone';
  end if;

  r := act.result;

  if r->>'status' = 'called' then
    -- The consultation must not have progressed to completion.
    if exists (select 1 from public.consultations
                where id = (r->>'consultation_id')::uuid and ended_at is not null) then
      raise exception 'That consultation has already ended; this can no longer be undone';
    end if;
    delete from public.consultations where id = (r->>'consultation_id')::uuid;
    update public.queue_entries set status = 'waiting', called_at = null
     where id = (r->>'queue_entry_id')::uuid and status = 'in_progress';
  end if;

  -- Reopen the consultation that was closed.
  if r->>'ended_consultation_id' is not null then
    update public.consultations
       set ended_at = null, exclude_from_prediction = false, exclusion_reason = null
     where id = (r->>'ended_consultation_id')::uuid;
    update public.queue_entries set status = 'in_progress', completed_at = null
     where id = (select queue_entry_id from public.consultations
                  where id = (r->>'ended_consultation_id')::uuid);
  end if;

  update public.nurse_actions set undone_at = now() where id = act.id;
  return jsonb_build_object('status','undone','restored_token', r->>'ended_token');
end;
$$;

revoke execute on function public.undo_next_patient(uuid) from public, anon;
grant execute on function public.undo_next_patient(uuid) to authenticated;

notify pgrst, 'reload schema';
