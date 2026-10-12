# Clinical records, patient identity and queue priority — security proposal (revision 5)

**Status: PROPOSAL ONLY — nothing applied to the shared Supabase project; not authorised for production.** No
migration, RLS, grant or SQL change has been made to production or preview; the read-only production inventory has
**not** been run. All SQL lives under `docs/proposals/`. Nurse V3 Phase 3 stays paused at the clinical-record gate.
The treatment-linked design is approved in principle.

| | |
|---|---|
| Clinical proposal | [`clinical_records_access.sql`](clinical_records_access.sql) — treatment-linked notes/vitals, no direct writes to consultations/queue_entries, minimal grants, paginated history, legacy RPCs revoked (unchanged in rev 4) |
| Profiles proposal | [`profiles_identifier_access.sql`](profiles_identifier_access.sql) — rev 4: `shared` scope, no cross-clinic search disclosure, single-clinic audited merge |
| Queue priority (new) | [`queue_priority_reception.sql`](queue_priority_reception.sql) — revised BR-10, Reception-managed, audited, nurse escalation; closes F12 at cutover |
| Function privileges (new) | [`function_privileges_hardening.sql`](function_privileges_hardening.sql) — F13 `reset_demo_state`, F14 `send_appointment_reminders` |
| Identity prototype (new) | [`identity_documents_prototype.sql`](identity_documents_prototype.sql) — design prototype for mandatory ID (not the registration change) |
| Supervisor requirements | [`supervisor_requirements.md`](supervisor_requirements.md) — mandatory identification; Reception-managed priority; V3 impact |
| Local assertions | `supabase/tests/clinical_records_access/` — `probe.mjs` 85, `probe_profiles.mjs` 70, `probe_priority.mjs` 48, `probe_identity.mjs` 36, `regression_workflows.mjs` 24 |
| Read-only catalog | `assert_catalog.sql` 19, `assert_catalog_profiles.sql` 14, `assert_catalog_priority.sql` 11, `production_inventory.sql` — **not run on production** |

## R5. Revision 5 — targeted corrections (decisions D-S1…D-ID5 applied)

| # | Review finding | Correction | Asserted |
|---|---|---|---|
| 1 | `queue_priority_events` cascaded from `queue_entries` | No FK to `queue_entries` on events or escalations; entry snapshot columns; append-only trigger on events; escalations resolve-once and never deleted (all roles, incl. service role) | history + escalations survive deleting the entry; update/delete refused |
| 2 | Clearing priority needed no reason | Reason **code** required for every change; separate raise / clear code sets enforced in the function and by a table CHECK | clear without reason / with a raising code refused; clear with `no_longer_required` logged |
| 3 | Merge reason nullable; 2-arg RPC unjustified | `reason_code` NOT NULL; `merge_patient_profiles_with_reason` (code + 10–500-char note, active admin); legacy 2-arg kept until the Admin UI cutover, recorded as `legacy_unspecified`; single private core; audit append-only | 12 new checks (missing/legacy code, short note, receptionist, deactivated admin, shared patient, audit content, immutability, core not an RPC) |
| 4 | Escalation tests carried symptoms readable by Reception | Escalations take a reason **code** only (`nurse_assessed_urgent`, `nurse_requests_early_review`); no note column; Reception-visible rows contain no free text | free-text parameter rejected; Reception's view has no free-text column |
| 6 | Identity design end-to-end | Prototype rev 5: HMAC (Vault key) instead of plaintext; exact-match lookup; verified atomic replacement; single-use expiring claim codes after document verification | 33 identity checks (see §9) |

Also: priority decisions D-P1 (admin oversight only — asserted admin cannot set, can read history), D-P2 (no
reception-observed clinical code), D-P3 (codes only); D-F13 recorded (`reset_demo_state` service-role only; live
destructive suites to move to isolated infrastructure); inventory now also lists extensions and Vault secret **names**.
One catalog rule was made precise (the "row-data inputs only" rule applies to private helpers that app roles can
execute; internal definer functions taking a staff id are non-executable by app roles, asserted separately); its
negative control still fires.

