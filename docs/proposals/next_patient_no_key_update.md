# `next_patient()` claims with `FOR NO KEY UPDATE SKIP LOCKED` — defect, fix, readiness

**Status:** **APPLIED to production on 2026-10-10 (UTC)** as migration version `20261010232531` (`apply_migration`, name `next_patient_no_key_update`) after approval; merged in #33 (`ad1689d`). The stored SQL sha256 `a316c815154c89ac…` equals this file. `verify.sql` → `state = fixed` (production `next_patient` md5 `df0e7850…`), all checks true; both health checks passed. The sections below are the pre-deployment readiness record.

| | |
|---|---|
| Migration | `supabase/migrations/20261010232531_next_patient_no_key_update.sql` |
| Rollback | `supabase/tests/next_patient_lock/rollback_original_next_patient.sql` (the deployed definition, md5 `08dd4ed0…`) |
| Real-RPC concurrency suite | `supabase/tests/next_patient_lock/concurrency_check.mjs` (`VARIANT=original` / `fixed`) |
| Read-only pre/post verification | `supabase/tests/next_patient_lock/verify.sql` |

## 1. The defect (affects production today)

`next_patient()` claims the next patient with:

```sql
select * into entry from public.queue_entries q
 where q.service_id = prof.current_service_id and q.queue_date = current_date and q.status = 'waiting'
 order by q.priority desc, q.checked_in_at asc, q.token_number asc
 for update skip locked limit 1;
```

Three `queue_entries` triggers insert into `notifications`, whose `queue_entry_id` is a foreign key to `queue_entries`:

| Trigger | Inserts a notification for |
|---|---|
| `notify_you_are_next` (insert, or update of status/priority) | the new head of the queue, **the first time** it becomes head |
| `notify_emergency_ahead` (priority 0 → 1) | the patient pushed behind the emergency |
| `notify_called` (→ `in_progress`) | the patient being called (already locked by its caller) |

The foreign-key check on each insert takes **`FOR KEY SHARE`** on the referenced queue entry until the inserting transaction commits. `FOR UPDATE` conflicts with `FOR KEY SHARE`, so `SKIP LOCKED` treats that patient as taken. The head becomes "new" exactly when the previous head is called, skipped or reordered, so a nurse calling at that moment:
- **skips the real next patient and calls someone behind them**, or
- **gets `queue_empty` while a patient is waiting**.

The window lasts as long as the other transaction (milliseconds in normal use), so it needs two near-simultaneous actions: two nurses calling, a nurse calling while reception skips, or a call while an emergency is marked.

The legacy `call_next_patient()` has the same clause but is not called anywhere in the app, so it's out of scope.

## 2. The fix

`for update skip locked` → `for no key update skip locked`, in the claim statement only. Everything else is the deployed body verbatim; the diff is that one clause plus a comment. `CREATE OR REPLACE` keeps the signature, return type, `SECURITY DEFINER`, `search_path` and grants.

Why this is correct (PostgreSQL row-lock conflict table):

