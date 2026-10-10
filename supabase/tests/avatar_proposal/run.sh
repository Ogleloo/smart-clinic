#!/usr/bin/env bash
# Disposable-database tests for the PROPOSED avatar SQL (docs/proposals/avatar_storage.sql).
# Starts a throwaway postgres:16 container (nothing shared, no Supabase connection), builds a
# Supabase-shaped stub, applies the proposal VERBATIM, and runs cases.sql.
# Fails closed: exit 0 only if setup succeeds, every expected case PASSes and nothing else errors.
# Usage (from repo root):  bash supabase/tests/avatar_proposal/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."   # -> supabase/
export MSYS_NO_PATHCONV=1
C=avatar-proposal-test
HOSTDIR="$(cd .. && (pwd -W 2>/dev/null || pwd))"   # repo root, so docs/ is reachable too
T=supabase/tests/avatar_proposal
die() { echo "HARNESS ERROR: $*" >&2; exit 2; }

# Exact case count, declared rather than regex-derived (helper bodies also contain PASS lines).
# 7 DO-block cases + 4 expect_denied calls + 9 expect_check calls. Update when adding a case.
EXPECTED=20
CALLS=$(grep -cE "^(begin; )?select test\.expect_(denied|check)\(" tests/avatar_proposal/cases.sql)
[ "$CALLS" -eq 13 ] || die "cases.sql has $CALLS helper calls, expected 13 — update EXPECTED"

docker rm -f "$C" >/dev/null 2>&1 || true
docker run -d --rm --name "$C" -e POSTGRES_PASSWORD=test -v "$HOSTDIR:/work:ro" postgres:16 >/dev/null || die "could not start postgres"
trap 'docker rm -f "$C" >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 60); do docker exec "$C" psql -U postgres -qtAc 'select 1' >/dev/null 2>&1 && break; sleep 1; done
psql_strict() { docker exec -i "$C" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@"; }

psql_strict -f "/work/$T/schema.sql" >/dev/null || die "schema stub failed"
PROPOSAL_SQL="${PROPOSAL_SQL:-docs/proposals/avatar_storage.sql}"   # override only for negative controls
psql_strict -f "/work/$PROPOSAL_SQL" >/dev/null || die "PROPOSED SQL failed to apply"

set +e
docker exec -i "$C" psql -X -U postgres -d postgres -v ON_ERROR_STOP=0 -q -f "/work/$T/cases.sql" >/tmp/avatar_cases.log 2>&1
rc=$?
set -e
[ "$rc" -eq 0 ] || { cat /tmp/avatar_cases.log; die "psql exited $rc"; }

PASS=$(grep -cE 'NOTICE:  PASS \[' /tmp/avatar_cases.log || true)
FAIL=$(grep -cE 'ERROR:  FAIL \[' /tmp/avatar_cases.log || true)
ERRORS=$(grep -cE '(ERROR|FATAL|PANIC):' /tmp/avatar_cases.log || true)
{ grep -E 'NOTICE:  PASS \[|ERROR:  FAIL \[' /tmp/avatar_cases.log || true; } | sed -E 's/^psql:[^ ]+ (NOTICE|ERROR): +//'
[ "$ERRORS" -eq "$FAIL" ] || { grep -E '(ERROR|FATAL|PANIC):' /tmp/avatar_cases.log | grep -v 'FAIL \[' >&2; die "unexpected SQL errors"; }
echo "Expected $EXPECTED, passed $PASS, failed $FAIL"
[ "$PASS" -eq "$EXPECTED" ] && [ "$FAIL" -eq 0 ] && { echo "RESULT: PASS"; exit 0; }
echo "RESULT: FAIL"; exit 1
