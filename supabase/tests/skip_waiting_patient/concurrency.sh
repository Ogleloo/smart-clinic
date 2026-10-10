#!/usr/bin/env bash
# Two real Postgres sessions racing on the same queue entry, for skip_waiting_patient().
# Called by run.sh as:  concurrency.sh <container>
#
# The "caller" session reproduces next_patient()'s own claim exactly (as deployed, read 2026-10-10):
#   select ... from queue_entries where service_id = <svc> and queue_date = current_date and status = 'waiting'
#   order by priority desc, checked_in_at asc, token_number asc for no key update skip locked limit 1;
#   (FOR UPDATE before 20261011010000_next_patient_no_key_update; the minimal schema has no notifications, so
#   both behave the same here — the KEY SHARE interaction is covered by supabase/tests/next_patient_lock.)
#   update queue_entries set status = 'in_progress', called_at = ...;  insert into consultations ...;
# (next_patient's other work — nurse_actions ledger, previous consultation, stats — does not touch the row.)
#
# Each scenario asserts the winner's result, the loser's exact error, that a contended loser really WAITED on
# the row lock (or, for SKIP LOCKED, really did NOT wait), and the final state.
# Exit codes: 0 = all PASS, 1 = at least one FAIL, 2 = harness error.
set -uo pipefail
C="$1"
HOLD_S=6
START_GAP_S=1
MIN_BLOCK_MS=3500
MAX_FREE_MS=2500  # a blocked call would take >= HOLD_S - START_GAP_S = 5000ms; docker exec alone costs 0.3-0.9s

fail=0
harness_error() { echo "HARNESS ERROR: $*"; exit 2; }
pass()  { echo "PASS [$1]"; }
failc() { echo "FAIL [$1]: $2"; fail=1; }
now_ms() { echo $(( $(date +%s%N) / 1000000 )); }
psql_() { docker exec -i "$C" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -qtA "$@"; }

FIX=/work/supabase/tests/skip_patient_authorization/fixtures.sql
reload() {
  psql_ -c "truncate public.consultations, public.queue_entries, public.services, public.profiles, public.clinics cascade;" >/dev/null \
    || harness_error "truncate failed"
  psql_ -f "$FIX" >/dev/null || harness_error "fixture reload failed"
}

NURSE_A=10000000-0000-4000-8000-000000000003
NURSE_A_PROFILE=20000000-0000-4000-8000-000000000003
SVC_A=5a000000-0000-4000-8000-000000000000
E1=e0000000-0000-4000-8000-000000000001
E2=e0000000-0000-4000-8000-000000000002

as_nurse_a() { # wrap SQL in a transaction run as nurse A through the authenticated role
  printf "begin;\nset local role authenticated;\nselect set_config('request.jwt.claim.sub','%s',true) \\\\g /dev/null\n%s\ncommit;\n" "$NURSE_A" "$1"
}

# next_patient()'s claim + transition, then hold the transaction open, then commit or roll back.
claim_sql() { # $1 = commit|rollback
  cat <<SQL
begin;
with picked as (
  select q.id from public.queue_entries q
   where q.service_id = '$SVC_A' and q.queue_date = current_date and q.status = 'waiting'
   order by q.priority desc, q.checked_in_at asc, q.token_number asc
   for no key update skip locked limit 1  -- as next_patient() claims since 20261011010000
)
update public.queue_entries q set status = 'in_progress', called_at = clock_timestamp()
  from picked where q.id = picked.id returning q.id \\gset
insert into public.consultations (queue_entry_id, nurse_id, service_id, started_at)
values (:'id', '$NURSE_A_PROFILE', '$SVC_A', clock_timestamp());
select :'id';
select pg_sleep($HOLD_S) \\g /dev/null
$1;
SQL
}

state() { psql_ -c "select status from public.queue_entries where id = '$1'"; }
open_cons() { psql_ -c "select count(*) from public.consultations where queue_entry_id = '$1' and ended_at is null"; }

# ---------------------------------------------------------------------------
# C1: next_patient() claims the head of the queue (E1) and holds the lock; the skip arrives while it is still
# running. The skip must wait, then see in_progress and refuse. The consultation stays open.
reload
claim_sql commit | psql_ >/tmp/c1a.out 2>&1 &
pid_a=$!
sleep "$START_GAP_S"
t0=$(now_ms)
out_b=$(as_nurse_a "select status from public.skip_waiting_patient('$E1');" | psql_ 2>&1); rc_b=$?
ms=$(( $(now_ms) - t0 ))
wait $pid_a; rc_a=$?
[ "$rc_a" -eq 0 ] && grep -q "$E1" /tmp/c1a.out || harness_error "C1 caller did not claim E1: $(cat /tmp/c1a.out)"
if [ "$rc_b" -ne 0 ] && [[ "$out_b" == *"already in consultation"* ]]; then pass "C1 skip during next_patient: refused with 'already in consultation'"
else failc "C1" "skip exit $rc_b output '$out_b' (expected refusal)"; fi
[ "$ms" -ge "$MIN_BLOCK_MS" ] && pass "C1 skip waited ${ms}ms on the row lock" || failc "C1" "skip returned after ${ms}ms — race not exercised"
[ "$(state $E1)" = in_progress ] && [ "$(open_cons $E1)" = 1 ] && pass "C1 final: E1 in_progress, consultation open" \
  || failc "C1" "final state $(state $E1), open consultations $(open_cons $E1)"