| Held by the other transaction | `FOR UPDATE` claim | `FOR NO KEY UPDATE` claim |
|---|---|---|
| `FOR KEY SHARE` (a notification FK check) | conflict → **wrongly skipped** | no conflict → **claimable** ✅ |
| `FOR NO KEY UPDATE` (another nurse's claim, or any UPDATE of status/priority) | conflict → skipped | conflict → skipped ✅ (no duplicate claims) |
| `FOR UPDATE` (`skip_patient`, `skip_waiting_patient`, DELETE) | conflict → skipped | conflict → skipped ✅ |

`next_patient` never changes a key column of the claimed row; it updates `status` and `called_at`, which is itself a `NO KEY UPDATE`. So the stronger lock bought nothing except the conflict with foreign-key checks.

## 3. Evidence (local Supabase stack; real GoTrue, PostgREST, RLS and RPCs)

The stack replays all migrations; the local `next_patient` and `notify_you_are_next` are byte-identical to production (md5, CR-insensitive). `concurrency_check.mjs` installs the variant and drives the **real** `next_patient`, `undo_next_patient`, `skip_patient`, `set_emergency_priority`, `check_in_patient`, `create_walkin_patient` and `set_duty`. It uses HTTP calls with real JWTs, plus `psql` sessions running the same RPCs under the same JWT claims inside a transaction held open to make each race deterministic.

| Scenario | Original (production) | Fixed |
|---|---|---|
| S1 two nurses call at once (nurse 1 held) | nurse 2 calls the **third** patient | nurse 2 calls the second ✅ |
| S2 same, two patients waiting | nurse 2 gets **`queue_empty`** | nurse 2 calls the second ✅ |
| S3 reception `skip_patient` of the head in flight | nurse calls the **third** | calls the second ✅ |
| S4 emergency being marked on #3 | nurse calls **#2**, passing over the committed head | calls the committed head #1 ✅; once committed, the emergency goes next |
| S4b emergency ordering (no concurrency) | emergency first, then check-in order | same ✅ |
| S5 check-in at the same moment as a call | head called, then #2 | same ✅ |
| S6 Undo held while another nurse calls; Undo with the original action id; restored patient called next; action-id replay | all correct | all correct ✅ |
| S7 3 nurses × 4 concurrent rounds over HTTP | 12 distinct, in order (the real window is too short to trigger without holding) | 12 distinct, in order ✅ |
| S8 mixed load (calls, skips, emergencies, check-ins, undos) | no deadlocks; consistent state | no deadlocks; consistent state ✅ |

Results on **4 runs per variant**, alternating:
- **original:** invariants 24/24 every run, and the 4 DEFECT checks fail every run, which is the negative control reproducing the bug.
- **fixed:** invariants 25/25 and DEFECT checks 4/4, every run.

**K2 tightened** (`supabase/tests/skip_waiting_patient/local_stack_check.mjs`): with `skip_waiting_patient` in flight, `next_patient` must call the **second** patient. It failed against the original (it called the third) and passes with the fix (31/31). The disposable-Postgres harness (24 cases, 13 concurrency checks) passes with the claim mirrored as `FOR NO KEY UPDATE`, confirming a `FOR UPDATE` skip still excludes the new claim.

`verify.sql`: locally `state = fixed` with all checks true after applying, and `state = original` after the rollback. **Production (read-only): `state = original`**, grants as expected.

## 4. What changes for users

- Nurses calling at the same moment no longer pass over the true next patient, and no longer see "no patients waiting" falsely.
- A patient whose row is being *updated* by another transaction (being called, skipped, marked emergency, restored by undo) is still passed over, as before. That row is in flux.
- A side effect of the concurrent case: the patient who becomes head can get "You are next" from one transaction and "You have been called" from the concurrent call almost together. Before, they got "You are next" and were then wrongly passed over.

## 5. Deployment runbook (only after explicit approval)

1. On a branch containing this migration, re-run locally: `concurrency_check.mjs` with `VARIANT=original` (must reproduce) and `VARIANT=fixed` (must pass), plus `run.sh` and `local_stack_check.mjs`.
2. **Preflight, read-only:** run `verify.sql` against production. It must say `state = original`. Anything else (`unknown`) means the function has drifted: **stop**, re-derive the patch from the live definition.
3. Apply **once** via the Supabase MCP `apply_migration` (name `next_patient_no_key_update`), with **LF** content from the merge commit (`git show <sha>:supabase/migrations/20261010232531_next_patient_no_key_update.sql`). **Never `supabase db push`.** It takes effect immediately for production *and* every preview (shared database). No app code change is needed: same signature and same result shape.
4. Rename the file to the version recorded in `supabase_migrations.schema_migrations`, and check the stored statements match.
5. **Post-check, read-only:** `verify.sql` → `state = fixed`, all rows true. Run `system_health_check()` and `system_health_check_v2()`.
6. Watch for any `next_patient` error reports; there's no behaviour change outside the concurrent case.

**Order relative to #32:** independent. Applying this first means #32's tightened K2 matches production behaviour once #32 is deployed. Either order is safe.

## 6. Rollback

Apply `supabase/tests/next_patient_lock/rollback_original_next_patient.sql` (restores the exact deployed definition, md5 `08dd4ed0…`, and reloads PostgREST). Then `verify.sql` → `state = original`. Verified locally. No data migration either way.

## 7. Remaining risks and limits

- **Can't be previewed:** applying changes production and every preview at once (shared database).
- The real-world window is milliseconds; the held-transaction tests make it deterministic, but the unheld HTTP stress (S7) didn't trigger the defect on the original either. So the production frequency is unknown, likely rare: it needs near-simultaneous actions on one service.
- `notify_you_are_next`'s "not exists, then insert" can, rarely, insert a duplicate "You are next" under concurrency (there's no unique constraint). Pre-existing, unchanged.
- The local stack needs a scratch-only demo seed to replay the migrations (see #32's report §7). The tests don't depend on that seed's data.
- The legacy `call_next_patient()` keeps `FOR UPDATE SKIP LOCKED`; it's unused.
