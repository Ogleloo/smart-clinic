-- READ-ONLY verification for 20261010232531_next_patient_no_key_update. Reads catalogs only; writes nothing.
--
-- Before applying (production): expect state = 'original' — the deployed definition this patch was made from
-- (md5 08dd4ed0cfeb73ac35a9243e82173edb). If state is 'unknown', production has drifted: STOP, do not apply.
-- After applying: expect state = 'fixed' and every other row ok = true.
-- Hashes are CR-insensitive (a replay from a Windows autocrlf checkout stores CRLF bodies).

with np as (
  select p.oid, p.prosecdef, p.proconfig, pg_get_function_result(p.oid) as result,
         replace(pg_get_functiondef(p.oid), E'\r', '') as def
    from pg_proc p
   where p.oid = 'public.next_patient(uuid,text)'::regprocedure
)
select * from (values
  ('state', (select case md5(def)
                    when '08dd4ed0cfeb73ac35a9243e82173edb' then 'original'
                    when 'df0e7850496cfb66fe138ea7c1db3d78' then 'fixed'
                    else 'unknown' end from np)),
  ('claim uses FOR NO KEY UPDATE SKIP LOCKED', (select (position('for no key update skip locked limit 1' in def) > 0)::text from np)),
  ('no FOR UPDATE SKIP LOCKED claim remains',  (select (position(E'\n  for update skip locked limit 1' in def) = 0)::text from np)),
  ('single overload next_patient(uuid, text)', (select (count(*) = 1)::text from pg_proc where proname = 'next_patient' and pronamespace = 'public'::regnamespace)),
  ('returns jsonb',                            (select (result = 'jsonb')::text from np)),
  ('SECURITY DEFINER',                         (select prosecdef::text from np)),
  ('search_path pinned to public, pg_temp',    (select ('search_path=public, pg_temp' = any(proconfig))::text from np)),
  ('authenticated can EXECUTE',                (select has_function_privilege('authenticated', oid, 'execute')::text from np)),
  ('anon cannot EXECUTE',                      (select (not has_function_privilege('anon', oid, 'execute'))::text from np)),
  ('PUBLIC has no EXECUTE grant',              (not exists (select 1 from information_schema.routine_privileges where routine_schema = 'public' and routine_name = 'next_patient' and grantee = 'PUBLIC'))::text),
  ('only get_public_queue_display is anon-callable',
     (select (coalesce(string_agg(p.proname, ',' order by p.proname), '') = 'get_public_queue_display')::text
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
         and pg_get_function_result(p.oid) not in ('trigger', 'event_trigger')))
) as checks(check_name, value);
