-- Migration 0047: revoke anon EXECUTE again, and stop relying on memory.
--
-- Third occurrence of the same defect. Migration 0040 revoked every
-- function anon could execute; migration 0043 then created
-- notify_appointment_no_show() and did not revoke it, because in
-- PostgreSQL CREATE FUNCTION grants EXECUTE to PUBLIC by default.
--
-- The rule was already written into CLAUDE.md at the time this happened.
-- Documentation did not prevent it; the assertion caught it. That is the
-- argument for asserting invariants rather than trusting discipline —
-- the same person who wrote the rule broke it two migrations later.
--
-- An EVENT TRIGGER now enforces it: any newly created function in the
-- public schema has EXECUTE revoked from PUBLIC and anon automatically,
-- except the one function that is deliberately public (ADR-028). The
-- default becomes safe instead of the exception being remembered.

revoke execute on function public.notify_appointment_no_show() from public, anon;

create or replace function public.revoke_anon_on_new_functions()
returns event_trigger
language plpgsql
as $$
declare obj record;
begin
  for obj in select * from pg_event_trigger_ddl_commands()
             where command_tag in ('CREATE FUNCTION', 'ALTER FUNCTION')
  loop
    -- get_public_queue_display is the single deliberate anon surface.
    if obj.object_identity not like 'public.get_public_queue_display%' then
      begin
        execute format('revoke execute on function %s from public, anon',
                       obj.object_identity);
      exception when others then
        null;  -- non-function objects, or already revoked
      end;
    end if;
  end loop;
end;
$$;

drop event trigger if exists trg_revoke_anon_on_new_functions;
create event trigger trg_revoke_anon_on_new_functions
  on ddl_command_end
  when tag in ('CREATE FUNCTION', 'ALTER FUNCTION')
  execute function public.revoke_anon_on_new_functions();

notify pgrst, 'reload schema';
