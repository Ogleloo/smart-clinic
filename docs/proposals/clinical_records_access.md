# Clinical records and patient-identifier access — security proposal (revision 2)

**Status: PROPOSAL ONLY — nothing applied to the shared Supabase project.** No migration, RLS, grant or SQL change
has been made to production or preview. Both SQL files live under `docs/proposals/`, not `supabase/migrations/`.
Nurse V3 Phase 3 (Patient Details / Patient History) is still on hold. Revision 2 follows the review of
revision 1 (decisions D1–D4 below).

| | |
|---|---|
| Clinical proposal | [`clinical_records_access.sql`](clinical_records_access.sql) — notes/vitals, the treatment link, grants, history query |
| Profiles proposal (separate) | [`profiles_identifier_access.sql`](profiles_identifier_access.sql) — global admin profile policies (Stage 1) |
| Assertions | `supabase/tests/clinical_records_access/` — `probe.mjs` (67), `probe_profiles.mjs` (15), `regression_workflows.mjs` (24), `assert_catalog.sql` (18, read-only) |
| Where verified | A disposable local Supabase stack (CLI 2.118.0) replaying the 63 committed migrations plus a local-only demo seed |
| Not verified | **Production's live policies, grants and function ACLs** (no read access this session). `assert_catalog.sql` is read-only and is the D4 check to run there before anything is deployed. |

---

## 1. Effective access today (from the committed migrations)

### Policies

| Table | Policy | Effect |
|---|---|---|
| `consultation_notes` / `patient_vitals` | `notes_read` / `vitals_read` | SELECT for **nurse, receptionist, admin** whose clinic equals the *author nurse's* clinic: every row in the clinic |
| | `notes_write` / `vitals_write` | INSERT if role = nurse and `nurse_id` = caller. Nothing ties `consultation_id` to the caller, or `patient_id` to the consultation |
| | `notes_update` / `vitals_update` | UPDATE (USING only, **no WITH CHECK**) by the author |
| `consultations` | `consultations_nurse_write` | **FOR ALL** where `nurse_id` = caller: a nurse can INSERT and UPDATE consultation rows directly |
| | `consultations_staff_read` | SELECT for receptionist/admin by service clinic |
| `queue_entries` | `queue_staff_update` | UPDATE of **any column** by any receptionist/nurse/admin of the clinic |
| | `queue_select_staff` / `queue_select_own` | SELECT by clinic staff / by the patient |
| `profiles` | `profiles_select_admin` | SELECT for any admin, **no clinic scope** |
| | `profiles_update_admin` | UPDATE for any admin, **no clinic scope** (column grants allow `full_name, phone, date_of_birth, id_number`) |
| | `profiles_staff_read_clinic_patients` | SELECT for clinic staff of anyone with a queue entry / appointment at the clinic, or a clinic_id match |

### Grants (local replay — production unverified)

`anon` **and** `authenticated` hold `SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER` on
`consultation_notes`, `patient_vitals`, `consultations` and `queue_entries`. RLS stopped anon from reading rows
in every probe, but **TRUNCATE is not subject to RLS**: a rolled-back `TRUNCATE` as `authenticated` and as `anon`
succeeded on the clinical tables and on `consultations`.

### Who writes these tables

Every function in `public` that writes `consultations`, `queue_entries`, `consultation_notes` or `patient_vitals`
is `SECURITY DEFINER` and owned by `postgres` (`call_next_patient`, `check_in_appointment`, `check_in_patient`,
`end_consultation`, `end_shift`, `merge_patient_profiles`, `next_patient`, `reset_demo_state`,
`set_emergency_priority`, `skip_patient`, `skip_waiting_patient`, `start_consultation`, `undo_next_patient`). No
trigger function writes them. None of the four tables has `FORCE ROW LEVEL SECURITY`. No app code (`app/`,
`lib/`, `components/`) writes any of them directly; Playwright fixtures do so with the service role.

## 2. Findings

