# `skip_waiting_patient` — atomic "skip only if still waiting": migration readiness

**Status:** **APPLIED to production on 2026-10-10 (UTC)** as migration version `20261010231805` (`apply_migration`, name `skip_waiting_patient`) after approval; merged in #32 (`12e9d90`). The stored SQL sha256 `be0938810a03f54a…` equals this file. Post-deploy verification 16/16 and both health checks passed. The sections below are the pre-deployment readiness record. Not yet used by any UI: V3 Skip stays disabled, and the classic nurse Skip is unchanged.

| | |
|---|---|
| Migration | `supabase/migrations/20261010231805_skip_waiting_patient.sql` (additive; ends with `notify pgrst, 'reload schema'`) |
| Disposable-Postgres harness | `bash supabase/tests/skip_waiting_patient/run.sh` (24 cases + 13 two-session concurrency checks) |
| Real-stack end-to-end check | `supabase/tests/skip_waiting_patient/local_stack_check.mjs` (local `supabase start`: GoTrue, PostgREST, RLS, the real `next_patient()`) |
| Read-only post-deploy verification | `supabase/tests/skip_waiting_patient/post_deploy_verify.sql` (16 catalog checks) |

## 1. Why

A nurse's `skip_patient()` also accepts an `in_progress` entry and closes its consultation. So any "read the status, then call `skip_patient()`" approach races `next_patient()`: a call can land between the read and the skip, and the new consultation is then closed. The first Nurse V3 My Queue Skip did exactly this; it's now disabled fail-closed in PR #31. **The classic `/nurse` Skip has the same race, with a wider window** (no status check at all). It's unchanged and out of scope here (see §8).

Reception isn't affected: for receptionists, `skip_patient()` already requires `waiting` on the row it has locked.

## 2. What the function does

`skip_waiting_patient(p_queue_entry_id uuid) returns queue_entries`, `SECURITY DEFINER`, `search_path = public, pg_temp`:

1. **Active profile:** the profile for `auth.uid()` must exist and be `is_active`, otherwise `Not authorised` (42501).
2. **Staff role:** `nurse | receptionist | admin`. Patients are refused.
3. **Clinic:** the caller's `clinic_id` must not be null.
4. **Clinic isolation and lock:** `select … from queue_entries q join services s … where q.id = $1 and q.clinic_id = caller.clinic_id and s.clinic_id = caller.clinic_id for update of q`. "Missing" and "other clinic" both return `Queue entry not found` (P0002), so there's no existence oracle.
5. **Expected status, on the locked row:** `in_progress` → "already in consultation…"; anything else that isn't `waiting` → "no longer waiting" (55000).
6. **Defence in depth:** a waiting entry with an open consultation is refused, never closed.
7. **Transition:** `status = 'skipped', completed_at = now()`. **It never writes to `consultations`.**

Grants: `revoke all … from public, anon; grant execute … to authenticated`. Production also has the event trigger `trg_revoke_anon_on_new_functions`, which auto-revokes anon/PUBLIC on new functions; the explicit revoke doesn't rely on it.

**Why a new function instead of a parameter on `skip_patient()`:** `CREATE OR REPLACE` with a new parameter creates a second overload, and PostgREST calls with defaulted arguments can become ambiguous. A separate function leaves every existing caller (Reception, classic nurse Skip) byte-for-byte unchanged. Post-deploy verification asserts `skip_patient`'s definition hash is unchanged.

## 3. Concurrency

`next_patient()` claims with `… where status = 'waiting' order by priority desc, checked_in_at, token_number for update skip locked limit 1`.

| Interleaving | Result | Evidence |
|---|---|---|
| `next_patient` claims the patient first, transaction still open | The skip waits on the row lock, then sees `in_progress` and refuses. The consultation stays open. | Harness C1 (waited ≥3.5 s); **real stack K1: the real `next_patient()` vs an HTTP skip, which waited 5.1 s and was refused** |
| Skip locks first | `next_patient` passes over the row immediately and calls someone else | Harness C2; real stack K2 (35 ms, over HTTP) |
| `next_patient` claims, then rolls back | The skip waits, sees `waiting`, succeeds | Harness C3 |
| Two skips of one patient | The second waits, then "no longer waiting" | Harness C4; real stack (second skip refused) |
| Old check-then-`skip_patient()` in the losing order | **Defect reproduced** (consultation closed) | Harness C5 control |
| `undo_next_patient()` | Restores `in_progress → waiting` with a plain UPDATE (row lock), so it serializes with the skip. If the undo commits first, skipping a now-waiting patient is legitimate. | Reasoned from the deployed body |

No deadlock risk added: the function locks exactly one `queue_entries` row.

**Negative controls:** the same migration with `for update of q` removed fails harness C1 and C4 (patient `skipped` while their consultation is open; double skip). On the real stack it fails K1 (the HTTP skip succeeds during `next_patient()` and leaves an open consultation on a skipped entry). So the lock is load-bearing, and both test layers detect its absence.

## 4. Verification run (2026-10-10/11, local only)

