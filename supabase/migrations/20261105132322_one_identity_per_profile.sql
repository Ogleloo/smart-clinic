-- One identity document, one profile.
--
-- A South African ID number identifies exactly one person, so two profiles must
-- never hold the same one. The existing guard does not achieve that:
--
--   profiles_id_number_clinic_unique  unique (clinic_id, id_number) where id_number is not null
--
-- Self-registered patients have clinic_id NULL, and in a unique index NULLs
-- never conflict with each other. So every self-registered patient is outside
-- the constraint entirely: the same ID can be registered any number of times.
-- That is not theoretical -- two ID numbers are currently duplicated across six
-- patient profiles and one staff profile on this database.
--
-- The complete fix is a global partial unique index on (id_number). It cannot
-- be created while those duplicates exist, and resolving them means deciding
-- which real accounts lose their stored ID. That decision is a person's, not a
-- migration's, so it is proposed separately in
-- docs/proposals/one_identity_per_profile_cleanup.sql and is NOT applied here.
--
-- What this migration does apply is the part that needs no such decision:
-- stop any NEW duplicate from being created. Existing rows are left exactly as
-- they are -- the trigger only inspects the value being written.

begin;

-- SECURITY DEFINER is load-bearing, not incidental. A patient's RLS policy on
-- profiles shows them their own row and nothing else, so the same query run with
-- the writer's privileges would find no conflicting row and the check would pass
-- for exactly the case it exists to catch.
--
-- The trade-off this accepts: a signed-in user who guesses an ID number learns
-- from the error message that it is registered. That is the same thing any
-- unique constraint tells its writer, it needs an authenticated session, and it
-- reveals no attribute of whoever holds it. Refusing silently would be worse --
-- the user would be told their own correct ID had been saved when it had not.
create or replace function public.profiles_reject_duplicate_id_number()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  -- No document, nothing to collide with. Clearing the field stays allowed:
  -- the columns are nullable and some existing profiles predate them.
  if new.id_number is null then
    return new;
  end if;

  -- Only a change is checked. A profile already holding a duplicated ID must
  -- still be able to edit its name, phone or date of birth -- and re-saving the
  -- same ID unchanged is not a new duplicate.
  if tg_op = 'UPDATE' and new.id_number is not distinct from old.id_number then
    return new;
  end if;

  if exists (
    select 1 from public.profiles p
     where p.id_number = new.id_number
       and p.id <> new.id
  ) then
    raise exception 'That ID or passport number is already registered.'
      using errcode = 'unique_violation';
  end if;

  return new;
end;
$$;

-- CREATE FUNCTION grants EXECUTE to PUBLIC, so anon loses it explicitly (this
-- project has leaked data that way once). `authenticated` keeps it, matching the
-- other trigger functions on this table (touch_updated_at,
-- check_service_clinic_match): a function returning `trigger` cannot be invoked
-- directly at all -- PostgreSQL refuses with "trigger functions can only be
-- called as triggers" -- so the grant conveys nothing beyond letting the trigger
-- fire for an ordinary writer.
revoke execute on function public.profiles_reject_duplicate_id_number() from public, anon;
grant execute on function public.profiles_reject_duplicate_id_number() to authenticated;

drop trigger if exists profiles_id_number_not_duplicated on public.profiles;
create trigger profiles_id_number_not_duplicated
  before insert or update of id_number on public.profiles
  for each row execute function public.profiles_reject_duplicate_id_number();

-- Signup must keep working.
--
-- A trigger exception raised during the auth.users insert surfaces to the
-- browser as GoTrue's generic "Database error saving new user" -- GoTrue does
-- not pass a trigger's message through, so failing signup here would show the
-- registrant an error that explains nothing. handle_new_user already drops a
-- malformed ID rather than failing signup, for the same reason; an
-- already-registered ID is now treated the same way. The account is created
-- with no ID number, the profile page's existing "complete your profile"
-- prompt asks for one, and saving it there goes through the trigger above and
-- gets the real message in the form where it can be acted on.
--
-- Net effect either way: the ID ends up on exactly one profile.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
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

  -- New: an ID already on another profile is dropped rather than duplicated.
  if idn is not null and exists (select 1 from public.profiles p where p.id_number = idn) then
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

-- Unchanged from before: handle_new_user is reachable only by the auth trigger.
-- Restated so a CREATE OR REPLACE on a fresh database does not leave it PUBLIC.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

commit;
