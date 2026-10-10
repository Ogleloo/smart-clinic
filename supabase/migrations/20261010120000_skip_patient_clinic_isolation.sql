-- skip_patient(): enforce clinic isolation, caller validity, and
-- role-specific status transitions inside the database.
--
-- Found during Reception V3 Phase 3 review (PR #25). The previous
-- definition (20260809125334_skip_patient_closes_consultation) had three
-- defects, all reachable by calling the RPC directly with a valid JWT:
--
--   1. No clinic isolation. The only check was auth_role(); the queue entry
--      was never tied to the caller's clinic. As SECURITY DEFINER the
--      function bypasses RLS, so any nurse/receptionist/admin who knew a
--      queue_entry_id from another clinic could skip it — and, for an
--      in_progress entry, close that clinic's open consultation.
--
--   2. NULL role bypass. `if auth_role() not in (...)` evaluates to NULL
--      (not true) when the caller has no profile row, so the exception was
--      never raised. No such account exists today (verified read-only
--      before writing this), but the check must not depend on that.
--
--   3. Receptionists could skip in_progress entries. Business rule:
--      reception may only skip a patient who is still WAITING. The old
--      comment already conceded that hiding the button "does not make the
--      call safe"; this moves the rule into the function.
--
-- Also hardened:
--   - Caller must be an ACTIVE profile (deactivated staff are refused).
--   - The target row is locked (FOR UPDATE) before its status is checked,
--     so a concurrent next_patient()/end_consultation()/second skip cannot
--     change it between the check and the write. next_patient() claims rows
--     with FOR UPDATE SKIP LOCKED, so it simply passes over a row being
--     skipped rather than blocking.
--   - Consultation cleanup now runs only AFTER authorization and status
--     validation succeed. (Previously it ran first and relied on the
--     transaction rolling back if the later UPDATE failed.)
--   - Nonexistent and cross-clinic entries return the same error, so the
--     function is not an oracle for whether another clinic's UUID exists.
--   - Receptionists may not pass p_no_show = true: reception skips set
--     status 'skipped' only. No existing caller passes p_no_show, so this
--     breaks nothing today.
--
-- Unchanged, deliberately:
--   - Signature, defaults and return type (public.queue_entries).
--   - Nurse/admin behaviour within their own clinic: may skip/no-show a
--     waiting OR in_progress entry; an open consultation on the entry is
--     closed and excluded from prediction, exactly as in 20260809125334.
--   - Existing error text for nurse/admin ("That patient is not in an
--     active state") so the nurse UI's messaging is unaffected.
--   - EXECUTE: authenticated only (re-stated below; never public/anon).

create or replace function public.skip_patient(
  p_queue_entry_id uuid,
  p_no_show boolean default false
)
returns public.queue_entries
language plpgsql
volatile
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  caller public.profiles;
  entry  public.queue_entries;
begin
  -- 1. Authenticate: the JWT must map to an existing, active profile.
  select p.* into caller
    from public.profiles p
   where p.auth_user_id = auth.uid()
   limit 1;

  if not found or not caller.is_active then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  -- 2. Role. caller.role is NOT NULL, so this cannot be bypassed by NULL.
  if caller.role not in ('nurse', 'receptionist', 'admin') then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  -- 3. The caller's authorized clinic.
  if caller.clinic_id is null then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  if caller.role = 'receptionist' and coalesce(p_no_show, false) then
    raise exception 'Reception can only skip a waiting patient, not mark a no-show'
      using errcode = '42501';
  end if;

  -- 4 + 5. Resolve the entry ONLY within the caller's clinic (both the
  -- entry's own clinic_id and its service's clinic must match), and lock it
  -- before reading its status.
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

  -- 6 + 7. Role-specific status transitions, checked on the locked row.
  if caller.role = 'receptionist' then
    if entry.status = 'in_progress' then
      raise exception 'This patient is already in consultation and can''t be skipped from reception';
    elsif entry.status <> 'waiting' then
      raise exception 'That patient is no longer waiting';
    end if;
  elsif entry.status not in ('waiting', 'in_progress') then
    raise exception 'That patient is not in an active state';
  end if;

  -- 9 + 10. Authorized and valid: close any consultation still open
  -- against this entry so it can't be mistaken for live work later.
  update public.consultations
     set ended_at = greatest(clock_timestamp(), started_at + interval '1 second'),
         exclude_from_prediction = true,
         exclusion_reason = case when p_no_show then 'patient_no_show'
                                 else 'patient_skipped' end
   where queue_entry_id = entry.id
     and ended_at is null;

  update public.queue_entries
     set status = case when p_no_show then 'no_show'::public.queue_entry_status
                       else 'skipped'::public.queue_entry_status end,
         completed_at = now()
   where id = entry.id
  returning * into entry;

  return entry;
end;
$function$;

revoke execute on function public.skip_patient(uuid, boolean) from public, anon;
grant  execute on function public.skip_patient(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
