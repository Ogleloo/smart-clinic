-- Patient V3: date of birth and ID number become editable by the patient
-- (profile settings) and capturable at registration.
--
-- 1. GRANT. profiles_update_own already scopes UPDATE to the caller's own
--    row, but column-level UPDATE was only ever granted on full_name and
--    phone — a policy without a grant does nothing, so the settings form
--    would fail silently for these two columns without this. Role,
--    clinic_id, is_active etc. stay ungranted.
--
-- 2. handle_new_user() reads the two optional fields from signup
--    metadata. That metadata is client-supplied, so both are validated
--    here and dropped (left null) rather than raised on: a malformed
--    optional field must never block account creation, and the app
--    validates the same rules before calling signUp. Role is still
--    hardcoded 'patient' — nothing from metadata reaches it.
--
-- Additive only: deployed code never sends these keys, so for it the
-- function behaves exactly as before.

grant update (date_of_birth, id_number) on public.profiles to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  dob_text text := nullif(trim(new.raw_user_meta_data ->> 'date_of_birth'), '');
  dob      date;
  idn      text := nullif(upper(regexp_replace(coalesce(new.raw_user_meta_data ->> 'id_number', ''), '\s', '', 'g')), '');
begin
  if dob_text ~ '^\d{4}-\d{2}-\d{2}$' then
    begin
      dob := dob_text::date;
    exception when others then
      dob := null;
    end;
    if dob is not null and (dob > current_date or dob < date '1900-01-01') then
      dob := null;
    end if;
  end if;

  if idn is not null and idn !~ '^[A-Z0-9]{6,20}$' then
    idn := null;
  end if;

  insert into public.profiles (auth_user_id, full_name, phone, date_of_birth, id_number, role)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), 'New patient'),
    nullif(trim(new.raw_user_meta_data ->> 'phone'), ''),
    dob,
    idn,
    'patient'
  );
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

notify pgrst, 'reload schema';
