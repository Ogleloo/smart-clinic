-- skip_waiting_patient(): skip a patient ONLY if they are still waiting, decided under the same row lock that
-- performs the transition.
--
-- STATUS: NOT APPLIED. Committed for review on branch chore/skip-waiting-patient-migration; must not be applied
-- to project bffhjvpkfivtbzqielve without explicit approval. When it is applied (apply_migration), Supabase
-- records its own version timestamp: rename this file to that version in the same change (see
-- docs/proposals/skip_waiting_patient_atomic.md §5), so file and schema_migrations agree.
--
-- Why: a nurse's skip_patient() also accepts an in_progress entry and closes its consultation, so any
-- "read status, then call skip_patient()" approach races next_patient(). Here the expected status is checked
-- on the locked row. next_patient() claims patients with FOR UPDATE SKIP LOCKED, so it either passes over a
-- row being skipped, or the skip waits for the call to commit and then refuses.
--
-- Additive only: skip_patient() is unchanged, no table, column, policy or existing grant changes, and no
-- caller uses this yet. Rollback: drop function public.skip_waiting_patient(uuid); notify pgrst, 'reload schema';

create or replace function public.skip_waiting_patient(p_queue_entry_id uuid)
returns public.queue_entries
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  caller public.profiles;
  entry  public.queue_entries;
begin
  -- 1. Authenticate: the JWT must map to an existing, active profile (same checks, order and messages as
  --    skip_patient() since 20261010003117_skip_patient_clinic_isolation).
  select p.* into caller
    from public.profiles p
   where p.auth_user_id = auth.uid()
   limit 1;

  if not found or not caller.is_active then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  -- 2. Role: staff only. caller.role is NOT NULL, so this cannot be bypassed by NULL.
  if caller.role not in ('nurse', 'receptionist', 'admin') then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  -- 3. The caller's own clinic.
  if caller.clinic_id is null then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  -- 4. Resolve the entry only inside the caller's clinic (entry and service must both match) and lock it.
  --    Under READ COMMITTED, if another transaction holds the row, this waits for it and then re-reads the
  --    committed row, so step 5 sees that transaction's outcome.
  select q.* into entry
    from public.queue_entries q
    join public.services s on s.id = q.service_id
   where q.id = p_queue_entry_id
     and q.clinic_id = caller.clinic_id
     and s.clinic_id = caller.clinic_id
   for update of q;

  if not found then
    -- Same message for "does not exist" and "belongs to another clinic".
    raise exception 'Queue entry not found' using errcode = 'P0002';
  end if;

  -- 5. The expected-status check, on the locked row.
  if entry.status = 'in_progress' then
    raise exception 'This patient is already in consultation and can''t be skipped from the waiting list'
      using errcode = '55000';
  elsif entry.status <> 'waiting' then
    raise exception 'That patient is no longer waiting' using errcode = '55000';
  end if;

  -- 6. Defence in depth: a waiting entry should never have an open consultation. If one exists, refuse rather
  --    than silently close someone's consultation.
  if exists (select 1 from public.consultations c where c.queue_entry_id = entry.id and c.ended_at is null) then
    raise exception 'This patient has an open consultation; refresh and try again' using errcode = '55000';
  end if;

  -- 7. The transition. Never touches consultations.
  update public.queue_entries
     set status = 'skipped'::public.queue_entry_status,
         completed_at = now()
   where id = entry.id
  returning * into entry;

  return entry;
end;
$function$;

comment on function public.skip_waiting_patient(uuid) is
  'Skip a queue entry only if it is still waiting (checked under the row lock). Staff of the entry''s clinic only. Never closes consultations.';

-- CREATE FUNCTION grants EXECUTE to PUBLIC by default. Opt out explicitly; only signed-in users may call it,
-- and the body authorizes them.
revoke all on function public.skip_waiting_patient(uuid) from public, anon;
grant execute on function public.skip_waiting_patient(uuid) to authenticated;

-- Make the new RPC visible to PostgREST without waiting for its periodic schema reload.
notify pgrst, 'reload schema';
