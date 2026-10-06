-- Migration 0053: staff onboarding by invitation.
--
-- BR-01 says only administrators may create staff accounts, but nothing
-- implemented it: staff existed only because they were seeded by SQL. An
-- administrator had no way to onboard a new nurse or receptionist, and the
-- admin screen could not demonstrate it.
--
-- DESIGN. The administrator records an INVITATION (email, name, role). The
-- invitee registers normally and verifies their email with the OTP. Only
-- after the address is verified does accept_staff_invitation() apply the
-- role. Three properties follow:
--
--  1. The role comes from a database row the administrator wrote, never from
--     anything the registering user can influence. handle_new_user() already
--     hardcodes 'patient' and ignores metadata; that stays true.
--  2. Verification is what proves the invitee owns the address. Without it,
--     anyone could register the invited address first and claim the role.
--  3. The administrator never sees or sets a password.
--
-- ADMINISTRATORS CANNOT CREATE ADMINISTRATORS. The table constrains role to
-- nurse or receptionist, so this holds even if application code is wrong.
-- Administrator accounts are created out of band by the platform operator,
-- the same way a clinic is. "Administrator" is a role WITHIN one clinic
-- (ADR-029), not a platform superuser, so there is no escalation path here.

create table if not exists public.staff_invitations (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references public.clinics(id) on delete cascade,
  email       text not null,
  full_name   text not null,
  role        public.user_role not null,
  invited_by  uuid not null references public.profiles(id),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  accepted_by uuid references public.profiles(id),
  revoked_at  timestamptz,
  constraint staff_invitation_role_is_staff check (role in ('nurse','receptionist')),
  constraint staff_invitation_email_lower   check (email = lower(email))
);

create unique index if not exists staff_invitations_one_open_per_email
  on public.staff_invitations (email)
  where accepted_at is null and revoked_at is null;

alter table public.staff_invitations enable row level security;

drop policy if exists staff_invitations_admin_read on public.staff_invitations;
create policy staff_invitations_admin_read on public.staff_invitations
  for select to authenticated
  using (public.auth_role() = 'admin' and clinic_id = public.auth_clinic_id());

-- Read only. All writes go through the functions below, which carry the
-- authorisation logic, so there is deliberately no insert/update grant.
grant select on public.staff_invitations to authenticated;

-- ---------------------------------------------------------------------
create or replace function public.admin_invite_staff(
  p_email     text,
  p_full_name text,
  p_role      public.user_role
)
returns public.staff_invitations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me   uuid := public.auth_profile_id();
  cl   uuid := public.auth_clinic_id();
  mail text := lower(trim(coalesce(p_email, '')));
  inv  public.staff_invitations;
begin
  -- is distinct from: a NULL role must refuse, not slip through.
  if public.auth_role() is distinct from 'admin' then
    raise exception 'Only an administrator may invite staff';
  end if;
  if cl is null then
    raise exception 'Your account is not attached to a clinic';
  end if;
  if p_role is null or p_role not in ('nurse','receptionist') then
    raise exception 'Staff accounts can only be created for nurses and receptionists';
  end if;
  if mail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'That does not look like an email address';
  end if;
  if nullif(trim(coalesce(p_full_name, '')), '') is null then
    raise exception 'Full name is required';
  end if;
  if exists (select 1 from auth.users where lower(email) = mail) then
    raise exception 'An account already exists for this email address';
  end if;

  -- A newer invitation supersedes an older open one for the same address.
  update public.staff_invitations
     set revoked_at = now()
   where email = mail and accepted_at is null and revoked_at is null;

  insert into public.staff_invitations (clinic_id, email, full_name, role, invited_by)
  values (cl, mail, trim(p_full_name), p_role, me)
  returning * into inv;

  return inv;
end;
$$;

