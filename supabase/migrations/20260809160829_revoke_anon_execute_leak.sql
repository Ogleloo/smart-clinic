-- Migration 0040: close an anon-executable data leak.
--
-- Found by the new invariant assertion "Only the display board is
-- anon-callable" on its FIRST run — not by manual testing, which had
-- never thought to try.
--
-- nth_waiting_entry() is SECURITY DEFINER and returns a full
-- queue_entries row, including patient_id. It was granted to anon by
-- Postgres's default EXECUTE-to-PUBLIC behaviour, which I did not revoke
-- when adding it in migration 0024. Service ids are not secret — they
-- appear in the /display/<serviceId> URL — so an anonymous visitor could
-- enumerate the queue and read patient identifiers.
--
-- ROOT CAUSE WORTH RECORDING: in Postgres, CREATE FUNCTION grants EXECUTE
-- to PUBLIC by default. Every function is exposed unless explicitly
-- revoked. Security here is opt-out, not opt-in — the reverse of the
-- assumption that produced this bug.

revoke execute on function public.nth_waiting_entry(uuid, int) from public, anon;
grant  execute on function public.nth_waiting_entry(uuid, int) to authenticated;

revoke execute on function public.consultation_counts_towards_average(uuid) from public, anon;
grant  execute on function public.consultation_counts_towards_average(uuid) to authenticated;

-- Trigger functions: not directly exploitable (they error outside a
-- trigger context) but there is no reason for anon to hold EXECUTE.
do $$
declare r record;
begin
  for r in
    select pr.oid::regprocedure as sig
    from pg_proc pr
    join pg_namespace ns on ns.oid = pr.pronamespace and ns.nspname = 'public'
    where pr.prorettype = 'trigger'::regtype
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
  end loop;
end $$;

revoke execute on function public.prune_queue_events() from public, anon;

notify pgrst, 'reload schema';