All reproduced as **assertions** on the local stack (`PHASE=baseline`, 67/67 hold — i.e. each gap is confirmed
open).

| # | Finding | Severity |
|---|---|---|
| F1 | Receptionists and admins read every diagnosis, treatment and vital sign in their clinic | High (special personal information, POPIA) |
| F2 | Any nurse reads every note/vitals row of every patient at the clinic, with no care relationship | High |
| F3 | A nurse can attach a note to another nurse's consultation | High |
| F4 | A nurse can write into another clinic's consultation | High |
| F5 | Vitals can be recorded against a patient who is not the consultation's patient | High |
| F6 | A note/vitals row can be moved to another encounter (UPDATE without WITH CHECK) | Medium |
| F7 | `anon`/`authenticated` hold TRUNCATE/DELETE/REFERENCES/TRIGGER on all four tables | High if production matches |
| F8 | Admins read and update every profile in every clinic (ID number, DOB, phone) | Medium–High |
| F9 | Notes are open to all nurses while `consultations` is owner-only: the layers disagree | Design |
| **F10** | **A nurse can create, re-open or re-target consultations directly** (`consultations_nurse_write` FOR ALL; it has no clinic or queue check). Inserting a consultation on any waiting entry, or setting `ended_at = null` on an old one, succeeded. Besides bypassing `next_patient()`, this would let a nurse *forge* any "currently treating" relationship a treatment-linked policy relies on. It also leaves orphaned open consultations (`system_health_check_v2` "No open consultation on a closed entry" fails after the probe). | High |
| **F11** | **Any clinic staff member can update any column of any queue entry directly**: `patient_id`, `status`, `priority`. Shown: a receptionist set `priority = 1` with `priority_set_by` left empty — an unaudited emergency, bypassing BR-10 and `set_emergency_priority()`'s clinical-staff check; and a nurse changed `patient_id` on the entry they were serving. | High |

Already denied and asserted to stay denied: cross-clinic nurse reads, patient and anon reads, DELETE, a note
authored under another nurse's id.

## 3. Design — treatment-linked clinical access (D1)

**Rule.** A nurse may read a note or vitals row only if the row's consultation belongs to the nurse's **current
clinic** and either

- (a) the nurse **authored** the row or **conducted** that consultation, or
- (b) the nurse is **currently treating** that consultation's patient.

