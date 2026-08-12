-- Migration 0002: Function hardening
-- Closes advisor WARNs from 0001. No behaviour change.

-- 1. Pin search_path on the touch trigger (prevents search-path hijacking).
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- 2. handle_new_user() is SECURITY DEFINER and must only ever run as a
--    trigger. Remove the public execute grant PostgREST would expose.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- 3. auth_role()/auth_profile_id() only return facts about the caller,
--    so authenticated execute stays. Explicitly deny anon.
revoke execute on function public.auth_role() from anon;
revoke execute on function public.auth_profile_id() from anon;
