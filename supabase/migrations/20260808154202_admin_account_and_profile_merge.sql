-- Migration 0026: admin account + supported patient-profile merge.
--
-- Motivated by a real defect: Thamsanqa Mngomezulu existed twice — a
-- walk-in profile holding 3 appointments and 3 queue entries, and a
-- self-registered account holding none. He could log in and see nothing.
-- Walk-in-then-register is normal patient behaviour, so this needs to be
-- a supported operation rather than a manual repair.

-- ---------- 1. Admin account ----------
do $$
declare uid uuid := gen_random_uuid();
begin
  if not exists (select 1 from auth.users where email = 'admin@riverside.test') then
    insert into auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token,
      email_change_token_new, email_change
    ) values (
      uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'admin@riverside.test', crypt('admin-password-789', gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"System Administrator"}'::jsonb,
      '', '', '', ''
    );

    -- handle_new_user() forces role='patient'; correct it after the fact
    -- rather than weakening a trigger that exists to stop privilege
    -- escalation via self-registration (FR-1.2).
    update public.profiles
       set role = 'admin',
           clinic_id = '11111111-1111-1111-1111-111111111111',
           full_name = 'System Administrator',
           updated_at = now()
     where auth_user_id = uid;
  end if;
end $$;

-- ---------- 2. Merge ----------
create or replace function public.merge_patient_profiles(
  p_keep_id  uuid,
  p_merge_id uuid
)
returns table (
  queue_entries_moved int,
  appointments_moved  int,
  notifications_moved int,
  audit_refs_moved    int
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  keep_auth uuid; merge_auth uuid;
  n_q int; n_a int; n_n int; n_x int; n_tmp int;
begin
  if public.auth_role() <> 'admin' then
    raise exception 'Only an administrator may merge patient profiles';
  end if;
  if p_keep_id = p_merge_id then
    raise exception 'Cannot merge a profile into itself';
  end if;

  select auth_user_id into keep_auth  from public.profiles where id = p_keep_id  for update;
  select auth_user_id into merge_auth from public.profiles where id = p_merge_id for update;
  if not found then raise exception 'Profile not found'; end if;

  -- Two real accounts is not a duplicate. A human must decide which is
  -- correct; silently discarding one person's login is not a merge.
  if keep_auth is not null and merge_auth is not null then
    raise exception 'Both profiles have logins — this needs a human decision, not a merge';
  end if;

  update public.queue_entries set patient_id = p_keep_id where patient_id = p_merge_id;
  get diagnostics n_q = row_count;

  update public.appointments set patient_id = p_keep_id where patient_id = p_merge_id;
  get diagnostics n_a = row_count;

  -- CASCADE on recipient_id means skipping this deletes notifications
  -- silently rather than raising — the dangerous kind of data loss.
  update public.notifications set recipient_id = p_keep_id where recipient_id = p_merge_id;
  get diagnostics n_n = row_count;

  -- SET NULL columns: the delete would succeed while quietly erasing
  -- who did what.
  update public.appointments set cancelled_by = p_keep_id where cancelled_by = p_merge_id;
  get diagnostics n_x = row_count;
  update public.queue_entries set priority_set_by = p_keep_id where priority_set_by = p_merge_id;
  get diagnostics n_tmp = row_count;
  n_x := n_x + n_tmp;

  -- Carry the login across if only the merged profile had one.
  if keep_auth is null and merge_auth is not null then
    update public.profiles set auth_user_id = null  where id = p_merge_id;
    update public.profiles set auth_user_id = merge_auth, updated_at = now()
     where id = p_keep_id;
  end if;

  delete from public.profiles where id = p_merge_id;

  queue_entries_moved := n_q;
  appointments_moved  := n_a;
  notifications_moved := n_n;
  audit_refs_moved    := n_x;
  return next;
end;
$$;

revoke execute on function public.merge_patient_profiles(uuid,uuid) from public, anon;
grant execute on function public.merge_patient_profiles(uuid,uuid) to authenticated;

-- ---------- 3. Duplicate detection ----------
create or replace function public.find_duplicate_patients()
returns table (
  profile_a uuid, name_a text, phone_a text, has_login_a boolean, history_a bigint,
  profile_b uuid, name_b text, phone_b text, has_login_b boolean, history_b bigint,
  match_reason text
)
language sql stable security definer
set search_path = public, pg_temp
as $$
  with pts as (
    select p.id, p.full_name, p.phone, p.auth_user_id is not null as has_login,
           (select count(*) from public.queue_entries q where q.patient_id = p.id)
         + (select count(*) from public.appointments a where a.patient_id = p.id) as history
    from public.profiles p
    where p.role = 'patient'
  )
  select a.id, a.full_name, a.phone, a.has_login, a.history,
         b.id, b.full_name, b.phone, b.has_login, b.history,
         case when a.phone is not null and a.phone = b.phone
                and lower(a.full_name) = lower(b.full_name) then 'same name and phone'
              when a.phone is not null and a.phone = b.phone then 'same phone'
              else 'same name' end
  from pts a
  join pts b
    on a.id < b.id
   and ( (a.phone is not null and a.phone = b.phone)
      or lower(a.full_name) = lower(b.full_name) )
   -- only pairs a merge could actually resolve
   and not (a.has_login and b.has_login)
  where public.auth_role() = 'admin';
$$;

revoke execute on function public.find_duplicate_patients() from public, anon;
grant execute on function public.find_duplicate_patients() to authenticated;

notify pgrst, 'reload schema';
