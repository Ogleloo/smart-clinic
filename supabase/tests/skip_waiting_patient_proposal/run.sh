#!/usr/bin/env bash
# Disposable-database tests for the PROPOSED skip_waiting_patient() (docs/proposals/skip_waiting_patient.sql).
#
# Starts a throwaway postgres:16 container (no connection to Supabase, nothing shared), builds the same minimal
# Supabase-shaped schema as supabase/tests/skip_patient_authorization, installs the deployed skip_patient()
# (20261010003117) so the negative control can use it, then the proposed function, then runs:
#   cases.sql       — authorization, clinic isolation, expected-status, grants
#   concurrency.sh  — two-session races against next_patient()'s claim, incl. a control that reproduces the
#                     check-then-skip defect
#
# Exit: 0 = everything passed; 1 = an assertion failed; 2 = harness/setup error.
# Usage (from repo root):  bash supabase/tests/skip_waiting_patient_proposal/run.sh
set -euo pipefail
cd "$(dirname "$0")/../../.."   # -> repo root
export MSYS_NO_PATHCONV=1

C=skip-waiting-patient-proposal-test
HOSTDIR="$(pwd -W 2>/dev/null || pwd)"
OUT="$(mktemp -d)"
die() { echo "HARNESS ERROR: $*" >&2; exit 2; }

SCHEMA=supabase/tests/skip_patient_authorization/schema.sql
FIXTURES=supabase/tests/skip_patient_authorization/fixtures.sql
SKIP_PATIENT=supabase/migrations/20261010003117_skip_patient_clinic_isolation.sql
PROPOSAL="${PROPOSAL:-docs/proposals/skip_waiting_patient.sql}"  # override for negative-control runs
CASES=supabase/tests/skip_waiting_patient_proposal/cases.sql
for f in "$SCHEMA" "$FIXTURES" "$SKIP_PATIENT" "$PROPOSAL" "$CASES"; do [ -f "$f" ] || die "missing $f"; done

EXPECTED_CASES=$(grep -cE '^(begin; .*)?select test\.expect_' "$CASES" || true)
[ "$EXPECTED_CASES" -gt 0 ] || die "no cases found"

docker rm -f "$C" >/dev/null 2>&1 || true
docker run -d --rm --name "$C" -e POSTGRES_PASSWORD=test -v "$HOSTDIR:/work:ro" postgres:16 >/dev/null || die "could not start postgres:16"
trap 'docker rm -f "$C" >/dev/null 2>&1 || true; rm -rf "$OUT"' EXIT
for _ in $(seq 1 60); do
  docker exec "$C" psql -X -U postgres -d postgres -qtAc 'select 1' >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$C" psql -X -U postgres -d postgres -qtAc 'select 1' >/dev/null 2>&1 || die "postgres not ready"

psql_strict() { docker exec -i "$C" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@"; }
psql_strict -f "/work/$SCHEMA" >/dev/null || die "schema failed"
psql_strict -f "/work/$SKIP_PATIENT" >/dev/null || die "skip_patient migration failed"
psql_strict -c "revoke execute on function public.skip_patient(uuid,boolean) from public, anon;
                grant execute on function public.skip_patient(uuid,boolean) to authenticated;" >/dev/null || die "grants failed"
psql_strict -f "/work/$PROPOSAL" >/dev/null || die "proposal SQL failed"
psql_strict -f "/work/$FIXTURES" >/dev/null || die "fixtures failed"

set +e
docker exec -i "$C" psql -X -U postgres -d postgres -v ON_ERROR_STOP=0 -q -f "/work/$CASES" >"$OUT/cases.log" 2>&1
set -e
PASS=$(grep -cE 'NOTICE:  PASS \[' "$OUT/cases.log" || true)
FAIL=$(grep -cE 'ERROR:  FAIL \[' "$OUT/cases.log" || true)
ERRORS=$(grep -cE '(ERROR|FATAL|PANIC):' "$OUT/cases.log" || true)
grep -E 'NOTICE:  PASS \[|ERROR:  FAIL \[' "$OUT/cases.log" | sed -E 's/^psql:[^ ]+ (NOTICE|ERROR): +//'
[ "$ERRORS" -eq "$FAIL" ] || { grep -E '(ERROR|FATAL|PANIC):' "$OUT/cases.log" >&2; die "$((ERRORS - FAIL)) unexpected SQL error(s)"; }
[ $((PASS + FAIL)) -eq "$EXPECTED_CASES" ] || die "got $PASS+$FAIL results, expected $EXPECTED_CASES"

set +e
bash supabase/tests/skip_waiting_patient_proposal/concurrency.sh "$C" >"$OUT/conc.log" 2>&1
CRC=$?
set -e
cat "$OUT/conc.log"
[ "$CRC" -le 1 ] || die "concurrency harness error"
CPASS=$(grep -c '^PASS' "$OUT/conc.log" || true)
CFAIL=$(grep -c '^FAIL' "$OUT/conc.log" || true)

echo
echo "Cases: $PASS pass / $FAIL fail (expected $EXPECTED_CASES); concurrency: $CPASS pass / $CFAIL fail"
if [ "$FAIL" -eq 0 ] && [ "$CRC" -eq 0 ] && [ "$CPASS" -gt 0 ]; then echo "RESULT: PASS"; exit 0; fi
echo "RESULT: FAIL"; exit 1