"Currently treating" means: the caller is an **active** nurse (`profiles.is_active`, role nurse, clinic set) and owns
a consultation with `ended_at is null` whose queue entry is `in_progress`, at the caller's clinic, for that patient.
That is exactly the state `next_patient()` creates and `end_consultation()` / `end_shift()` / `undo_next_patient()`
end. "Relevant previous records" = that patient's earlier encounters **at the nurse's clinic**; another clinic's
records are never visible. Nothing is granted for merely belonging to the clinic. The link ends when the consultation
ends; authorship remains (and also follows the nurse's current clinic only).

**History query without broadening `consultations`.** `consultations` stays owner-only for nurses.
`public.get_patient_clinical_history(p_patient_id)` (SECURITY DEFINER) returns encounter *metadata* — id, start, end,
service name, nurse name, whether it is the current one — only when the caller is currently treating that patient,
only for the caller's clinic, newest first, capped at 100. It raises the same `42501 Not authorised` for an unknown
patient and for a patient not in the caller's care, so it is not an existence oracle. Clinical *content* is then read
by consultation id through the RLS policies, so there is a single rule for clinical rows. Verified: for the treating
nurse it returns the previous clinic-A visit and the current one, and excludes the clinic-B visit; it refuses an
unrelated nurse and a patient not in care.

**Open question for D1 (not decided here):** whether "relevant" should be narrowed further (e.g. a time window, or the
same service). The SQL makes that a one-line change in `nurse_can_read_clinical`.

## 4. Helper security analysis

| Concern | Mitigation in the proposal | Evidence |
|---|---|---|
| Helpers callable as RPCs (oracle) | They live in a new `private` schema, which is not in PostgREST's exposed schemas; `USAGE` granted to `authenticated` only so policies can evaluate them | `rpc('nurse_treats_patient')` → PGRST202; `schema('private')` → PGRST106; catalog: no anon/PUBLIC USAGE or EXECUTE |
| Identity spoofing | No helper accepts a nurse, clinic, role or user id. The caller is always derived from `auth.uid()` via `private.active_nurse()`. Inputs are an allow-list of row data (`p_consultation_id`, `p_patient_id`, `p_author_id`); `p_author_id` is the row's `nurse_id` and is only compared with the caller's own id | catalog assertion (with a negative control that adds a `p_nurse_id` helper and is flagged) |
| Exposing other patients' rows | Helpers return a boolean about one row; they never return data. The history function returns metadata only for a patient the caller is treating | probes: unrelated nurse, not-in-care patient, clinic-B history all denied |
| Forging the treatment link | F10/F11 closed: `consultations_nurse_write` and `queue_staff_update` dropped; `INSERT/UPDATE/DELETE/TRUNCATE` on `consultations` and `queue_entries` revoked from `authenticated` (SELECT kept). Only the SECURITY DEFINER lifecycle functions can create or change the link | probes: insert consultation on a waiting entry, re-open an ended one, change `patient_id` — all `42501`; the unrelated nurse still reads nothing afterwards |
| Deactivated staff | `active_nurse()` requires `is_active` | probe: a deactivated nurse with an open consultation reads nothing |
| `search_path` hijack | All helpers `SECURITY DEFINER` with `set search_path = public, pg_temp`; trigger function has no definer rights and is not executable by app roles | catalog assertion |
| Residual trust | The lifecycle functions themselves (`next_patient`, `end_consultation`, …) define who is "treating". A stale open consultation extends the link until it is closed; `end_shift()` closes it and `system_health_check()` already warns on stale ones | — |

## 5. Writes (D3) and immutability

- INSERT/UPDATE of notes and vitals require `nurse_id = caller` **and** `private.nurse_owns_active_consultation()`:
  the caller's own consultation, still open, queue entry `in_progress`, caller's clinic, and for vitals the
  consultation's own patient. Covers F3, F4, F5.
- After completion, the author can still **read** their record but can no longer change it (asserted). Corrections
  belong in a future **append-only addendum** workflow (e.g. `consultation_note_addenda`: author, reason, created_at,
  INSERT-only, no UPDATE/DELETE grant) — not part of this proposal.
- A `BEFORE UPDATE` trigger makes `consultation_id`, `nurse_id` and `patient_id` immutable on both tables (F6).

## 6. Grants (D4)

`REVOKE ALL` from `public, anon, authenticated` on the four tables, then `GRANT SELECT, INSERT, UPDATE` on the two
clinical tables and `GRANT SELECT` on `consultations` and `queue_entries` to `authenticated`. That removes
TRUNCATE, DELETE, REFERENCES and TRIGGER everywhere, and every anon privilege. `service_role` keeps its own grants.
The public display is unaffected: it reads through `get_public_queue_display()` (SECURITY DEFINER), and anon never
had a SELECT policy on `queue_entries`, so anon Realtime events were already empty. `get_patient_clinical_history`
and the helpers are revoked from `public, anon`; `get_public_queue_display` remains the only anon-callable RPC
(asserted).

## 7. Patient identifiers — separate proposal (D2)

**Stage 1 — `profiles_identifier_access.sql` (ready for review).** Drop `profiles_select_admin` and
`profiles_update_admin`. Admins then read what reception and nurses of the same clinic read, through
`profiles_staff_read_clinic_patients`, plus their own row; staff changes keep going through
`admin_set_staff_status()` (already clinic-scoped). No app code updates another user's profile directly.

| Behaviour after Stage 1 | Asserted |
|---|---|
| Admin reads a clinic-B-only patient, a clinic-B nurse, or a never-visited patient | denied |
| Admin updates any patient's profile directly (no app path uses this) | denied |
| Admin reads a clinic-A patient and clinic-A staff | allowed |
| Reception reads a linked patient's ID number / DOB for check-in identity verification | allowed |
| Reception `search_patients` finds a never-visited patient (walk-in flow) | allowed |
| Patient reads own ID number / DOB; another patient's profile | allowed / denied |

**Visible behaviour changes (please confirm):** the admin **Staff** page lists only the admin's clinic (matches what
`admin_set_staff_status` already permits); the admin **dashboard nurse count** (`role = nurse, is_active`) stops
counting other clinics' nurses (today a bug); admin **Patient search** finds only patients linked to the clinic, so a
duplicate that has never visited the clinic can no longer be found there (the merge function itself is SECURITY
DEFINER and still works).