**Disposable `postgres:16`** (minimal schema, deployed `skip_patient()`, `next_patient()`'s claim statement verbatim):
- 24/24 cases (authorization, clinic isolation, every status, inconsistent-row guard, grants) and 13/13 concurrency checks, on 4 consecutive runs after widening the timing margins.
- No-lock control: 3 failures, as intended.
- One earlier run (before the margins were widened, while Docker was busy pulling images) had 1 concurrency failure. Which check failed wasn't captured; most likely C2's "did not wait" bound (1000 ms against 0.3–0.9 s of `docker exec` overhead). The margins are now a 6 s hold, ≥3.5 s for "waited" and ≤2.5 s for "didn't wait", against a ≥5 s blocked minimum.

**Local Supabase stack** (`supabase start`, CLI 2.118.0, Postgres 17 like production, all 62 migrations replayed, plus one local-only seed; see §7). `local_stack_check.mjs` uses real GoTrue sign-ins and JWTs, PostgREST RPC over HTTP, RLS, and the real `next_patient()`. **31/31 on two consecutive runs:**
- `anon` (no session) is refused by grants (42501). Patient, inactive receptionist and other-clinic nurse are refused with the expected messages.
- Nurse, receptionist and admin can each skip a waiting patient, then read the `skipped` status back through **their own RLS**. A second skip is refused.
- `in_progress` is refused with the consultation untouched. `skip_patient()` is unchanged for Reception.
- K1 and K2 as in §3.
- **Rollback:** `drop function … ; notify pgrst, 'reload schema'` → PostgREST returns PGRST202 after ~0.3 s, and no function is left.
- **Re-apply:** PostgREST serves the RPC again after ~0.3 s (schema reload), still not anon-callable.
- No-lock control: K1 fails, as intended.

**`post_deploy_verify.sql`:**
- Local stack, after apply: 16/16 true.
- **Production, read-only baseline (before applying):** the function checks are false (not present); "only `get_public_queue_display` is anon-callable" and "`skip_patient` unchanged (md5 `01bf37f9…`)" are true.

## 5. Deployment runbook (only after explicit approval)

1. Re-run `run.sh` and `local_stack_check.mjs`; both must pass.
2. Run `post_deploy_verify.sql` against production (read-only). Expect: function rows false, last two rows true.
3. Apply **once** with the Supabase MCP `apply_migration` (name `skip_waiting_patient`), using **LF** content: `git show <merge-sha>:supabase/migrations/20261010231805_skip_waiting_patient.sql`. A Windows `autocrlf` working copy would store CRLF in the function body. **Never `supabase db push`.**
4. Read the recorded version from `supabase_migrations.schema_migrations`, and rename the file to `<version>_skip_waiting_patient.sql` in the same PR/commit, so file and history agree. Check the stored statements match the file.
5. Run `post_deploy_verify.sql`: all 16 rows true. Run `system_health_check()` and `system_health_check_v2()`: all pass.
6. PostgREST: the migration issues `notify pgrst, 'reload schema'`. Optionally confirm reachability with a signed-in staff call using a non-existent id. It returns `Queue entry not found` and writes nothing (needs approval like any production call).
7. Only then, as separate approved changes: re-enable V3 Skip (Server Action calls `skip_waiting_patient` only, no pre-read; restore the Figma 164:268 modal from commit `ce4422a`), and later move the classic nurse Skip onto it.

## 6. Rollback

```sql
drop function if exists public.skip_waiting_patient(uuid);
notify pgrst, 'reload schema';
```
No data, schema or policy depends on the function, and no deployed code calls it (V3 Skip is disabled, and the classic and Reception screens use `skip_patient`). If V3 Skip has been re-enabled by then, roll back the UI first. Verified on the local stack (PGRST202 within ~0.3 s).

## 7. Findings from the replay (pre-existing; not caused by this migration)

1. **The committed migrations don't replay on an empty database.** `20260808154202_admin_account_and_profile_merge` updates a profile to clinic `11111111-…`, which no migration creates. Production created the demo clinic, services and `clinic_settings` outside migrations. The local check used a scratch-only seed (clinic, three services, settings) placed after `20260805103004`; it is not committed. Recommendation: a reviewed, idempotent seed or migration for the demo rows.
2. **Drift, harmless:** in a replay, `revoke_anon_on_new_functions()` (an event-trigger function) is anon-executable; in production it isn't (revoked outside migrations). Event-trigger functions can't be invoked through SQL or PostgREST.
3. **CRLF:** this Windows checkout (`core.autocrlf=true`) replays function bodies with CRLF, so definition hashes differ until CRs are stripped. The verification compares CR-insensitively, and the runbook applies LF content.
4. **Out-of-order calls under concurrency (affects production today).** `notify_you_are_next()` inserts a notification for the patient who becomes next. That foreign-key check holds `FOR KEY SHARE` on their entry until the transaction commits, and `next_patient()`'s `FOR UPDATE SKIP LOCKED` skips such rows. So while *any* transaction that fires the trigger is open (a call, check-in or skip), a concurrent `next_patient()` passes over the real next patient: it calls the one after, or returns `queue_empty` if nobody else waits. Reproduced locally: with a skip held open, `FOR UPDATE SKIP LOCKED` could claim only the third patient, while `FOR NO KEY UPDATE SKIP LOCKED` could claim the second. The window is milliseconds in normal use. Candidate fix: claim with `FOR NO KEY UPDATE SKIP LOCKED` in `next_patient()`. That changes a production function and needs its own review; it isn't part of this migration.

## 8. Not in this change

- No change to `skip_patient()`, `next_patient()`, RLS, grants on existing objects, or any UI.
- V3 Skip stays disabled. Classic nurse Skip is unchanged and still racy (§1).
