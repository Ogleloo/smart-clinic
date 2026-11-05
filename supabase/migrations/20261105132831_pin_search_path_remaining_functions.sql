-- Pin search_path on the last two functions that lack it.
--
-- Supabase's security advisor reports function_search_path_mutable for
-- public.update_updated_at and public.revoke_anon_on_new_functions: every
-- other function in this schema sets search_path explicitly, these two were
-- missed. A function with a mutable search_path resolves unqualified names
-- against whatever the caller's search_path happens to be, so a schema the
-- caller controls and places first can supply a different now(), or a
-- different format(), than the author meant.
--
-- Neither is exploitable as things stand -- one touches no catalog objects and
-- the other is an event trigger that only a DDL-issuing role can fire -- but
-- "not exploitable today" is not the standard the rest of this schema is held
-- to, and leaving two WARNs permanently lit trains people to ignore the
-- advisor. Bodies are unchanged; only the search_path setting is added.

begin;

create or replace function public.update_updated_at()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- pg_catalog first, because this one calls pg_event_trigger_ddl_commands() and
-- format() -- both catalog functions -- and resolves no objects of its own in
-- public. Listing public at all is only for consistency with the rest.
create or replace function public.revoke_anon_on_new_functions()
returns event_trigger
language plpgsql
set search_path to 'pg_catalog', 'public', 'pg_temp'
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

commit;
