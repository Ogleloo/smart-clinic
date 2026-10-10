#!/usr/bin/env bash
# Concurrency scenarios for skip_patient(): two real Postgres sessions racing
# on the same row. Called by run.sh as:  concurrency.sh <container> <baseline|fix>
#
# Every scenario asserts, separately:
#   - the session that should win exits 0 and returned the expected row;
#   - the session that should lose exits non-zero WITH the expected error
#     text (a final-state check alone could pass for the wrong reason);
#   - the loser genuinely waited on the row lock (elapsed time), or for the
#     SKIP LOCKED case genuinely did NOT wait — so a pass proves the race
#     path was exercised, not that the sessions happened not to overlap;
#   - the final database state.
#
# Exit codes: 0 = all PASS, 1 = at least one FAIL, 2 = harness error.
set -uo pipefail
C="$1"
MODE="$2"
CT=/work/tests/skip_patient_authorization
HOLD_S=3          # how long the first session holds its lock
START_GAP_S=1     # second session starts this long after the first
MIN_BLOCK_MS=1500 # a contended call must have waited at least this long
MAX_FREE_MS=1000  # an uncontended (SKIP LOCKED) call must finish within this

fail=0
harness_error() { echo "HARNESS ERROR: $*"; exit 2; }
pass()  { echo "PASS [$1]"; }
failc() { echo "FAIL [$1]: $2"; fail=1; }
now_ms() { echo $(( $(date +%s%N) / 1000000 )); }

# ON_ERROR_STOP=1: a failing statement makes psql exit 3, which we capture.
psql_() { docker exec -i "$C" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -qtA "$@"; }

reload() {
  psql_ -c "truncate public.consultations, public.queue_entries, public.services, public.profiles, public.clinics cascade;" >/dev/null \
    || harness_error "truncate failed"
  psql_ -f "$CT/fixtures.sql" >/dev/null || harness_error "fixture reload failed"
}

REC_A=10000000-0000-4000-8000-000000000001
NURSE_A_PROFILE=20000000-0000-4000-8000-000000000003
SVC_A=5a000000-0000-4000-8000-000000000000
CLINIC_A=0a000000-0000-4000-8000-000000000000
E1=e0000000-0000-4000-8000-000000000001
E2=e0000000-0000-4000-8000-000000000002
E7=e0000000-0000-4000-8000-000000000007
E8=e0000000-0000-4000-8000-000000000008

# Receptionist A transaction wrapping arbitrary SQL.
as_rec_a() {
  printf "begin;\nset local role authenticated;\nselect set_config('request.jwt.claim.sub','%s',true) \\\\g /dev/null\n%s\ncommit;\n" "$REC_A" "$1"
}

expect_rejected() { # name rc output expected_text elapsed_ms
  local name=$1 rc=$2 out=$3 text=$4 ms=$5
  if [ "$rc" -eq 0 ]; then failc "$name" "call SUCCEEDED (exit 0, output '$out') but must be rejected"; return; fi
  case "$out" in
    *"$text"*) pass "$name: rejected with expected error (exit $rc)";;
    *) failc "$name" "rejected (exit $rc) but with unexpected error: '$out' (expected text '$text')";;
  esac
  if [ "$ms" -ge "$MIN_BLOCK_MS" ]; then pass "$name: waited ${ms}ms on the row lock"
  else failc "$name" "returned after ${ms}ms — did not wait on the lock, race not exercised"; fi
}

# ---------------------------------------------------------------------------
# C1: a nurse calls the patient (next_patient-style: lock row, set
# in_progress, open consultation) while reception tries to skip the same
# patient. Reception must wait for the lock, then see in_progress and be
# refused; the patient stays in consultation with the consultation open.
reload
(
  psql_ <<SQL
begin;
select 1 from public.queue_entries where id = '$E7' for update;
update public.queue_entries set status = 'in_progress', called_at = now() where id = '$E7';
insert into public.consultations (queue_entry_id, nurse_id, service_id) values ('$E7', '$NURSE_A_PROFILE', '$SVC_A');
select pg_sleep($HOLD_S);
commit;
SQL
) >/tmp/c1a.out 2>&1 &
pid_a=$!
sleep "$START_GAP_S"
t0=$(now_ms)
out_b=$(as_rec_a "select status from public.skip_patient('$E7');" | psql_ 2>&1 | tr '\n' ' ')
rc_b=$?
ms_b=$(( $(now_ms) - t0 ))
wait "$pid_a"; rc_a=$?
[ "$rc_a" -eq 0 ] || harness_error "C1 nurse-call session failed (exit $rc_a): $(tr '\n' ' ' </tmp/c1a.out)"