**Stage 2 — identifier minimisation (design only; needs app changes in the same release).** Today every clinic nurse
can read every linked patient's ID number and date of birth, and `search_patients()` lets **any staff role, including
nurses, search every clinic's patients** by name/phone (both still asserted as "Stage 2" in the probe). Proposed:

1. Column privileges: re-grant `SELECT` on `profiles` to `authenticated` for all columns **except** `id_number` and
   `date_of_birth`.
2. Serve those two through SECURITY DEFINER functions with explicit rules: `get_own_identifiers()` (patient profile
   pages), `reception_get_patient_identity(p_patient_id)` (receptionist/admin of a linked clinic — check-in), and, for
   Nurse V3 Patient Details, `get_patient_details(p_patient_id)` gated on `nurse_treats_patient`.
3. Restrict `search_patients()` to receptionist/admin (no nurse uses it; it is called only from `components/reception/*`).
4. Add a clinic check to `merge_patient_profiles()` (today any admin can merge any two profiles in any clinic).

Code affected by (1): `app/(patient)/profile/page.tsx`, `app/(patient)/profile/settings/page.tsx`,
`components/profile/ProfileSettingsForm.tsx`, `app/actions/profile.ts`, `components/reception/CheckInWizard.tsx`, and
every `select('*')` on `profiles` (`app/admin/staff/page.tsx`) — a column revoke makes `select *` fail outright.

## 8. Regression review

| Area | Workflow / read | Mechanism | Effect of the proposals | Evidence |
|---|---|---|---|---|
| Reception | Walk-in creation, search, check-in, appointment check-in | SECURITY DEFINER RPCs | none | regression 24/24 |
| Reception | Identity verification on check-in (`id, full_name, phone, date_of_birth, id_number`) | `profiles_staff_read_clinic_patients` | none (Stage 2 would move it to a function) | regression + profiles probe |
| Reception | Queue list with patient names, skip (waiting only) | SELECT kept; `skip_patient` RPC | none | regression |
| Reception | Reading clinical notes/vitals | — | **removed** (intended, F1) | probe |
| Reception | Direct `queue_entries` updates | — | **removed**; no app code did this (F11) | catalog + in-transaction check |
| Nurse | Duty, next, undo, emergency, skip-waiting, end consultation, end shift | SECURITY DEFINER RPCs | none | regression; local Playwright 66/66 (real `next_patient` / `skip_waiting_patient` through the app) |
| Nurse | Current-patient panel, My Queue, dashboard (own consultations, queue reads) | SELECT on own `consultations` (new `consultations_nurse_read_own`) and clinic `queue_entries` | none | regression; Playwright |
| Nurse | Notes/vitals on the active consultation | new write policies | allowed; after completion read-only | probe |
| Nurse | Other patients' notes/vitals | — | **removed** unless treating/authored (intended, F2) | probe |
| Admin | Reports (`consultations` at the clinic) | `consultations_staff_read` (unchanged) | none | regression |
| Admin | Staff list, staff status changes | profiles SELECT; `admin_set_staff_status` | own clinic only after Stage 1 | regression + profiles probe |
| Admin | Patient search, duplicates, merge | direct profiles query; definer RPCs | search limited to clinic-linked patients after Stage 1 | regression |
| Admin | Reading clinical notes/vitals | — | **removed** (intended, F1) | probe |
| Patient | Own profile, own queue entries, booking | own-row policies; RPCs | none | regression + profiles probe |
| Patient | Own clinical notes/vitals | — | still not visible (POPIA review pending) | probe |
| Display | Public queue board | `get_public_queue_display()` (definer, anon) | none | catalog |
| Ops | `reset_demo_state()` | SECURITY DEFINER, postgres | none expected; **not verifiable locally** — it fails on the local seed for an unrelated reason (demo patient profiles that exist only in production) | — |
| Tests | Playwright fixtures | service role | none | Playwright 66/66 |

