# Staged migration plan — PR #36 security proposals

**Status: plan for independent review. Nothing applied; no production SQL run by this session.**
Basis: PR #36 revision 5 (`6289d5f`), §R5 of `clinical_records_access.md`, the committed migrations, and the
read-only production inventory **reported** by the reviewer (not re-run here).

| Source | Fact |
|---|---|
| Reported (production, read-only) | catalog 4/19 · 1/14 · 0/11 true; 14 public tables with RLS; broad anon/authenticated privileges incl. TRUNCATE; legacy clinical/priority/merge/destructive RPC grants present; 63 migrations recorded; `pgcrypto` and `supabase_vault` installed; identity HMAC secret absent |
| Verified locally | the same three catalog scores on a fresh replay of the 63 committed migrations; branch app/lib/components/e2e code is identical to `origin/main` `35c7ae9`, so compatibility below is judged against `main` |

The identical scores suggest no drift **in the asserted objects only**. They do not prove that function bodies or
other policies match; gate G1 closes that.

---

## 1. New findings from the reconciliation

- **R1 — the broad grants cover all 14 tables, not 4.** In the local baseline (and, as reported, in production)
  `anon` and `authenticated` hold `TRUNCATE` (plus `REFERENCES`, `TRIGGER`, and table-level DML gated only by RLS) on
  every public table. The proposals tighten only `consultation_notes`, `patient_vitals`, `consultations` and
  `queue_entries`. The other ten tables are `appointments`, `clinic_hours`, `clinic_settings`, `clinics`,
  `notifications`, `nurse_actions`, `profiles`, `queue_events`, `services` and `staff_invitations`. That needs a
  separate grant-hygiene migration (M1b below). It is **drafted here only, not yet tested locally**.
- **R2 — severity correction for F7/R1.** PostgREST and pg_graphql expose no TRUNCATE operation, and `anon` and
  `authenticated` cannot open database sessions. So TRUNCATE is reachable only if one of those roles gets SQL
  execution: a future SECURITY INVOKER function with dynamic SQL, or a misconfiguration. That makes it a
  **least-privilege / defence-in-depth** issue, not a directly exploitable one. Earlier revisions said "High" — that
  overstated it. The directly exploitable issues are F1/F2 (clinical reads), F3–F6/F10/F11 (forgery), F8/F16
  (cross-clinic identity data and merge), F12 (cross-clinic priority), F13/F14 (privileged RPCs).
- **R3 — Supabase default privileges.** New tables in `public` receive broad grants by default, which is how R1
  arose. Every new migration must revoke explicitly; all proposal files do. Changing `ALTER DEFAULT PRIVILEGES` is a
  separate decision (D-R3), because Supabase-managed roles depend on it.
- **R4 — cron is not in the inventory.** F14's safety depends on the `send-appointment-reminders` job running as
  `postgres`. Add a read-only check: `select jobname, username, command from cron.job;`.

## 2. Comparison with the committed migrations

| Proposal | Replaces / drops (committed source) | Compatibility with deployed `main` |
|---|---|---|
| `clinical_records_access.sql` | Drops `notes_read/write/update`, `vitals_read/write/update` (`20261002003441`, after `20261006100008`), `consultations_nurse_write`, `queue_staff_update` (`20260805103110`). Revokes all grants on 4 tables. Revokes `start_consultation`, `call_next_patient` (`20260805171832`). Adds the `private` schema and helpers, `get_patient_clinical_history`, 2 triggers. | **Compatible.** No deployed code reads or writes notes/vitals, writes `consultations`/`queue_entries` directly, or calls the two legacy RPCs. Every writer is a postgres-owned SECURITY DEFINER function (asserted). Nurse reads of their own consultations continue via `consultations_nurse_read_own`. |
| M1b grant hygiene (new) | Revokes `TRUNCATE, REFERENCES, TRIGGER` from anon/authenticated on the 10 remaining tables | **Compatible** (no client uses these privileges). DML grants are left unchanged here: RLS already gates them, and tightening them needs per-table analysis (D-R1). |
| `function_privileges_hardening.sql` | Revokes EXECUTE on `send_appointment_reminders` (granted to authenticated in `20260814083222`) and `reset_demo_state` (`20260809004301`) | F14 **compatible** (cron runs as postgres; gate R4). F13 **breaks `e2e/helpers.ts` live suites by design**, so it waits for D-F13. |
| `profiles_identifier_access.sql` | Drops `profiles_select_admin`, `profiles_update_admin` (`20260804164222`), recreates `profiles_staff_read_clinic_patients` (`20260805171242`). Replaces `search_patients`, `find_duplicate_patients`, `merge_patient_profiles`. Adds `patient_scope`, merge core and `_with_reason`, the `patient_merge_audit` table. | **Compatible, with user-visible narrowing**: Staff page = own clinic; admin patient search and duplicates = clinic-linked; reception cannot find patients known only to other clinics; nurses cannot call `search_patients` (no nurse screen does). The deployed 2-argument merge keeps working. |
| `queue_priority_reception.sql` Part 1 | New objects only | **Compatible** (additive). |
| `queue_priority_reception.sql` Part 2 | Revokes `set_emergency_priority` (`20260805171832`); replaces `check_in_patient` (`20260805171321`) | **Breaks the deployed Nurse emergency toggle (classic and V3)**. Must ship with the Reception/Nurse UI release. |
| `identity_documents_prototype.sql` | — | **Not deployable.** A prototype: grants are for service_role testing, there are no RPCs, no UI and no key. |