**Ready for a read-only production inventory?** Yes, from the security-design side: all proposals, read-only
catalog files and the inventory script are final for this review and pass locally. Running it still needs your
explicit authorisation; nothing has been run against production.

## R4. Revision 4 — what changed and why

**Verified facts** (local stack, committed migrations) are marked [fact]; recommendations [design].

1. **Cross-clinic merge hole in rev 3 — fixed.** [fact] `private.patient_scope()` returned `linked` for a patient with
   history at clinics A **and** B, so clinic A's admin could merge that patient and rewrite clinic B's queue entries
   (asserted against baseline: B's entry moved). Also [fact] a clinic-A-only patient could be `cancelled_by` on a
   clinic-B appointment or hold a notification about a clinic-B entry, and the merge rewrote those too.
   [design] `patient_scope` now returns `linked` / **`shared`** / `foreign` / `unaffiliated`; the merge refuses
   `shared` and `foreign` on either side, refuses if any row it would rewrite (queue entries, appointments,
   notifications, `cancelled_by`, `priority_set_by`) belongs to another clinic, requires patient profiles, and writes
   `patient_merge_audit` (clinic-scoped admin read, no direct writes). Duplicates listing excludes `shared`. Asserted:
   shared-patient merges by A and by B refused, B's records untouched, audit row written and not readable by clinic B.
   Reconciled with mandatory ID: merges become exceptional reconciliation only (`supervisor_requirements.md` §1.6).
2. **Cross-clinic patient search — tightened.** [design] Rev 3 returned a patient known only to other clinics on an
   exact phone match; a phone number is not proof of identity, so rev 4 never returns them. Patients known to this
   clinic (incl. `shared`) and unaffiliated patients remain searchable. Returning patients from another clinic will be
   found by exact identity document once mandatory ID exists. **Interim cost:** until then Reception at clinic A cannot
   find a clinic-B patient and may create a second walk-in profile — accepted temporarily or the profiles migration
   waits for identity documents (*decision D-S1*).
3. **F12 `set_emergency_priority` — corrected through the supervisor's Reception model.** [fact] no clinic check
   (asserted: clinic-A nurse changed a clinic-B entry), changes in-progress entries, no history. [design]
   `queue_priority_reception.sql`: Reception-only `set_queue_priority` with clinic check, waiting-only, reasons,
   history and nurse escalations; the cutover revokes `set_emergency_priority` from app roles and stops priority at
   check-in. Must ship with the Reception V3 control and the removal of the Nurse toggle. Asserted (36 checks).
4. **F13 `reset_demo_state`** [fact] any admin of any clinic can run it and it resets every clinic. [design] service
   role / SQL editor only. **Dependency [fact]:** `e2e/helpers.ts` calls it as the demo admin for the live suites;
   revoking it breaks them by design (they mutate the shared production database) — *decision D-F13*: move those
   suites to the local stack, or keep a clinic-scoped admin variant.
5. **F14 `send_appointment_reminders`** [fact] executable by any signed-in user, no role check (asserted: a patient
   triggered it). Its only intended caller is the pg_cron job, which runs as `postgres`. [design] revoke from app
   roles; the cron job is unaffected (asserted it still targets the function as `postgres`).
6. **Admin Staff scoping** preserved (rev 3 policy: visit-based staff reads only for patient profiles). Planned app
   change, not in this PR: explicit `.eq('clinic_id', …)` on the Staff page query. Cross-clinic **patient care**
   remains (a `shared` patient is visible to both clinics' staff); cross-clinic **administration** does not.
7. **Supervisor requirements** documented in `supervisor_requirements.md` and `docs/V3_REQUIREMENTS.md`, with an
   identity-document prototype whose database invariants are tested (validation, normalisation, concurrent
   uniqueness, replacement, minimum exposure). Registration itself is unchanged.
8. **Two prototype defects found by the tests and fixed** [fact]: the identity CHECK constraints call `private`
   functions, so the inserting role needs USAGE/EXECUTE (writes will come from SECURITY DEFINER functions); and the
   validators were left with the default PUBLIC EXECUTE — now revoked, per the project rule.

### Recommended migration and implementation sequence [design]

| # | Change | Depends on | Ships with app change? |
|---|---|---|---|
| 0 | **Authorise and run** the read-only inventory + three catalog files on production; reconcile drift | — | no |
| 1 | `function_privileges_hardening.sql` (F14 now; F13 after D-F13) | 0; D-F13 | F13: e2e helper change |
| 2 | `clinical_records_access.sql` | 0 | no (no deployed code writes the affected tables) |
| 3 | `profiles_identifier_access.sql` | 0; D-S1 | Staff page filter in the same window |
| 4 | Nurse V3 Phase 3 screens (Patient Details / History) | 2 | yes |
| 5 | `queue_priority_reception.sql` Part 1 | 0 | no |
| 6 | Reception V3 Queue priority control + escalation inbox; Nurse escalate action; Nurse toggle removed; **Part 2 cutover** | 5 | **yes — one release** |
| 7 | Identity documents: expand → registration/walk-in capture → backfill → enforcement → drop `profiles.id_number` | decisions D-ID1…5 | yes (Patient, Reception V3) |
| 8 | Admin V3 without routine merge; later revoke the 2-argument merge | 3, 7 | yes |

### Remaining decisions

All of D-S1, D-F13, D-P1–3 and D-ID1–5 were decided in the PR #36 review and are applied in revision 5
(`supervisor_requirements.md`, decisions table). Remaining: authorisation to run the read-only production inventory;
separate approval of each migration.

## 0. Revision 3 — final review answers (kept for history; see R4 for changes)

1. **Clinic-B staff on clinic A's Staff page — yes, today and even after revision-2 Stage 1.**
   `app/admin/staff/page.tsx` selects `profiles` by role with **no clinic filter**, relying on RLS.
   `check_in_patient()` accepts any profile id, so a clinic-B nurse can be checked in (or booked) at clinic A as a
   patient; `profiles_staff_read_clinic_patients` then exposes that nurse's profile to every clinic-A staff member,
   and the Staff page lists them as a nurse (`admin_set_staff_status` would refuse to change them, but the row and
   its phone are disclosed). Dropping only the global admin policy did not fix it. **Correction (Stage 1, rev 3):**
   the visit-based branches of `profiles_staff_read_clinic_patients` now apply to `role = 'patient'` profiles only;
   staff are visible through `clinic_id` only. Asserted: listed today → not listed after; receptionist read →
   denied; own-clinic staff still listed. **Recommended app follow-up (not in this PR):** add an explicit
   `.eq('clinic_id', …)` to the Staff page query (CLAUDE.md: filter explicitly even when RLS would suffice).
2. **`find_duplicate_patients()` / `search_patients()` / `merge_patient_profiles()`** — all three are SECURITY
   DEFINER with **no clinic scope** (details and corrections in §7). Summary: any admin listed every clinic's
   duplicate patients (names, phones, visit counts); any staff role, including nurses, could substring-search every
   clinic's patients; any admin could merge any two profiles in any clinic — including a **staff** profile, moving
   another clinic's records and deleting the merged profile. Corrected through one classifier,
   `private.patient_scope()`. *(Rev 4: a `shared` scope was added and the exact-phone cross-clinic search removed — see R4.)*
3. **History authorisation matches `next_patient()`.** "Currently treating" requires an open consultation owned by
   the nurse with the queue entry `in_progress` — the state `next_patient()` creates atomically. Asserted: a nurse
   whose service has the patient **waiting** (not called) gets nothing; after `next_patient()` access starts; after
   `undo_next_patient()` it ends. Two **legacy RPCs** were still executable by every authenticated user and are a
   second "Begin Consultation" path: `start_consultation(queue_entry_id)` lets **any** nurse open a consultation on
   **any** in-progress entry (no clinic check, no check that they called the patient), and `call_next_patient()`
   marks an entry in progress without a consultation. Neither is used by the app or by any database function. The
   clinical proposal revokes EXECUTE on both (expand/contract; dropping them later). No new operation is added.
4. **History query** now excludes encounters that were not clinical encounters (queue entry `skipped`/`no_show`,
   `exclusion_reason` `patient_skipped`/`patient_no_show`/`demo_reset`), keeps `staff_break` (a real encounter whose
   duration is only excluded from averages), and uses **keyset pagination** (`p_before_started_at`, `p_before_id`,
   `p_page_size` 1–50, default 20) with no row cap or date cutoff. Undone calls leave no row (undo deletes the
   consultation). Asserted with 25 + 1 kept prior visits and three excluded ones.
5. **Read-only production inventory:** `production_inventory.sql` (RLS flags and owners, all public policies, table
   and column-only grants, function definer/owner/search_path/ACL/anon+authenticated EXECUTE/body md5, writer
   dependencies for six tables, triggers, schema and default privileges, Realtime publication, event triggers,
   recorded migrations). It runs in a `READ ONLY` transaction and rolls back. Exercised locally only (342 lines on
   the baseline replay; 61 lines differ after both proposals, all expected). **Not run on production.**
6. **Health checks, cleanly separated** (§9): on a fresh replay with no fixtures the status rows are **identical**
   before and after applying both proposals (22 PASS, 1 INFO, 1 FAIL). The one FAIL is pre-existing:
   `revoke_anon_on_new_functions`, an `event_trigger` function counted as anon-executable by
   `system_health_check_v2` (not callable as an RPC). The revision-2 "orphaned open consultation" FAIL appears only
   after the **baseline** probe (it is the F10 forgery succeeding) and does not appear under the proposal.
7. **New tests added**, none weakened: 18 more clinical assertions (workflow alignment, legacy RPCs, pagination,
   exclusions) and 22 more profiles assertions (Staff page, duplicates, search, merge, cross-clinic controls) plus
   an 8-check profiles catalog file.
8. Docs/tests updated; SQL stays outside `supabase/migrations`.

**Other cross-clinic paths found in the rev-3 audit** (rev 4 proposes fixes for F12–F14 — see R4.3–R4.5):

| # | Finding | Evidence |
|---|---|---|
| F12 | `set_emergency_priority()` has no clinic check: a clinic-A nurse/admin can change priority on a clinic-B queue entry | asserted "known open" in `probe_profiles.mjs` |
| F13 | `reset_demo_state()` is executable by any admin and closes open consultations / resets queues **in every clinic** | code review (not executed: fails on the local seed) |
| F14 | `send_appointment_reminders()` is executable by any authenticated user with no role check (notification spam) | catalog |
| — | `set_duty()` *does* refuse another clinic's service (trigger `profiles_service_clinic_match`) — my earlier suspicion was wrong | asserted as a control |

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

All reproduced as **assertions** on the local stack (`PHASE=baseline`: clinical 85/85, profiles 37/37 hold — i.e.
each gap is confirmed open). F12–F14 are in §0.

| # | Finding | Severity |
|---|---|---|
| F1 | Receptionists and admins read every diagnosis, treatment and vital sign in their clinic | High (special personal information, POPIA) |
| F2 | Any nurse reads every note/vitals row of every patient at the clinic, with no care relationship | High |
| F3 | A nurse can attach a note to another nurse's consultation | High |
| F4 | A nurse can write into another clinic's consultation | High |
| F5 | Vitals can be recorded against a patient who is not the consultation's patient | High |
| F6 | A note/vitals row can be moved to another encounter (UPDATE without WITH CHECK) | Medium |
| F7 | `anon`/`authenticated` hold TRUNCATE/DELETE/REFERENCES/TRIGGER on all four tables (and, per the reconciliation, on all 14 public tables) | Least-privilege / defence in depth: not reachable through PostgREST or pg_graphql — see `staged_migration_plan.md` R2 (earlier "High" overstated it) |
| F8 | Admins read and update every profile in every clinic (ID number, DOB, phone); clinic staff read other clinics' **staff** profiles via patient visits (§0.1) | Medium–High |
| F9 | Notes are open to all nurses while `consultations` is owner-only: the layers disagree | Design |
| **F10** | **A nurse can create, re-open or re-target consultations directly** (`consultations_nurse_write` FOR ALL; it has no clinic or queue check). Inserting a consultation on any waiting entry, or setting `ended_at = null` on an old one, succeeded. Besides bypassing `next_patient()`, this would let a nurse *forge* any "currently treating" relationship a treatment-linked policy relies on. It also leaves orphaned open consultations (`system_health_check_v2` "No open consultation on a closed entry" fails after the probe). | High |
| **F11** | **Any clinic staff member can update any column of any queue entry directly**: `patient_id`, `status`, `priority`. Shown: a receptionist set `priority = 1` with `priority_set_by` left empty — an unaudited emergency, bypassing BR-10 and `set_emergency_priority()`'s clinical-staff check; and a nurse changed `patient_id` on the entry they were serving. | High |

| F15 | Legacy `start_consultation()` / `call_next_patient()` still executable: a second way to open a consultation, on any in-progress entry, in any clinic (§0.3) | High |
| F16 | `find_duplicate_patients()`, `search_patients()`, `merge_patient_profiles()` disclose or mutate other clinics' patients; merge accepts staff profiles (§7) | High |

Already denied and asserted to stay denied: cross-clinic nurse reads, patient and anon reads, DELETE, a note
authored under another nurse's id, `set_duty()` on another clinic's service.

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
only for the caller's clinic, newest first, **paginated by keyset** (`p_before_started_at` + `p_before_id`, page size
1–50, default 20; no cap, no date cutoff), excluding non-encounters (skipped / no-show / demo-reset closures; §0.4).
It raises the same `42501 Not authorised` for an unknown
patient and for a patient not in the caller's care, so it is not an existence oracle. Clinical *content* is then read
by consultation id through the RLS policies, so there is a single rule for clinical rows. Verified: for the treating
nurse it returns the previous clinic-A visit and the current one, and excludes the clinic-B visit; it refuses an
unrelated nurse and a patient not in care.

**D1 decided:** all available historical visits at the patient's current clinic, while the nurse is treating them;
no date cutoff; pagination. Implemented as above.

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

**Stage 1 — `profiles_identifier_access.sql` (revision 3, ready for review).**

| Change | Why |
|---|---|
| Drop `profiles_select_admin`, `profiles_update_admin` | unscoped admin read/update of every profile in every clinic |
| `profiles_staff_read_clinic_patients`: visit-based branches only for `role = 'patient'` | other clinics' staff disclosed via patient visits, incl. on the Staff page (§0.1) |
| `private.patient_scope(id)` → `linked` / `foreign` / `unaffiliated` | one rule for the three functions; caller from `auth.uid()`; returns no profile data; not an RPC |
| `find_duplicate_patients()`: pairs with neither side foreign and at least one side linked | today lists every clinic's patients (names, phones, visit counts) |
| `search_patients()`: receptionist/admin only; substring search within linked, shared and unaffiliated patients; a patient known only to other clinics is **never** returned (rev 4) | today any staff role substring-searches every clinic |
| `merge_patient_profiles()`: both profiles `patient`; neither foreign; at least one linked; one generic refusal message; role check uses `is distinct from` | today any admin merges any two profiles in any clinic, including staff; original `<> 'admin'` passes a NULL role |

| Behaviour after Stage 1 | Asserted |
|---|---|
| Admin reads a clinic-B-only patient, a clinic-B nurse, a never-visited patient; updates any profile directly | denied |
| Clinic-B nurse who visited clinic A as a patient: on clinic A's Staff page / readable by clinic-A reception | denied |
| Admin reads clinic-A patients and staff; Staff page lists own-clinic staff | allowed |
| Reception reads a linked patient's ID number / DOB (check-in identity verification) | allowed |
| Reception search: never-visited patient by name; clinic-A patient by name; shared (A+B) patient by name | allowed |
| Reception search: clinic-B-only patient by partial name, partial phone or exact phone; any nurse calling `search_patients` | denied |
| Duplicates: clinic-B-only pair hidden; clinic-A + never-visited pair shown | asserted |
| Merge: two clinic-B patients, or a staff profile → refused; never-visited duplicate into clinic-A patient → allowed | asserted |
| Patient reads own ID number / DOB; another patient's profile | allowed / denied |

**Visible behaviour changes (accepted in principle, verify in UI):** the Staff page lists only the admin's clinic;
the admin dashboard nurse count stops counting other clinics' nurses (a bug today); admin Patient search finds only
clinic-linked patients; reception can no longer find another clinic's patient by partial name (exact phone instead);
in historical queue lists, the name of a *staff* member who was once queued as a patient at another clinic is no
longer resolvable from that clinic.

**Stage 2 — identifier minimisation (design only; needs app changes in the same release).** Today every clinic nurse
can read every linked patient's ID number and date of birth, and `search_patients()` lets **any staff role, including
nurses, search every clinic's patients** by name/phone (both still asserted as "Stage 2" in the probe). Proposed:

1. Column privileges: re-grant `SELECT` on `profiles` to `authenticated` for all columns **except** `id_number` and
   `date_of_birth`.
2. Serve those two through SECURITY DEFINER functions with explicit rules: `get_own_identifiers()` (patient profile
   pages), `reception_get_patient_identity(p_patient_id)` (receptionist/admin of a linked clinic — check-in), and, for
   Nurse V3 Patient Details, `get_patient_details(p_patient_id)` gated on `nurse_treats_patient`.
3. (`search_patients()` restriction and the merge clinic check moved into Stage 1 in revision 3.)

Code affected by (1): `app/(patient)/profile/page.tsx`, `app/(patient)/profile/settings/page.tsx`,
`components/profile/ProfileSettingsForm.tsx`, `app/actions/profile.ts`, `components/reception/CheckInWizard.tsx`, and
every `select('*')` on `profiles` (`app/admin/staff/page.tsx`) — a column revoke makes `select *` fail outright.

## 8. Regression review

| Area | Workflow / read | Mechanism | Effect of the proposals | Evidence |
|---|---|---|---|---|
| Reception | Walk-in creation, search, check-in, appointment check-in | SECURITY DEFINER RPCs | none | regression 24/24 |
| Reception | Identity verification on check-in (`id, full_name, phone, date_of_birth, id_number`) | `profiles_staff_read_clinic_patients` | none (Stage 2 would move it to a function) | regression + profiles probe |
| Reception | Queue list with patient names, skip (waiting only) | SELECT kept; `skip_patient` RPC | none | regression |
| Reception | Patient search (`search_patients`) | SECURITY DEFINER, now scoped | same within the clinic (incl. shared patients) and for never-visited patients; patients known only to another clinic no longer returned (D-S1) | profiles probe + regression |
| Reception | Reading clinical notes/vitals | — | **removed** (intended, F1) | probe |
| Reception | Direct `queue_entries` updates | — | **removed**; no app code did this (F11) | catalog + in-transaction check |
| Nurse | Duty, next, undo, emergency, skip-waiting, end consultation, end shift | SECURITY DEFINER RPCs | none | regression; local Playwright 66/66 (real `next_patient` / `skip_waiting_patient` through the app) |
| Nurse | Current-patient panel, My Queue, dashboard (own consultations, queue reads) | SELECT on own `consultations` (new `consultations_nurse_read_own`) and clinic `queue_entries` | none | regression; Playwright |
| Nurse | Notes/vitals on the active consultation | new write policies | allowed; after completion read-only | probe |
| Nurse | Other patients' notes/vitals | — | **removed** unless treating/authored (intended, F2) | probe |
| Nurse | Legacy `start_consultation` / `call_next_patient` | — | **EXECUTE revoked**; unused by app and database (F15) | probe + catalog |
| Nurse | Emergency toggle (`set_emergency_priority`) | revoked at the priority cutover | **removed** with the UI change; replaced by "escalate to reception" | priority probe |
| Reception | Queue priority | new `set_queue_priority` + escalation inbox | **new** Reception responsibility (revised BR-10) | priority probe + regression |
| Admin | Duplicates / merge | scoped, single-clinic, audited | no routine Admin V3 screen; exceptional only | profiles probe |
| Ops / tests | `reset_demo_state()`, `send_appointment_reminders()` | service role / cron only | live e2e helper affected (D-F13); cron unaffected | profiles probe + catalog |
| Admin | Reports (`consultations` at the clinic) | `consultations_staff_read` (unchanged) | none | regression |
| Admin | Staff list, staff status changes | profiles SELECT; `admin_set_staff_status` | own clinic only after Stage 1 | regression + profiles probe |
| Admin | Patient search, duplicates, merge | direct profiles query; definer RPCs | search limited to clinic-linked patients after Stage 1 | regression |
| Admin | Reading clinical notes/vitals | — | **removed** (intended, F1) | probe |
| Patient | Own profile, own queue entries, booking | own-row policies; RPCs | none | regression + profiles probe |
| Patient | Own clinical notes/vitals | — | still not visible (POPIA review pending) | probe |
| Display | Public queue board | `get_public_queue_display()` (definer, anon) | none | catalog |
| Ops | `reset_demo_state()` | SECURITY DEFINER, postgres | none expected; **not verifiable locally** — it fails on the local seed for an unrelated reason (demo patient profiles that exist only in production) | — |
| Tests | Playwright fixtures | service role | none | Playwright 66/66 |

## 9. Local test results (exact, revision 5, 2026-10-12)

Two fresh local stacks (63 committed migrations + local-only seed). Stack A: no proposal. Stack B: all five SQL
proposals applied. "Skipped" rows assert objects that exist only after the proposals; they are counted in the totals.

| Run | Stack A — baseline | Stack B — all proposals |
|---|---|---|
| health checks, fresh, no fixtures | 22 PASS · 1 INFO · 1 FAIL | **identical** before and after applying, and identical to A |
| `production_inventory.sql` (read-only) | 350 lines | 383 lines |
| `assert_catalog.sql` | 4 / 19 true (findings) | **19 / 19** |
| `assert_catalog_profiles.sql` | 1 / 14 true | **14 / 14** |
| `assert_catalog_priority.sql` | 0 / 11 true | **11 / 11** |
| `probe.mjs` (clinical) | 85/85 hold (5 skipped) | **85/85** |
| `probe_profiles.mjs` | 70/70 hold (16 skipped) | **70/70** |
| `probe_priority.mjs` | 48/48 hold (30 skipped) | **48/48** |
| `probe_identity.mjs` | 36/36 hold (33 skipped) | **36/36** |
| `regression_workflows.mjs` | 24/24 (nurse priority path) | **24/24** (Reception priority path) |
| Playwright `nurse-v3-skip.local` + `nurse-classic-skip.local` | — | **66 passed**; tripwire: no non-local Supabase traffic |
| health checks after all tests | 20 PASS · 1 INFO · 1 WARN · 2 FAIL | 21 PASS · 1 INFO · 1 WARN · 1 FAIL |

The FAIL present everywhere is pre-existing (`revoke_anon_on_new_functions`, an event-trigger function counted as
anon-executable; not an RPC). Stack A's extra FAIL is the orphan created by the successful F10 forgery probe. The
WARN is backdated open fixtures.

Intermediate rev-5 run (recorded for honesty): the first stack-B run had one failure — the clinical catalog's
"row-data inputs only" rule flagged the identity/merge internals (which take a staff id but are not executable by
app roles). The rule was narrowed to app-executable helpers, its negative control re-run (still flags), and both
stacks were re-run from scratch; the table above is that final run.

Not run: anything against production or a preview (including the read-only inventory); `reset_demo_state()`
itself; the live Playwright suites; TypeScript/ESLint/build of app code (no app code changed; ESLint clean on the
test scripts).

## 10. Before any deployment (remaining blockers)

See **R4 → Recommended migration and implementation sequence** and **Remaining decisions**. In short: authorise the
read-only production inventory; answer D-S1, D-F13, D-P1–3 and D-ID1–5; approve each migration separately and commit
it in the same change that applies it; ship the priority cutover only together with the Reception/Nurse UI change.

## 11. Rollback

Each new proposal file ends with its own rollback block.

```sql
-- clinical_records_access.sql
drop function if exists public.get_patient_clinical_history(uuid, timestamptz, uuid, int);
grant execute on function public.start_consultation(uuid), public.call_next_patient() to authenticated;  -- restores F15
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