## 9. Local test results (exact)

Fresh local stack (63 committed migrations + local-only seed), all on 2026-10-12:

| Run | Result |
|---|---|
| `probe.mjs` `PHASE=baseline` (before any proposal) | **67/67 hold** — every gap reproduced; catalog rows recorded as findings |
| `probe_profiles.mjs` `PHASE=baseline` | **15/15 hold** |
| apply `clinical_records_access.sql` locally → `probe.mjs` `PHASE=proposed` | **67/67 hold** (49 behavioural + 18 catalog) |
| apply `profiles_identifier_access.sql` locally → `probe_profiles.mjs` `PHASE=proposed` | **15/15 hold** |
| `probe.mjs` `PHASE=proposed` with both applied | **67/67 hold** |
| `regression_workflows.mjs` with both applied | **24/24 steps** (first run 22/24: two steps used the wrong role — emergency priority is nurse-only, reception cannot mark a no-show; the script was corrected, not the proposal) |
| Playwright `nurse-v3-skip.local` + `nurse-classic-skip.local`, app server on the local stack, both proposals applied | **66 passed** (0 skipped); network tripwire: no non-local Supabase connection |
| `assert_catalog.sql` negative control (rolled back: helper with `p_nurse_id`, anon grant, FOR ALL policy) | flagged by 5 checks, as intended |
| `system_health_check()` + `_v2()` after all runs | 20 PASS, 1 INFO, 1 WARN, 2 FAIL — the FAILs are (a) an orphaned open consultation **created by the baseline F10 probe** and (b) `revoke_anon_on_new_functions`, an `event_trigger` function counted as anon-executable (pre-existing in the replay; not an RPC) |

Not run: anything against production or a preview; `reset_demo_state()` (see above); the live read-only Playwright suites.

## 10. Before any deployment

1. Run `assert_catalog.sql` **read-only** on production and compare with the local baseline; adjust the SQL if
   production differs.
2. Approve D1 scope (and the "relevant" question), Stage 1 behaviour changes, and the queue/consultation write
   revokes (F10/F11) — they are production changes the instant they are applied.
3. Apply as migrations committed in the same change, then re-run `assert_catalog.sql` (all 18 true), both health
   checks, and a smoke test of check-in → call → end on the deployed site.

## 11. Rollback

```sql
-- clinical_records_access.sql
drop function if exists public.get_patient_clinical_history(uuid);
drop trigger if exists consultation_notes_link_immutable on public.consultation_notes;
drop trigger if exists patient_vitals_link_immutable on public.patient_vitals;
drop policy if exists notes_read_treatment_linked on public.consultation_notes;
drop policy if exists notes_insert_active on public.consultation_notes;
drop policy if exists notes_update_active on public.consultation_notes;
drop policy if exists vitals_read_treatment_linked on public.patient_vitals;
drop policy if exists vitals_insert_active on public.patient_vitals;
drop policy if exists vitals_update_active on public.patient_vitals;
drop policy if exists consultations_nurse_read_own on public.consultations;
drop schema if exists private cascade;
-- then re-create, verbatim: notes_read/notes_write/notes_update/vitals_read/vitals_write/vitals_update
-- (20261002003441), consultations_nurse_write and queue_staff_update (20260805103110), and re-grant the previous
-- table privileges (grant all on the four tables to anon, authenticated) — i.e. restore the findings.

-- profiles_identifier_access.sql: see the rollback block at the end of that file.
```
