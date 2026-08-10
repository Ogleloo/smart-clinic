-- Migration 0005: Transactional token allocation + RLS for Slice 2

-- ---------- allocate_token ----------
-- Naive max(token_number)+1 is a race: two simultaneous check-ins read
-- the same max and both write GC-016. A transaction-scoped advisory
-- lock serialises allocation per (clinic, service, day); the unique
-- index is the backstop if anything ever slips through.
create or replace function public.check_in_patient(
  p_service_id uuid,
  p_patient_id uuid,
  p_priority   smallint default 0
)
returns public.queue_entries
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  svc         record;
  caller_role public.user_role;
  next_num    int;
  entry       public.queue_entries;
begin
  caller_role := public.auth_role();
  if caller_role not in ('receptionist','nurse','admin') then
    raise exception 'Only clinic staff can check patients in';
  end if;

  select id, clinic_id, token_prefix into svc
  from public.services where id = p_service_id and is_active;
  if not found then raise exception 'Service not found or inactive'; end if;

  if svc.clinic_id is distinct from public.auth_clinic_id() then
    raise exception 'Not authorised for this clinic';
  end if;

  -- BR-10: only nurses/triage may create an emergency entry.
  if p_priority = 1 and caller_role not in ('nurse','admin') then
    raise exception 'Only clinical staff can assign emergency priority';
  end if;

  -- Serialise allocation for this service+day.
  perform pg_advisory_xact_lock(
    hashtextextended(svc.clinic_id::text || p_service_id::text || current_date::text, 0)
  );

  select coalesce(max(token_number), 0) + 1 into next_num
  from public.queue_entries
  where clinic_id  = svc.clinic_id
    and service_id = p_service_id
    and queue_date = current_date;

  insert into public.queue_entries (
    clinic_id, service_id, patient_id, token, token_number,
    queue_date, priority, status, checked_in_at,
    priority_set_by, priority_set_at
  ) values (
    svc.clinic_id, p_service_id, p_patient_id,
    svc.token_prefix || '-' || lpad(next_num::text, 3, '0'),
    next_num, current_date, p_priority, 'waiting', now(),
    case when p_priority = 1 then public.auth_profile_id() end,
    case when p_priority = 1 then now() end
  )
  returning * into entry;

  return entry;
end;
$$;
revoke execute on function public.check_in_patient(uuid,uuid,smallint) from public, anon;
grant execute on function public.check_in_patient(uuid,uuid,smallint) to authenticated;

-- ---------- RLS ----------
alter table public.clinics         enable row level security;
alter table public.services        enable row level security;
alter table public.clinic_settings enable row level security;
alter table public.queue_entries   enable row level security;
alter table public.consultations   enable row level security;

-- Clinics and services are reference data: any signed-in user may read.
create policy clinics_read on public.clinics for select to authenticated using (true);
create policy clinics_admin_write on public.clinics for all to authenticated
  using (public.auth_role() = 'admin') with check (public.auth_role() = 'admin');

create policy services_read on public.services for select to authenticated using (true);
create policy services_admin_write on public.services for all to authenticated
  using (public.auth_role() = 'admin') with check (public.auth_role() = 'admin');

-- Settings: staff read, admins write.
create policy settings_read on public.clinic_settings for select to authenticated
  using (clinic_id = public.auth_clinic_id() or public.auth_role() = 'admin');
create policy settings_admin_write on public.clinic_settings for all to authenticated
  using (public.auth_role() = 'admin') with check (public.auth_role() = 'admin');

-- Queue entries: a patient sees ONLY their own row. Position comes from
-- the SECURITY DEFINER engine, not from reading other people's rows.
create policy queue_select_own on public.queue_entries for select to authenticated
  using (patient_id = public.auth_profile_id());

create policy queue_select_staff on public.queue_entries for select to authenticated
  using (public.auth_role() in ('receptionist','nurse','admin')
         and clinic_id = public.auth_clinic_id());

create policy queue_staff_update on public.queue_entries for update to authenticated
  using (public.auth_role() in ('receptionist','nurse','admin')
         and clinic_id = public.auth_clinic_id())
  with check (public.auth_role() in ('receptionist','nurse','admin')
         and clinic_id = public.auth_clinic_id());

-- No INSERT policy: entries are created only through check_in_patient().
-- BR-10 remains enforced because receptionists have no direct write path
-- to `priority` on insert.

-- Consultations: nurses own theirs; staff read within clinic.
create policy consultations_nurse_write on public.consultations for all to authenticated
  using (nurse_id = public.auth_profile_id())
  with check (nurse_id = public.auth_profile_id());

create policy consultations_staff_read on public.consultations for select to authenticated
  using (public.auth_role() in ('receptionist','admin')
         and exists (select 1 from public.services s
                     where s.id = consultations.service_id
                       and s.clinic_id = public.auth_clinic_id()));

grant select on public.clinics, public.services, public.clinic_settings,
                public.queue_entries, public.consultations to authenticated;
grant insert, update on public.consultations to authenticated;
grant update on public.queue_entries to authenticated;