-- ---------------------------------------------------------------------
create or replace function public.admin_revoke_staff_invitation(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.auth_role() is distinct from 'admin' then
    raise exception 'Only an administrator may revoke invitations';
  end if;

  update public.staff_invitations
     set revoked_at = now()
   where id = p_id
     and clinic_id = public.auth_clinic_id()
     and accepted_at is null and revoked_at is null;

  if not found then
    raise exception 'Invitation not found, or it has already been used';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Called by the app after a successful verifyOtp / first sign-in. Safe to
-- call for every user: it does nothing unless an open invitation exists for
-- the caller's VERIFIED address.
create or replace function public.accept_staff_invitation()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid       uuid := auth.uid();
  mail      text;
  confirmed timestamptz;
  prof      public.profiles;
  inv       public.staff_invitations;
begin
  if uid is null then raise exception 'Not authenticated'; end if;

  select lower(u.email), u.email_confirmed_at into mail, confirmed
  from auth.users u where u.id = uid;

  if confirmed is null then
    raise exception 'Verify your email address first';
  end if;

  select * into prof from public.profiles where auth_user_id = uid;
  if not found then raise exception 'Profile not found'; end if;

  -- Already staff (or already converted): nothing to do. Idempotent.
  if prof.role is distinct from 'patient' then
    return jsonb_build_object('status', 'not_applicable');
  end if;

  select * into inv from public.staff_invitations
   where email = mail
     and accepted_at is null and revoked_at is null
     and expires_at > now()
   order by created_at desc
   limit 1
   for update;

  if not found then
    return jsonb_build_object('status', 'none');
  end if;

  -- An account that already holds patient history is not silently turned
  -- into a staff account: that history would become a nurse's record.
  if exists (select 1 from public.appointments  where patient_id = prof.id)
     or exists (select 1 from public.queue_entries where patient_id = prof.id) then
    raise exception 'This account already has patient history and cannot become a staff account';
  end if;

  update public.profiles
     set role = inv.role,
         clinic_id = inv.clinic_id,
         full_name = inv.full_name,
         is_active = true,
         updated_at = now()
   where id = prof.id;

  update public.staff_invitations
     set accepted_at = now(), accepted_by = prof.id
   where id = inv.id;

  return jsonb_build_object('status', 'accepted', 'role', inv.role);
end;
$$;

-- ---------------------------------------------------------------------
-- admin_set_staff_status, tightened. Two defects in the original:
--   * it let an administrator promote anyone to administrator, and
--   * it had no clinic check, so an administrator at one clinic could modify
--     another clinic's staff (SECURITY DEFINER bypasses RLS) — the same class
--     of hole as migration 0038.
-- Now: own clinic only, nurse/receptionist targets only, never oneself,
-- never an administrator, and never a role change to administrator.
create or replace function public.admin_set_staff_status(
  p_profile_id uuid,
  p_is_active  boolean        default null,
  p_role       public.user_role default null
)
returns public.profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me     uuid := public.auth_profile_id();
  tgt    public.profiles;
  result public.profiles;
begin
  if public.auth_role() is distinct from 'admin' then
    raise exception 'Only an administrator may change staff records';
  end if;
  if p_profile_id = me then
    raise exception 'You cannot change your own role or active status';
  end if;

  select * into tgt from public.profiles where id = p_profile_id;
  if not found then raise exception 'Profile not found'; end if;

  if tgt.clinic_id is distinct from public.auth_clinic_id() then
    raise exception 'That staff member does not belong to your clinic';
  end if;
  if tgt.role not in ('nurse','receptionist') then
    raise exception 'Only nurse and receptionist accounts can be changed here';
  end if;
  if p_role is not null and p_role not in ('nurse','receptionist') then
    raise exception 'Staff can only be nurses or receptionists';
  end if;

  update public.profiles
     set is_active  = coalesce(p_is_active, is_active),
         role       = coalesce(p_role, role),
         updated_at = now()
   where id = p_profile_id
  returning * into result;

  return result;
end;
$$;

grant execute on function public.admin_invite_staff(text, text, public.user_role) to authenticated;
grant execute on function public.admin_revoke_staff_invitation(uuid)              to authenticated;
grant execute on function public.accept_staff_invitation()                        to authenticated;

notify pgrst, 'reload schema';