if [ "$MODE" = fix ]; then c1_text="already in consultation"; else c1_text="That patient is not in an active state"; fi
expect_rejected "C1 reception skip while nurse calls patient" "$rc_b" "$out_b" "$c1_text" "$ms_b"
final=$(psql_ -c "select q.status || '/' || (c.ended_at is null) || '/' || c.exclude_from_prediction || '/' || (select count(*) from public.consultations where queue_entry_id = '$E7')
                    from public.queue_entries q join public.consultations c on c.queue_entry_id = q.id where q.id = '$E7';") \
  || harness_error "C1 final-state query failed"
if [ "$final" = "in_progress/true/false/1" ]; then pass "C1 final state: in_progress, one consultation, still open, not excluded"
else failc "C1 final state" "got '$final', expected 'in_progress/true/false/1' (status/consultation-open/excluded/count)"; fi

# ---------------------------------------------------------------------------
# C2: two receptionists skip the same waiting patient at once. The first
# succeeds; the second waits on the lock and is refused; the first skip's
# result is not overwritten.
reload
(
  as_rec_a "select status from public.skip_patient('$E8');
select pg_sleep($HOLD_S) \\g /dev/null" | psql_
) >/tmp/c2a.out 2>&1 &
pid_a=$!
sleep "$START_GAP_S"
t0=$(now_ms)
out_b=$(as_rec_a "select status from public.skip_patient('$E8');" | psql_ 2>&1 | tr '\n' ' ')
rc_b=$?
ms_b=$(( $(now_ms) - t0 ))
wait "$pid_a"; rc_a=$?
out_a=$(tr '\n' ' ' </tmp/c2a.out)

if [ "$rc_a" -eq 0 ] && [ "$(echo "$out_a" | tr -d ' ')" = "skipped" ]; then pass "C2 first skip succeeded (exit 0, returned 'skipped')"
else failc "C2 first skip" "exit $rc_a, output '$out_a' — expected exit 0 returning 'skipped'"; fi
if [ "$MODE" = fix ]; then c2_text="That patient is no longer waiting"; else c2_text="That patient is not in an active state"; fi
expect_rejected "C2 concurrent second skip" "$rc_b" "$out_b" "$c2_text" "$ms_b"
final=$(psql_ -c "select status || '/' || (completed_at is not null) from public.queue_entries where id = '$E8';") \
  || harness_error "C2 final-state query failed"
if [ "$final" = "skipped/true" ]; then pass "C2 final state: skipped with completed_at set"
else failc "C2 final state" "got '$final', expected 'skipped/true'"; fi

# ---------------------------------------------------------------------------
# C3: while reception holds the lock on the head-of-queue patient, a
# next_patient-style claim (FOR UPDATE SKIP LOCKED) passes over it to the
# next waiting patient immediately, instead of blocking or double-claiming.
reload
(
  as_rec_a "select status from public.skip_patient('$E1');
select pg_sleep($HOLD_S) \\g /dev/null" | psql_
) >/tmp/c3a.out 2>&1 &
pid_a=$!
sleep "$START_GAP_S"
t0=$(now_ms)
claimed=$(psql_ -c "select id from public.queue_entries where clinic_id = '$CLINIC_A' and status = 'waiting' order by token_number for update skip locked limit 1;" 2>&1)
rc_b=$?
ms_b=$(( $(now_ms) - t0 ))
wait "$pid_a"; rc_a=$?
out_a=$(tr '\n' ' ' </tmp/c3a.out)

[ "$rc_b" -eq 0 ] || harness_error "C3 SKIP LOCKED claim query failed (exit $rc_b): $claimed"
if [ "$rc_a" -eq 0 ] && [ "$(echo "$out_a" | tr -d ' ')" = "skipped" ]; then pass "C3 reception skip succeeded while holding the lock"
else failc "C3 reception skip" "exit $rc_a, output '$out_a' — expected exit 0 returning 'skipped'"; fi
if [ "$claimed" = "$E2" ]; then pass "C3 SKIP LOCKED claim took the NEXT waiting patient"
else failc "C3 SKIP LOCKED claim" "claimed '$claimed', expected '$E2'"; fi
if [ "$ms_b" -lt "$MAX_FREE_MS" ]; then pass "C3 claim did not block (${ms_b}ms)"
else failc "C3 claim" "took ${ms_b}ms — blocked behind the skip instead of skipping the locked row"; fi
final=$(psql_ -c "select string_agg(status::text, ',' order by token_number) from public.queue_entries where id in ('$E1','$E2');") \
  || harness_error "C3 final-state query failed"
if [ "$final" = "skipped,waiting" ]; then pass "C3 final state: head skipped, next still waiting"
else failc "C3 final state" "got '$final', expected 'skipped,waiting'"; fi

exit $fail
