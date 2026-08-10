-- Migration 0012: Walk-in patient creation (Vertical Slice 4)
--
-- The payoff for ADR-015. A person who walks into the clinic with no
-- email, no phone and no account must still become a patient record.
-- profiles deliberately has NO insert policy (patients must not be able
-- to create rows), so creation goes through a role-checked RPC.

create or replace function public.create_walkin_patient(
  p_full_name text,
  p_phone     text default null
)
returns public.profiles
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  caller_role public.user_role := public.auth_role();
  clean_name  text := nullif(trim(p_full_name), '');
  clean_phone text := nullif(trim(p_phone), '');
  prof        public.profiles;
begin
  if caller_role not in ('receptionist','nurse','admin') then
    raise exception 'Only clinic staff can register walk-in patients';
  end if;
  if clean_name is null then
    raise exception 'A patient name is required';
  end if;

  -- auth_user_id stays NULL: this person has no login. If they later
  -- register, an admin can link the account to this record.
  insert into public.profiles (full_name, phone, role, auth_user_id)
  values (clean_name, clean_phone, 'patient', null)
  returning * into prof;

  return prof;
end;
$$;

-- Search patients for the walk-in / check-in flows.
-- Returns only what reception needs; never the whole table.
create or replace function public.search_patients(p_query text)
returns table (id uuid, full_name text, phone text, has_account boolean)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  caller_role public.user_role := public.auth_role();
  q text := nullif(trim(p_query), '');
begin
  if caller_role not in ('receptionist','nurse','admin') then
    raise exception 'Not authorised';
  end if;
  if q is null or length(q) < 2 then
    return;   -- refuse to dump the patient list on an empty search
  end if;

  return query
  select p.id, p.full_name, p.phone, (p.auth_user_id is not null)
  from public.profiles p
  where p.role = 'patient'
    and p.is_active
    and (p.full_name ilike '%' || q || '%' or p.phone ilike '%' || q || '%')
  order by p.full_name
  limit 20;
end;
$$;

revoke execute on function public.create_walkin_patient(text,text) from public, anon;
revoke execute on function public.search_patients(text) from public, anon;
grant execute on function public.create_walkin_patient(text,text) to authenticated;
grant execute on function public.search_patients(text) to authenticated;
