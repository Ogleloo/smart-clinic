#!/usr/bin/env bash
# Disposable-database security tests for skip_patient().
#
# Starts a throwaway postgres:16 container (no network access to Supabase,
# nothing shared), builds a minimal Supabase-shaped schema, then:
#   1. BASELINE: applies the currently deployed definition
#      (20260809125334_skip_patient_closes_consultation.sql) and runs the
#      cases — failures here demonstrate the defects being fixed.
#   2. FIX: applies 20261010120000_skip_patient_clinic_isolation.sql
#      verbatim and runs the same cases — every case must pass.
# The container is removed afterwards. Requires Docker.
#
# Usage (from repo root):  bash supabase/tests/skip_patient_authorization/run.sh
set -u
cd "$(dirname "$0")/../.."   # -> supabase/
C=skip-patient-authz-test
export MSYS_NO_PATHCONV=1
HOSTDIR="$(pwd -W 2>/dev/null || pwd)"

docker rm -f "$C" >/dev/null 2>&1
docker run -d --rm --name "$C" -e POSTGRES_PASSWORD=test -v "$HOSTDIR:/work:ro" postgres:16 >/dev/null || exit 1
trap 'docker rm -f "$C" >/dev/null 2>&1' EXIT
until docker exec "$C" pg_isready -U postgres -q 2>/dev/null; do sleep 1; done
sleep 1

psql_() { docker exec -i "$C" psql -U postgres -d postgres -v ON_ERROR_STOP=0 -q "$@"; }
T=/work/tests/skip_patient_authorization

phase() {  # $1 = label, $2 = migration file, $3 = check_messages on/off
  echo
  echo "================ $1 ================"
  psql_ -c "drop schema if exists test cascade; drop schema if exists public cascade; drop schema if exists auth cascade; create schema public; drop role if exists anon; drop role if exists authenticated; drop role if exists service_role;" >/dev/null 2>&1
  psql_ -v ON_ERROR_STOP=1 -f "$T/schema.sql" >/dev/null || { echo "schema failed"; return 1; }
  psql_ -v ON_ERROR_STOP=1 -f "/work/migrations/$2" >/dev/null || { echo "migration failed"; return 1; }
  # The baseline file never re-stated grants (they live in nurse_flow); mirror them.
  psql_ -c "revoke execute on function public.skip_patient(uuid,boolean) from public, anon; grant execute on function public.skip_patient(uuid,boolean) to authenticated;" >/dev/null
  psql_ -v ON_ERROR_STOP=1 -f "$T/fixtures.sql" >/dev/null || { echo "fixtures failed"; return 1; }
  PGOPTIONS="-c test.check_messages=$3" docker exec -i -e PGOPTIONS="-c test.check_messages=$3" "$C" \
    psql -U postgres -d postgres -q -f "$T/cases.sql" 2>&1 | grep -E "PASS|FAIL" | sed -E 's/^(psql:[^ ]+ )?(NOTICE|ERROR): +//'
  bash tests/skip_patient_authorization/concurrency.sh "$C" 2>&1 | sed 's#^#  #' | sed 's#^  PASS#PASS#; s#^  FAIL#FAIL#'
}

phase "BASELINE (currently deployed skip_patient)" 20260809125334_skip_patient_closes_consultation.sql off | tee /tmp/skip_baseline.txt
phase "FIX (20261010120000_skip_patient_clinic_isolation)" 20261010120000_skip_patient_clinic_isolation.sql on | tee /tmp/skip_fix.txt

echo
echo "Baseline: $(grep -c '^PASS' /tmp/skip_baseline.txt) pass / $(grep -c '^FAIL' /tmp/skip_baseline.txt) fail"
echo "Fix:      $(grep -c '^PASS' /tmp/skip_fix.txt) pass / $(grep -c '^FAIL' /tmp/skip_fix.txt) fail"
grep -q '^FAIL' /tmp/skip_fix.txt && exit 1 || exit 0
