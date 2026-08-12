-- Migration 0027: make profile updates actually possible, safely.
--
-- Found by user testing: an admin could not toggle staff active status.
-- Cause: profiles had RLS policies permitting UPDATE but NO table-level
-- UPDATE grant to `authenticated`, so the statement failed before RLS
-- was consulted. A policy without a grant is a permission that looks
-- present and isn't — worth remembering: RLS narrows access, it never
-- widens it.
--
-- The fix is NOT a blanket grant. profiles_update_own lets a user update
-- their own row, and its WITH CHECK only verifies the row still belongs
-- to them — it does not constrain WHICH columns changed. A blanket
-- UPDATE grant would therefore let any patient set their own role to
-- 'admin'. So: column-level grants for self-service fields, and a
-- SECURITY DEFINER RPC for the privileged fields.

grant update (full_name, phone) on public.profiles to authenticated;

create or replace function public.admin_set_staff_status(
  p_profile_id uuid,
  p_is_active  boolean default null,
  p_role       public.user_role default null
)
returns public.profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare me uuid := public.auth_profile_id(); result public.profiles;
begin
  if public.auth_role() <> 'admin' then
    raise exception 'Only an administrator may change staff records';
  end if;

  -- An admin deactivating or demoting themselves can lock the clinic out
  -- of its own administration with no way back in.
  if p_profile_id = me and (p_is_active is false or p_role is distinct from null) then
    raise exception 'You cannot change your own role or active status';
  end if;

  if p_role = 'admin' and not exists (
       select 1 from public.profiles where id = p_profile_id and clinic_id is not null) then
    raise exception 'A staff member must belong to a clinic before becoming an administrator';
  end if;

  update public.profiles
     set is_active = coalesce(p_is_active, is_active),
         role      = coalesce(p_role, role),
         updated_at = now()
   where id = p_profile_id
  returning * into result;

  if not found then raise exception 'Profile not found'; end if;
  return result;
end;
$$;

revoke execute on function public.admin_set_staff_status(uuid, boolean, public.user_role)
  from public, anon;
grant execute on function public.admin_set_staff_status(uuid, boolean, public.user_role)
  to authenticated;

notify pgrst, 'reload schema';