**Body-replacement risk:** `check_in_patient`, `search_patients`, `find_duplicate_patients` and
`merge_patient_profiles` are re-created from the committed text. If production's bodies differ (a dashboard edit,
say), the migration would silently revert that difference. Gate G1 compares md5s first.

## 3. Staged plan

Each stage is a **separate migration** (independent approval and rollback), committed to `supabase/migrations/` in
the same change that applies it. Versions must equal what Supabase records (lesson of #34). The order puts the
directly exploitable gaps first, and DB-only changes before coordinated releases.

| Stage | Migration | Fixes | Independent? | Prerequisites |
|---|---|---|---|---|
| **S1** | M1a `clinical_records_access` | F1–F7, F9–F11, F15 | **Yes** — DB only | G1, G2 |
| **S1** | M1b grant hygiene (10 tables) | R1 | **Yes** | draft → local test → G1 |
| **S1** | M1c F14 revoke (`send_appointment_reminders` only) | F14 | **Yes** | R4 cron check |
| **S2** | *App first:* explicit clinic filter on the Admin Staff page (works on old and new DB) | defence in depth | app-only, safe before S2 DB | normal PR |
| **S2** | M2 `profiles_identifier_access` | F8, F16, Staff-page leak, rev-3 merge hole | **Yes** (visible narrowing) | G1 md5 of 3 functions; announce the behaviour change |
| **S3** | M3 priority Part 1 (additive) | groundwork | **Yes** | **after M1a** (otherwise direct `queue_entries` updates could bypass the audit) |
| **S4** | *App:* Reception V3 priority control + escalation inbox; Nurse "escalate"; remove the Nurse toggle (classic + V3) | revised BR-10 | **Coordinated** | M3 applied |
| **S4** | M4 priority Part 2 (cutover) | F12 | **Coordinated** — apply right after the S4 app is live in production | S4 deployed and verified |
| **S5** | *Test infra:* move destructive live suites off production (`e2e/helpers.ts`) | D-F13 | test-only | — |
| **S5** | M5 F13 revoke (`reset_demo_state`) | F13 | after S5 test change | S5 merged |
| **S6** | Nurse V3 Phase 3 screens (types regenerated) | feature | app | M1a |
| **S7** | Identity documents: real migration written from the prototype + operator creates the Vault key + registration/walk-in RPCs + Patient/Reception V3 UI → backfill → enforcement → later drop `profiles.id_number` | supervisor req. 1 | **Coordinated, multi-release** | separate design approval |
| **S8** | Admin V3 without routine merge; then revoke the 2-argument merge | merge cutover | coordinated | M2, Admin V3 |

S1's three migrations may share one window but are applied and verified one at a time.

## 4. Verification gates

**Pre-deployment (every migration)**
- **G1 drift:** full `production_inventory.sql` output diffed against the local-baseline output (ignoring timestamps
  and Vault names). For each object the migration drops or replaces, the production policy text or function md5 must
  equal the committed definition. Any difference blocks the migration until it is rebased on production.
- **G2 local replay:** the exact migration file, under its final version name, applied to a fresh local stack. The
  relevant probes (`PHASE=proposed`, scoped to the stage) and `regression_workflows.mjs` must pass, plus the local
  Playwright specs for any stage touching queue or nurse flows.
- **G3 deployed code:** confirm Vercel production is at the commit assumed here (`35c7ae9` or a successor), and grep
  that commit for every revoked or dropped object.
- **G4 read-only counts** (no row content): rows in `consultation_notes` / `patient_vitals`, number of clinics,
  `cron.job` owner. A single-clinic production makes the cross-clinic changes behaviour-neutral today.
- **G5 approval and notice:** written approval of this migration; group notified (shared database, previews
  included); rollback SQL reviewed and ready.

**Post-deployment**
- **P1 catalog:** run the read-only catalog files; the expected true rows per stage are in §5. No previously true row
  may turn false.
- **P2 health:** `system_health_check()` and `_v2()` — no new FAIL or WARN compared with the pre-deploy run.
- **P3 migration record:** the version is in `supabase_migrations.schema_migrations`, and the stored statement's
  sha256 equals the committed file (the #32/#33 procedure).
- **P4 read-only smoke** on production as each role: patient dashboard, reception queue/check-in screen (load only),
  nurse queue, admin staff/reports, public display.
- **P5 write smoke** (check-in → call → end on one designated synthetic patient) **only with explicit
  authorisation**, since it writes to the shared database.
- **P6 monitor** API errors (401/403/42501) for 24 h; if a legitimate path fails, prefer a forward fix to a rollback
  (a rollback re-opens the vulnerability).

## 5. Approval checklists

**M1a — clinical records access** (`clinical_records_access.sql`)
- [ ] G1: production has exactly the 8 policies to drop and no other policies on the 4 tables
- [ ] G1: `private` schema absent, or present with a known ACL
- [ ] G3: no deployed caller of `start_consultation` / `call_next_patient` / direct writes
- [ ] G4: clinical row counts recorded
- [ ] P1: `assert_catalog.sql` 19/19
- [ ] P4: nurse queue and dashboard load; reception queue loads
- [ ] Rollback ready: section 11 of `clinical_records_access.md` (re-opens F1–F11; functional emergencies only)

**M1b — grant hygiene, 10 tables** (to be drafted)
- [ ] Draft reviewed; local replay plus full probe/regression run
- [ ] P1: an inventory section-3 re-read shows no TRUNCATE/REFERENCES/TRIGGER for anon/authenticated on any public table
- [ ] Rollback: re-grant the three privileges

**M1c — F14**
- [ ] R4: the cron job runs as `postgres`
- [ ] P1: the F14 row in `assert_catalog_priority.sql` is true
- [ ] P6: the next reminders cron run succeeds (`cron.job_run_details`, read-only)
- [ ] Rollback: `grant execute … to authenticated`

**M2 — profiles / identity data**
- [ ] G1: md5 of `search_patients`, `find_duplicate_patients`, `merge_patient_profiles` equals the committed definitions; 3 policies present as committed
- [ ] Behaviour change announced (Staff page, admin search and duplicates, reception cross-clinic search)
- [ ] S2 app filter deployed first (recommended)
- [ ] P1: `assert_catalog_profiles.sql` 14/14
- [ ] P4: admin Staff page, reception patient search, check-in confirmation (ID/DOB visible for linked patients)
- [ ] Rollback: export `patient_merge_audit`, then the file's rollback block

**M3 — priority Part 1**
- [ ] M1a applied and verified
- [ ] P1: priority catalog rows 1, 2, 5, 6, 7, 8, 9 true (7 of 11)
- [ ] Rollback: drop the new objects, after exporting the two audit tables

**M4 — priority Part 2 (cutover)**
- [ ] S4 app live in production; Nurse toggle gone (classic and V3); Reception control verified on a preview against the *current* DB, which works because Part 1 is additive
- [ ] G1: `check_in_patient` md5 equals `20260805171321`
- [ ] P1: priority rows 3 and 4 true (9 of 11 with M1c)
- [ ] P4/P5: Reception sets and clears priority with a reason; queue order is correct
- [ ] Rollback: re-grant `set_emergency_priority` and restore `check_in_patient` (only useful while the old UI is still deployed)

**M5 — F13**
- [ ] S5 merged: no test or tool calls `reset_demo_state` as an app user
- [ ] P1: the F13 row is true (11/11)
- [ ] Operator confirms a reset from the SQL editor (postgres) still works
- [ ] Rollback: `grant execute … to authenticated`

**S7 — identity documents:** separate approval package (migration written from the prototype without its
service_role grants, registration RPCs, the operator creating `identity_document_hmac_key_v1`, a backfill runbook).
Not part of this plan's approvals.

## 6. Decisions needed

- **Approve the stage order**, in particular M1a first with M1b and M1c in the same window.
- **D-R1:** draft M1b now (TRUNCATE/REFERENCES/TRIGGER only), and leave per-table DML tightening to later work?
- **D-R3:** leave Supabase default privileges unchanged and rely on per-migration revokes?
- **Authorise G1:** a diff of the full production inventory output against the local baseline. This needs the raw
  output from the reviewer's run, or a fresh read-only run.
