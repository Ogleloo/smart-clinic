#!/usr/bin/env bash
# Concurrency scenarios for skip_patient(), using two real Postgres sessions
# racing on the same row. Called by run.sh with the container name; expects
# fresh fixtures loaded. Prints PASS/FAIL lines; exits non-zero on any FAIL.
set -u
C="$1"
psql_() { docker exec -i "$C" psql -U postgres -d postgres -v ON_ERROR_STOP=0 -qtA "$@"; }
reload() { psql_ -c "truncate public.consultations, public.queue_entries, public.services, public.profiles, public.clinics cascade;" >/dev/null; psql_ -f /work/tests/skip_patient_authorization/fixtures.sql >/dev/null; }
fail=0
check() { if [ "$2" = "$3" ]; then echo "PASS [$1]"; else echo "FAIL [$1]: got '$2', expected '$3'"; fail=1; fi; }

REC_A=10000000-0000-4000-8000-000000000001
NURSE_A_PROFILE=20000000-0000-4000-8000-000000000003
SVC_A=5a000000-0000-4000-8000-000000000000
E7=e0000000-0000-4000-8000-000000000007
E8=e0000000-0000-4000-8000-000000000008
E1=e0000000-0000-4000-8000-000000000001

as_rec_a() { printf "begin; set local role authenticated; select set_config('request.jwt.claim.sub','%s',true); %s commit;\n" "$REC_A" "$1"; }

# C1: a nurse calls the patient (next_patient-style: lock row, set
# in_progress, open consultation) while reception tries to skip the same
# patient. Reception must wait for the lock, then see in_progress and be
# refused — the patient stays in consultation, nothing orphaned.
reload
psql_ <<SQL >/dev/null &
begin;
select 1 from public.queue_entries where id = '$E7' for update;
update public.queue_entries set status = 'in_progress', called_at = now() where id = '$E7';
insert into public.consultations (queue_entry_id, nurse_id, service_id) values ('$E7', '$NURSE_A_PROFILE', '$SVC_A');
select pg_sleep(3);
commit;
SQL
sleep 1
out=$(as_rec_a "select status from public.skip_patient('$E7');" | psql_ 2>&1 | tr '\n' ' ')
wait
final=$(psql_ -c "select q.status || '/' || (c.ended_at is null) from public.queue_entries q join public.consultations c on c.queue_entry_id = q.id where q.id = '$E7';")
echo "  C1 reception call output: $out"
check "C1 nurse calls patient while reception skips: final status/consultation-open" "$final" "in_progress/true"

# C2: two receptionists skip the same waiting patient at once. Exactly one
# succeeds; the other waits on the lock and is refused.
reload
as_rec_a "select status from public.skip_patient('$E8'); select pg_sleep(3);" | psql_ >/tmp/c2a.out 2>&1 &
sleep 1
second=$(as_rec_a "select status from public.skip_patient('$E8');" | psql_ 2>&1 | tr '\n' ' ')
wait
first=$(tr '\n' ' ' </tmp/c2a.out)
final=$(psql_ -c "select status from public.queue_entries where id = '$E8';")
echo "  C2 first: $first | second: $second"
check "C2 double skip: final status" "$final" "skipped"
case "$second" in *ERROR*) echo "PASS [C2 second concurrent skip was refused]";; *) echo "FAIL [C2 second concurrent skip was NOT refused]"; fail=1;; esac

# C3: while reception holds the lock on the head-of-queue patient, a
# next_patient-style claim (FOR UPDATE SKIP LOCKED) passes over it to the
# next waiting patient immediately instead of blocking or double-claiming.
reload
as_rec_a "select status from public.skip_patient('$E1'); select pg_sleep(3);" | psql_ >/dev/null 2>&1 &
sleep 1
claimed=$(psql_ -c "select id from public.queue_entries where clinic_id = '0a000000-0000-4000-8000-000000000000' and status = 'waiting' order by token_number for update skip locked limit 1;")
wait
check "C3 SKIP LOCKED claim passes over the row being skipped" "$claimed" "e0000000-0000-4000-8000-000000000002"

exit $fail
