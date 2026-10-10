#!/usr/bin/env bash
# Disposable-database security tests for skip_patient().
#
# Starts a throwaway postgres:16 container (no connection to Supabase,
# nothing shared), builds a minimal Supabase-shaped schema, then:
#   1. BASELINE: applies the previously deployed definition
#      (20260809125334_skip_patient_closes_consultation.sql). Assertion
#      failures are EXPECTED here — they demonstrate the defects being fixed —
#      and at least one is required, proving the cases can detect them.
#   2. FIX: applies 20261010003117_skip_patient_clinic_isolation.sql verbatim.
#      Every case and every concurrency check must pass.
#
# Exit codes:  0 = fix passes everything, harness healthy
#              1 = fix failed at least one assertion
#              2 = harness/setup error (unexpected SQL error, missing or extra
#                  assertions, failed setup step, container failure, ...)
# Any outcome other than a fully verified pass is non-zero.
#
# Overrides (paths relative to supabase/), used for negative-control runs:
#   FIX_MIGRATION=<file in migrations/>   CASES_FILE=<path>
#
# Usage (from repo root):  bash supabase/tests/skip_patient_authorization/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."   # -> supabase/
export MSYS_NO_PATHCONV=1

C=skip-patient-authz-test
T=tests/skip_patient_authorization
BASELINE_MIGRATION=20260809125334_skip_patient_closes_consultation.sql
FIX_MIGRATION="${FIX_MIGRATION:-20261010003117_skip_patient_clinic_isolation.sql}"
CASES_FILE="${CASES_FILE:-$T/cases.sql}"
HOSTDIR="$(pwd -W 2>/dev/null || pwd)"
OUT="$(mktemp -d)"

die() { echo "HARNESS ERROR: $*" >&2; exit 2; }

for f in "migrations/$BASELINE_MIGRATION" "migrations/$FIX_MIGRATION" "$CASES_FILE" \
         "$T/schema.sql" "$T/fixtures.sql" "$T/concurrency.sh"; do
  [ -f "$f" ] || die "missing file: supabase/$f"
done

# Every case is exactly one line starting with `select test.expect_...(`,
# optionally wrapped as `begin; ... rollback;`. This is the number of
# PASS/FAIL results each phase must produce — no more, no fewer.
EXPECTED_CASES=$(grep -cE '^(begin; )?select test\.expect_(reject|ok)\(' "$CASES_FILE" || true)
[ "$EXPECTED_CASES" -gt 0 ] || die "no cases found in $CASES_FILE"

docker rm -f "$C" >/dev/null 2>&1 || true
docker run -d --rm --name "$C" -e POSTGRES_PASSWORD=test -v "$HOSTDIR:/work:ro" postgres:16 >/dev/null \
  || die "could not start postgres:16 container"
trap 'docker rm -f "$C" >/dev/null 2>&1 || true; rm -rf "$OUT"' EXIT

ready=0
for _ in $(seq 1 60); do
  if docker exec "$C" pg_isready -U postgres -q 2>/dev/null \
     && docker exec "$C" psql -X -U postgres -d postgres -qtAc 'select 1' >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
[ "$ready" = 1 ] || die "postgres did not become ready within 60s"