# ---------------------------------------------------------------------------
# C2: the skip locks E1 first and holds; next_patient() runs meanwhile. SKIP LOCKED makes it pass over E1
# immediately and call E2. Final: E1 skipped (no consultation), E2 in consultation.
reload
as_nurse_a "select status from public.skip_waiting_patient('$E1'); select pg_sleep($HOLD_S) \\g /dev/null" | psql_ >/tmp/c2b.out 2>&1 &
pid_b=$!
sleep "$START_GAP_S"
t0=$(now_ms)
sed "s/select pg_sleep($HOLD_S) \\\\g \/dev\/null//" <(claim_sql commit) | psql_ >/tmp/c2a.out 2>&1; rc_a=$?
ms=$(( $(now_ms) - t0 ))
wait $pid_b; rc_b=$?
[ "$rc_b" -eq 0 ] && grep -q skipped /tmp/c2b.out || failc "C2" "skip did not succeed: $(cat /tmp/c2b.out)"
if [ "$rc_a" -eq 0 ] && grep -q "$E2" /tmp/c2a.out; then pass "C2 next_patient passed over the locked E1 and called E2"
else failc "C2" "caller exit $rc_a output $(cat /tmp/c2a.out)"; fi
[ "$ms" -le "$MAX_FREE_MS" ] && pass "C2 next_patient did not wait (${ms}ms)" || failc "C2" "next_patient waited ${ms}ms"
[ "$(state $E1)" = skipped ] && [ "$(open_cons $E1)" = 0 ] && [ "$(state $E2)" = in_progress ] && pass "C2 final: E1 skipped, E2 in_progress" \
  || failc "C2" "final E1 $(state $E1) E2 $(state $E2)"

# ---------------------------------------------------------------------------
# C3: next_patient() claims E1 but its transaction rolls back. The waiting skip then sees 'waiting' and succeeds.
reload
claim_sql rollback | psql_ >/tmp/c3a.out 2>&1 &
pid_a=$!
sleep "$START_GAP_S"
t0=$(now_ms)
out_b=$(as_nurse_a "select status from public.skip_waiting_patient('$E1');" | psql_ 2>&1); rc_b=$?
ms=$(( $(now_ms) - t0 ))
wait $pid_a
[ "$rc_b" -eq 0 ] && [[ "$out_b" == *skipped* ]] && pass "C3 after a rolled-back call the skip succeeds" || failc "C3" "skip exit $rc_b output '$out_b'"
[ "$ms" -ge "$MIN_BLOCK_MS" ] && pass "C3 skip waited ${ms}ms on the row lock" || failc "C3" "skip returned after ${ms}ms"
[ "$(state $E1)" = skipped ] && [ "$(open_cons $E1)" = 0 ] && pass "C3 final: E1 skipped, no consultation" || failc "C3" "final $(state $E1)"

# ---------------------------------------------------------------------------
# C4: two skips of the same patient. The second waits, then refuses ("no longer waiting").
reload
as_nurse_a "select status from public.skip_waiting_patient('$E1'); select pg_sleep($HOLD_S) \\g /dev/null" | psql_ >/tmp/c4a.out 2>&1 &
pid_a=$!
sleep "$START_GAP_S"
t0=$(now_ms)
out_b=$(as_nurse_a "select status from public.skip_waiting_patient('$E1');" | psql_ 2>&1); rc_b=$?
ms=$(( $(now_ms) - t0 ))
wait $pid_a
[ "$rc_b" -ne 0 ] && [[ "$out_b" == *"no longer waiting"* ]] && pass "C4 second skip refused with 'no longer waiting'" || failc "C4" "second skip exit $rc_b output '$out_b'"
[ "$ms" -ge "$MIN_BLOCK_MS" ] && pass "C4 second skip waited ${ms}ms" || failc "C4" "second skip returned after ${ms}ms"

# ---------------------------------------------------------------------------
# C5 (negative control): the approach the proposal replaces — read the status, then call skip_patient() —
# in the losing interleaving: read says 'waiting', another nurse calls the patient, then skip_patient() runs.
# This MUST reproduce the defect (the just-opened consultation is closed), proving the harness can detect it.
# Then the same interleaving with skip_waiting_patient() must refuse and leave the consultation open.
reload
seen=$(state $E1)  # the "check" (the read's role is irrelevant to the race; the minimal schema models no RLS)
sed "s/select pg_sleep($HOLD_S) \\\\g \/dev\/null//" <(claim_sql commit) | psql_ >/dev/null 2>&1 || harness_error "C5 claim failed"
as_nurse_a "select status from public.skip_patient('$E1');" | psql_ >/tmp/c5.out 2>&1
if [ "$seen" = waiting ] && [ "$(state $E1)" = skipped ] && [ "$(open_cons $E1)" = 0 ]; then
  pass "C5 control: check-then-skip_patient() closed the consultation another nurse had just opened (defect reproduced)"
else failc "C5 control" "could not reproduce the defect (seen=$seen, final $(state $E1), open $(open_cons $E1))"; fi

reload
seen=$(state $E1)  # the "check" (the read's role is irrelevant to the race; the minimal schema models no RLS)
sed "s/select pg_sleep($HOLD_S) \\\\g \/dev\/null//" <(claim_sql commit) | psql_ >/dev/null 2>&1 || harness_error "C5b claim failed"
out_b=$(as_nurse_a "select status from public.skip_waiting_patient('$E1');" | psql_ 2>&1); rc_b=$?
if [ "$seen" = waiting ] && [ "$rc_b" -ne 0 ] && [[ "$out_b" == *"already in consultation"* ]] && [ "$(open_cons $E1)" = 1 ]; then
  pass "C5 same interleaving with skip_waiting_patient(): refused, consultation still open"
else failc "C5" "seen=$seen exit $rc_b output '$out_b' open $(open_cons $E1)"; fi

exit $fail
