# Clinical records access — security gate for Nurse V3 Phase 3

**Status:** FINDINGS + PROPOSAL, **nothing applied**. Phase 3 (Patient Details / Patient History) is **stopped at the gate** until this is reviewed. No migration, RLS change or grant was made anywhere; no shared-Supabase write happened.

| | |
|---|---|
| Proposal SQL | `docs/proposals/clinical_records_access.sql` (not under `supabase/migrations/`) |
| Evidence script | `supabase/tests/clinical_records_access/probe.mjs` (local stack only) |
| Method | Policies/grants read from the **local stack** built by replaying the committed migrations; behaviour probed by signing in as real users of each role through PostgREST. |
| Limitation | **Production's live policies and grants were not read** (the Supabase connector is unavailable this session). Production could differ from the committed migrations. A read-only `pg_policies` / `role_table_grants` query on production should confirm before relying on the findings. |

## 1. What the effective policies are

Three migrations touch these tables (`20261001211949`, `20261002003441`, `20261006100008`). The effective set is the broad one from `…003441`:

```
notes_read / vitals_read : SELECT  role in (nurse, receptionist, admin)
                                   AND caller's clinic = clinic of the *author nurse* (nurse_id)
notes_write / vitals_write: INSERT  role = nurse AND nurse_id = caller
notes_update / vitals_update: UPDATE USING role = nurse AND nurse_id = caller   (no WITH CHECK)
no DELETE policy
```

## 2. Findings (all reproduced on the local stack)

| # | Finding | Evidence (before) | Severity |
|---|---|---|---|
| F1 | **Receptionists and admins can read every diagnosis, treatment and vital sign** in their clinic. The first migration's header says they must not; the broader policy silently reversed that. | Receptionist/admin `select diagnosis, treatment` → 2 rows | **High** (special personal information, POPIA) |
| F2 | **Any nurse reads every note and vitals row of every patient at the clinic**, whatever the visit or author, with no relationship to the patient. A single query lists all of it. | Non-author nurse: by consultation → 1 row; whole clinic → all rows; vitals by `patient_id` → all visits | **High** unless D1 (below) accepts clinic-wide continuity of care |
| F3 | **A nurse can attach a note to another nurse's consultation** (policy checks `nurse_id = me`, not that the consultation is mine). | Nurse A2 inserted a note on nurse A1's consultation → 1 row | **High** (forged history) |
| F4 | **A nurse can write into another clinic's consultation.** | Clinic-A nurse inserted a note on a clinic-B consultation → inserted | **High** |
| F5 | **Vitals can be recorded against the wrong patient** (`patient_id` unrelated to the consultation). | Vitals for patient X on patient Z's consultation → inserted | **High** (mis-attributed clinical data) |
| F6 | **Records can be re-pointed** to another consultation (UPDATE has no `WITH CHECK`). | Own note moved to another consultation → 1 row updated | **Medium** |
| F7 | **Excess table privileges.** `anon` and `authenticated` hold `DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE` on both tables. RLS blocked row access for anon in every probe, but **`TRUNCATE` is not governed by RLS**: privileges stand between a signed-in user and wiping the table. | `role_table_grants` | **High** if production matches (the 2026-10 leak noted in CLAUDE.md came from the same default-grants habit) |
| F8 | **Patient identifiers are widely visible.** `profiles_staff_read_clinic_patients` lets any nurse/receptionist/admin of a clinic read `id_number`, `date_of_birth`, `phone` of anyone ever queued/booked there, and `profiles_select_admin` is `auth_role() = 'admin'` with **no clinic scope**, so an admin reads every profile in every clinic. | A non-treating nurse read X's ID number; a clinic-A admin read a clinic-B patient's ID number | **Medium** — reception legitimately needs these at check-in; **not changed by this proposal** |
| F9 | `consultations` is only readable by the owning nurse (and receptionist/admin), but notes/vitals are readable by every nurse: the layers disagree. A history screen built on `consultations` would show nothing for other nurses' visits while the notes underneath are open. | Nurse A2 lists A1's consultations → 0 rows | Design inconsistency |

Controls that held: cross-clinic nurse reads (0), patient reads (0), anon reads (0 — RLS), DELETE (0 rows — no policy).

## 3. Proposed correction (`clinical_records_access.sql`)

1. Receptionist/admin/patient/anon: **no read policy** on either table (F1).
2. Nurse read: through boolean-only `SECURITY DEFINER` helper `nurse_can_read_clinical(consultation_id)` — the nurse's clinic must equal the clinic of the **consultation's queue entry**, not the author's profile (F2, partially; see D1).
3. Nurse write: `nurse_id = me` **and** `nurse_owns_consultation(consultation_id[, patient_id])` — my consultation, my clinic, for that patient (F3, F4, F5).
4. `BEFORE UPDATE` trigger: `consultation_id`, `nurse_id`, `patient_id` immutable (F6). `WITH CHECK` added to UPDATE policies.
5. `REVOKE ALL … FROM public, anon, authenticated` then `GRANT SELECT, INSERT, UPDATE … TO authenticated` (F7). Helpers: `revoke … from public, anon`, grant to `authenticated` only.

**Verified on the local stack** (the proposal applied to the disposable local database only): receptionist/admin reads 0 rows; forged note on another nurse's consultation, on another clinic's consultation, and mismatched-patient vitals all `42501`; re-point `P0001`; anon `42501`; the legitimate flow — author inserts a note, inserts vitals for the consultation's patient, edits it, reads it back — **still works**. It was **not** run against production, preview or any shared data, and not run through a Playwright suite (nothing in the app reads or writes these tables yet; `grep` finds only generated types and migrations).

Rollback: re-create the six original policies from `…003441`, drop the two triggers and three functions, restore the previous privileges.

## 4. Decisions needed from you

- **D1 — who may read a patient's notes and vitals?** The proposal allows **any nurse of the clinic that owns the consultation** (continuity of care: a history screen is only useful if a nurse can see earlier visits by colleagues). Strict alternative: author only (`nurse_owns_consultation(consultation_id)`), in which case Patient History shows only the nurse's own visits. This is a clinical-governance call, not a technical one.
- **D2 — patient identifiers (F8).** Should a nurse see `id_number`/`date_of_birth` for patients with whom they have no consultation? Not changed here; a column-level restriction or a `SECURITY DEFINER` patient-summary function would be the next step.
- **D3 — can notes/vitals be written after a consultation ends?** The proposal does not forbid it (late addenda); completion rules belong to the Completion phase.
- **D4 — confirm against production** (read-only `pg_policies`/`role_table_grants`) before applying; and whether to include the privilege revoke (F7) in the same migration.
- **Deployment note** (CLAUDE.md): tightening RLS is a production change the instant it is applied. Nothing deployed reads or writes these tables, so existing flows are unaffected; `reset_demo_state()` runs privileged and is unaffected by the revokes.

## 5. What Phase 3 can and cannot show until this is resolved

Available fields, from `profiles`: `full_name`, `phone`, `date_of_birth`, `id_number`; from the queue: token, service, status, timestamps. **Not in the database, to be shown as "Not recorded":** gender, allergies, medical alerts, reason for visit, prescriptions, documents. Clinical history (notes, vitals) must not be queried by the UI until the correction (or an alternative you choose) is approved and applied.
