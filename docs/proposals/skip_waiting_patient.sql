-- PROPOSAL — NOT A MIGRATION. Do not apply without explicit approval.
-- Deliberately outside supabase/migrations/. See docs/proposals/skip_waiting_patient_atomic.md.
--
-- skip_waiting_patient(): skip a patient ONLY if they are still waiting, decided under the same row lock that
-- performs the transition. Closes the time-of-check/time-of-use race in a "read status, then skip_patient()"
-- approach: a nurse's skip_patient() also accepts an in_progress entry and closes its consultation.
--
-- Additive only: skip_patient() is not changed, no existing caller changes behaviour, no table or policy
-- changes. Rollback: drop function public.skip_waiting_patient(uuid);

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
  -- 1. Authenticate: the JWT must map to an existing, active profile. (Same checks, order and messages as
  --    skip_patient() after 20261010003117_skip_patient_clinic_isolation.)
  select p.* into caller
    from public.profiles p
   where p.auth_user_id = auth.uid()
   limit 1;

  if not found or not caller.is_active then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  -- 2. Role. Staff only; patients can never skip.
  if caller.role not in ('nurse', 'receptionist', 'admin') then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  -- 3. The caller's own clinic.
  if caller.clinic_id is null then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  -- 4. Resolve the entry ONLY inside the caller's clinic (entry and service must both match) and lock it.
  --    Under READ COMMITTED, if another transaction (next_patient(), undo_next_patient(), another skip) holds
  --    the row, this waits for it to finish and then re-reads the committed row — so the status check below
  --    sees the outcome of that transaction, never a stale value.
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

  -- 5. The expected-status check, on the locked row. This is the whole point of the function.
  if entry.status = 'in_progress' then
    raise exception 'This patient is already in consultation and can''t be skipped from the waiting list'
      using errcode = '55000';
  elsif entry.status <> 'waiting' then
    raise exception 'That patient is no longer waiting' using errcode = '55000';
  end if;

  -- 6. Defence in depth: a waiting entry should never have an open consultation. If one exists the data is
  --    inconsistent; refuse rather than silently close someone's consultation.
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

-- CREATE FUNCTION grants EXECUTE to PUBLIC by default (CLAUDE.md). Opt out explicitly.
revoke all on function public.skip_waiting_patient(uuid) from public, anon;
grant execute on function public.skip_waiting_patient(uuid) to authenticated;