psql_strict() { docker exec -i "$C" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@"; }

# phase <label> <migration file> <mode: baseline|fix>
# Sets PHASE_PASS / PHASE_FAIL / PHASE_CONC_RC; dies on any harness problem.
phase() {
  local label=$1 migration=$2 mode=$3 log="$OUT/$3.cases.log" rc
  echo
  echo "================ $label ================"

  psql_strict -c "set client_min_messages = warning;
                  drop schema if exists test cascade; drop schema if exists auth cascade;
                  drop schema if exists public cascade; create schema public;
                  drop role if exists anon; drop role if exists authenticated; drop role if exists service_role;" >/dev/null \
    || die "[$mode] database reset failed"
  psql_strict -f "/work/$T/schema.sql" >/dev/null       || die "[$mode] schema.sql failed"
  psql_strict -f "/work/migrations/$migration" >/dev/null || die "[$mode] migration $migration failed"
  # The baseline file never re-stated grants (they live in nurse_flow); mirror them for both phases.
  psql_strict -c "revoke execute on function public.skip_patient(uuid,boolean) from public, anon;
                  grant execute on function public.skip_patient(uuid,boolean) to authenticated;" >/dev/null \
    || die "[$mode] grants failed"
  psql_strict -f "/work/$T/fixtures.sql" >/dev/null     || die "[$mode] fixtures.sql failed"

  # Guard against testing the wrong function body.
  local marker
  if [ "$mode" = fix ]; then marker='for update of q'; else marker='public.auth_role() not in'; fi
  psql_strict -tAc "select position('$marker' in pg_get_functiondef('public.skip_patient(uuid,boolean)'::regprocedure)) > 0" \
    | grep -qx t || die "[$mode] installed skip_patient() is not the expected definition (marker '$marker' missing)"

  # Cases run with ON_ERROR_STOP=0 so one failing case doesn't hide the rest.
  # Baseline relaxes message matching (only "was it rejected?" matters there).
  local msgs=on; [ "$mode" = baseline ] && msgs=off
  set +e
  docker exec -i -e PGOPTIONS="-c test.check_messages=$msgs" "$C" \
    psql -X -U postgres -d postgres -v ON_ERROR_STOP=0 -q -f "/work/$CASES_FILE" >"$log" 2>&1
  rc=$?
  set -e
  [ "$rc" -eq 0 ] || { cat "$log"; die "[$mode] psql exited $rc while running cases"; }

  PHASE_PASS=$(grep -cE 'NOTICE:  PASS \[' "$log" || true)
  PHASE_FAIL=$(grep -cE 'ERROR:  FAIL \[' "$log" || true)
  local errors warnings
  errors=$(grep -cE '(ERROR|FATAL|PANIC):' "$log" || true)
  warnings=$(grep -cE 'WARNING:' "$log" || true)

  { grep -E 'NOTICE:  PASS \[|ERROR:  FAIL \[' "$log" || true; } | sed -E 's/^psql:[^ ]+ (NOTICE|ERROR): +//'

  if [ "$errors" -ne "$PHASE_FAIL" ] || [ "$warnings" -ne 0 ]; then
    echo "---- unexpected output ----" >&2
    grep -E '(ERROR|FATAL|PANIC|WARNING):' "$log" | grep -vE 'ERROR:  FAIL \[' >&2 || true
    die "[$mode] $((errors - PHASE_FAIL)) unexpected SQL error(s), $warnings warning(s) — not an assertion result"
  fi
  [ $((PHASE_PASS + PHASE_FAIL)) -eq "$EXPECTED_CASES" ] \
    || die "[$mode] got $PHASE_PASS pass + $PHASE_FAIL fail = $((PHASE_PASS + PHASE_FAIL)) results, expected exactly $EXPECTED_CASES"

  set +e
  bash "$T/concurrency.sh" "$C" "$mode" >"$OUT/$mode.conc.log" 2>&1
  PHASE_CONC_RC=$?
  set -e
  cat "$OUT/$mode.conc.log"
  [ "$PHASE_CONC_RC" -le 1 ] || die "[$mode] concurrency harness error (exit $PHASE_CONC_RC)"

  PHASE_CONC_PASS=$(grep -c '^PASS' "$OUT/$mode.conc.log" || true)
  PHASE_CONC_FAIL=$(grep -c '^FAIL' "$OUT/$mode.conc.log" || true)
  if [ "$PHASE_CONC_RC" -eq 0 ] && [ "$PHASE_CONC_FAIL" -ne 0 ]; then die "[$mode] concurrency exit 0 but FAIL lines present"; fi
  if [ "$PHASE_CONC_RC" -eq 1 ] && [ "$PHASE_CONC_FAIL" -eq 0 ]; then die "[$mode] concurrency exit 1 but no FAIL lines"; fi
}

phase "BASELINE (previously deployed skip_patient)" "$BASELINE_MIGRATION" baseline
B_PASS=$PHASE_PASS; B_FAIL=$PHASE_FAIL; B_CPASS=$PHASE_CONC_PASS; B_CFAIL=$PHASE_CONC_FAIL

phase "FIX ($FIX_MIGRATION)" "$FIX_MIGRATION" fix
F_PASS=$PHASE_PASS; F_FAIL=$PHASE_FAIL; F_CPASS=$PHASE_CONC_PASS; F_CFAIL=$PHASE_CONC_FAIL; F_CRC=$PHASE_CONC_RC

echo
echo "Expected cases per phase: $EXPECTED_CASES"
echo "Baseline: cases $B_PASS pass / $B_FAIL fail; concurrency $B_CPASS pass / $B_CFAIL fail"
echo "Fix:      cases $F_PASS pass / $F_FAIL fail; concurrency $F_CPASS pass / $F_CFAIL fail"

[ $((B_FAIL + B_CFAIL)) -gt 0 ] \
  || die "baseline passed everything — the cases do not detect the defects they claim to"

if [ "$F_FAIL" -eq 0 ] && [ "$F_PASS" -eq "$EXPECTED_CASES" ] && [ "$F_CRC" -eq 0 ] && [ "$F_CPASS" -gt 0 ]; then
  echo "RESULT: PASS"
  exit 0
fi
echo "RESULT: FAIL"
exit 1
