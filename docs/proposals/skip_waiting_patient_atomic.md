# Proposal: atomic "skip only if still waiting" (`skip_waiting_patient`)

**Status:** proposal only — **not applied**, needs explicit approval. Nothing here has touched project `bffhjvpkfivtbzqielve`.
**SQL:** [`skip_waiting_patient.sql`](skip_waiting_patient.sql) (deliberately not under `supabase/migrations/`).
**Tests:** `bash supabase/tests/skip_waiting_patient_proposal/run.sh` (disposable `postgres:16` container; needs Docker).

## 1. Problem

Nurse V3 My Queue offered Skip on waiting rows. Its Server Action read the entry's status and, if `waiting`, called `skip_patient()`. That is a time-of-check/time-of-use race:

1. Nurse A's screen reads the entry: `waiting`.
2. Nurse B calls `next_patient()`, which claims that same patient: `in_progress` plus an open consultation for B.
3. Nurse A's `skip_patient()` runs. For a **nurse** caller it accepts `in_progress` (that's how a patient who walked out mid-consultation is handled), so it closes B's consultation as `patient_skipped` and marks the entry `skipped`.

A second status read doesn't help: any read that's separate from the update has the same gap. The disposable-database control **C5** reproduces exactly this outcome.

**Interim mitigation, in PR #31:** the V3 Skip is disabled fail-closed, and its Server Action and modal are removed. **The classic `/nurse` Skip button (`SkipButton` → `skipPatient` → `skip_patient()` as a nurse) has the same race, with a wider window** (from page render to click, and no status check at all). It's left unchanged at the reviewer's instruction; §6 proposes moving it onto this function.

Reception isn't affected: for a `receptionist` caller, `skip_patient()` already requires `waiting`, checked on the row it has locked (`for update of q`), which is atomic.

## 2. Design

Add a new function rather than changing `skip_patient()`:

```
skip_waiting_patient(p_queue_entry_id uuid) returns queue_entries   -- security definer
```

- **Authentication and authorization:** identical to `skip_patient()` (20261010003117): an active profile for `auth.uid()`, role in `nurse | receptionist | admin`, non-null `clinic_id`. Patients, inactive staff, staff without a clinic, users without a profile, and `anon` are all refused.
- **Clinic isolation:** the entry is resolved only where `queue_entries.clinic_id` **and** its service's `clinic_id` equal the caller's clinic. "Missing" and "other clinic" both return `Queue entry not found` (no existence oracle).
- **Atomic expected-status check:** `select … for update of q`, then require `status = 'waiting'` on the locked row. `in_progress` → "already in consultation…"; any other status → "no longer waiting".
- **Defence in depth:** if a waiting entry somehow has an open consultation, refuse. Never close a consultation (this function doesn't write to `consultations` at all).
- **Transition:** `status = 'skipped', completed_at = now()`, same as `skip_patient()`'s non-no-show path. No `p_no_show`, because the waiting-list action never marks a no-show.
- **Grants:** `revoke all … from public, anon; grant execute … to authenticated;`. The "exactly one anon-callable function" invariant (`get_public_queue_display`) still holds.

**Why not add `p_expected_status` to `skip_patient()`?** `CREATE OR REPLACE` with a new parameter creates a second overload, not a replacement. With defaulted parameters, PostgREST and `supabase.rpc('skip_patient', …)` calls can become ambiguous, and Reception's and the classic nurse screen's calls would be affected by a production change that can't be previewed. A separate, additive function leaves every existing caller byte-for-byte unchanged.

## 3. Concurrency (READ COMMITTED, as deployed)

`next_patient()` claims its patient with:

```
select … from queue_entries where service_id = … and queue_date = current_date and status = 'waiting'
order by priority desc, checked_in_at, token_number for update skip locked limit 1
```

| Interleaving | Outcome with `skip_waiting_patient` | Test |
|---|---|---|
| `next_patient` locks the row first and commits | Skip waits on the lock, re-reads the committed row (`in_progress`), refuses. The consultation stays open. | C1 (waited ~2.3 s) |
| Skip locks first | `next_patient` passes over the locked row immediately (`SKIP LOCKED`) and calls the next patient. The skipped patient is never called. | C2 (no wait, ~0.35 s) |
| `next_patient` locks, then rolls back | Skip waits, sees `waiting`, succeeds. | C3 |
| Two skips of one patient | The second waits, then "no longer waiting". | C4 |
| Old check-then-`skip_patient()` in the losing order | **Defect reproduced:** consultation closed (control). | C5 |
| Same order with `skip_waiting_patient` | Refused, consultation open. | C5 |

Other writers to the row: `undo_next_patient()` restores `in_progress → waiting` with a plain `UPDATE` (a row lock), so it serializes with the skip. If the undo commits first the patient is legitimately waiting again, so skipping is allowed. If the skip commits first, the undo's `where status = 'in_progress'` matches nothing for that entry. `set_emergency_priority()` also serializes and doesn't change status. Deadlock risk: none added. The function locks exactly one `queue_entries` row and nothing else.

**Negative control on the proposal itself:** the same suite run against a copy without `for update of q` fails C1 (patient marked `skipped` while their consultation is still open) and C4 (double skip). So the lock is load-bearing and the tests detect its absence.

## 4. Existing callers

| Caller | Today | After applying this (no code change) |
|---|---|---|
| Reception Queue (`skipQueueEntry` → `skip_patient`) | atomic for receptionists | unchanged |
| Classic nurse `SkipButton` (`skipPatient` → `skip_patient`) | racy (see §1) | unchanged; follow-up in §6 |
| Nurse V3 My Queue | Skip disabled, no action wired | unchanged until re-enabled in §6 |
| `end_shift`, `next_patient`, `undo_next_patient` | — | unchanged; they don't call skip functions |

## 5. Deploying and rolling back

- **Expand only:** one new function plus grants. Old deployed code ignores it, so it's safe for currently deployed production.
- Commit the migration file in the same change that applies it (CLAUDE.md). Apply once via `apply_migration`, then verify read-only:
  - the stored SQL hash equals the file;
  - `has_function_privilege('anon', 'public.skip_waiting_patient(uuid)', 'execute') = false`;
  - `system_health_check()` and `_v2()` are green, including the single-anon-function assertion.
  - Optionally add a `system_health_check_v2()` assertion that `skip_waiting_patient` is not anon/PUBLIC-executable.
- **Rollback:** `drop function public.skip_waiting_patient(uuid);`. No data or schema depends on it. Roll back the UI first if it has been wired.

## 6. Follow-ups (each needs its own approval)

1. Apply the function (migration file + `apply_migration`), with the harness re-run first.
2. Re-enable V3 Skip: a Server Action that calls `skip_waiting_patient` only (no pre-read), restore the Figma 164:268 modal from commit `ce4422a`, plus tests. Then a controlled live test on a preview with one synthetic patient.
3. Move the classic `skipPatient` (waiting-row button) onto `skip_waiting_patient` as well. The "patient walked out mid-consultation" path, if wanted, should be an explicit, separately-labelled action on the current patient, not the waiting-row Skip.

## 7. Limits of the evidence

The harness uses a minimal schema mirroring the deployed columns, enums and the deployed `skip_patient()`, and reproduces `next_patient()`'s claim statement verbatim. It doesn't run the real `next_patient()` (its ledger, stats and settings tables aren't modelled), RLS policies (the function is `security definer`, so they don't apply to it), or Supabase's PostgREST layer. Run on 2026-10-10: **24/24 cases and 13/13 concurrency checks passed; the no-lock negative control failed 3 checks, as intended.**
