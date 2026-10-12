# Staged migration plan — PR #36 security proposals (revision 2)

**Status: the staged approach is approved for PREPARATION ONLY. No migration is approved for production.**
Nothing is applied; this session ran no production SQL and made no production connection.
Basis: PR #36 revision 5 (`6289d5f`), the committed migrations, and the read-only production inventory **as reported by
the independent reviewer** (not re-run here).

| Source | Fact |
|---|---|
| Reported (production, read-only) | catalog 4/19 · 1/14 · 0/11 true; 14 public tables with RLS; broad anon/authenticated privileges incl. TRUNCATE; legacy clinical/priority/merge/destructive RPC grants present; 63 migrations recorded; `pgcrypto` and `supabase_vault` installed; identity HMAC secret absent |
| Verified locally | the same three scores on a fresh replay of the 63 committed migrations; the branch's app/lib/components/e2e code is identical to `origin/main` (`35c7ae9`), so compatibility below is judged against `main` |

Identical scores show no drift **in the asserted objects only**; gate G1 closes the rest.

## 0. Review decisions applied in this revision

| # | Decision | Where applied |
|---|---|---|
| 1 | Approve for preparation only; no migration approved | this header; §5 checklists |
| 2 | D-R1: draft M1b (TRUNCATE, REFERENCES, TRIGGER from anon/authenticated/PUBLIC on the 10 remaining tables; keep DML and service_role) | **`grant_hygiene_m1b.sql`, drafted and locally tested (§8)**. One addition beyond D-R1 needs your confirmation: Part B revokes `MAINTAIN` (PostgreSQL 17) — see §8 |
| 3 | D-R3: keep Supabase default privileges for now; automated checks that new tables/functions carry explicit, justified privileges | `assert_catalog_grants.sql` (implemented, §8); static migration linter specified (§4, G6) |
| 4 | Isolate destructive E2E tests earlier, parallel to S1 | new stage **S1-T** (§3, §7) |
| 5 | Remove any instruction to run `reset_demo_state` on production, including through the SQL editor | removed from this plan, `docs/ARCHITECTURE.md` and `function_privileges_hardening.sql` |
| 6 | Flag hardcoded demo credentials; propose isolation and rotation; do not rotate | **C0** below and §7 — this is the most urgent item |
| 7 | Replace incomplete rollback prose with complete, locally tested recovery scripts | §6 (requirement, status per migration; M1b done) |
| 8 | F14 cron check must verify owner and target without returning command text | `assert_catalog_priority.sql`, `production_inventory.sql` §10d |

## 1. Findings from the reconciliation

- **C0 — committed credentials for production accounts in a PUBLIC repository (new, potentially critical).**
  [fact] `gh repo view` reports the repository is **public**. `e2e/helpers.ts` contains the production project URL and
  the e-mail and **plain-text password of four accounts — patient, receptionist, nurse and admin**. Counted by matching
  the published passwords (never printed): all four appear in `docs/ARCHITECTURE.md` ("Test accounts" table), three in
  `scripts/verify.ts`, one each in `scripts/check-4b.ts`, `e2e/patient-v3.spec.ts` and migration
  `20260808154202_admin_account_and_profile_merge.sql` (which creates an account with its password in the SQL). The
  docs and scripts have carried them since August 2026 and the E2E helper since the first E2E commit (`6fec3ac`). The
  passwords are human-readable, patterned strings of 10–18 characters. They are deliberately **not reproduced** in
  this document.
  [not verified — no production access] whether those accounts exist in production and still accept those passwords.
  If they do, anyone on the internet can sign in as the clinic admin today, and with today's policies an admin can: read
  every profile in every clinic including ID numbers (F8), read all clinical notes and vitals of their clinic (F1),
  merge or edit profiles (F16), and run `reset_demo_state()` (F13). The nurse account reads all clinic notes (F2).
  Git history cannot be cleaned (public, forkable, cached); **rotation is the only remedy**. Proposed handling in §7 —
  not performed. Whether production holds real patient data is for the reviewer to state; if it does, ask the
  information officer whether the POPIA section 22 notification duties are engaged.
- **R1 — the broad grants cover all 14 public tables, not 4.** `anon` and `authenticated` hold TRUNCATE, REFERENCES and
  TRIGGER (and, on PostgreSQL 17, MAINTAIN) on every public table. Closed for 4 tables by `clinical_records_access.sql`
  and for the other 10 by M1b.
- **R2 — severity correction.** PostgREST and pg_graphql expose no TRUNCATE and the app roles cannot open SQL sessions,
  so R1 is least-privilege / defence in depth, not directly exploitable. The directly exploitable gaps are F1/F2,
  F3–F6/F10/F11, F8/F16, F12, F13/F14 — and C0 makes the admin/nurse-reachable ones reachable by anyone.
- **R3 — default privileges.** New public tables and functions inherit broad grants from Supabase's default ACL (visible
  in inventory §9). Kept for now (D-R3); `assert_catalog_grants.sql` fails when any table relies on them.
- **R4 — new finding in this revision: `anon` holds INSERT/UPDATE/DELETE on most tables with RLS as the only barrier**
  (`assert_catalog_grants.sql` INFO row lists them). Not changed by M1b (D-R1: preserve DML). Candidate for a later
  DML-hygiene migration *(decision D-R4)*.
- **R5 — MAINTAIN is invisible to `information_schema`.** The baseline ACL shows `arwdDxtm`; the `m` (MAINTAIN, PG17)
  never appeared in the inventory's privilege list. Production's PostgreSQL version should be read from the
  inventory header; Part B of M1b is version-guarded.

## 2. Comparison with the committed migrations

| Proposal | Replaces / drops (committed source) | Compatibility with deployed `main` |
|---|---|---|
| `clinical_records_access.sql` (M1a) | Drops `notes_read/write/update`, `vitals_read/write/update` (`20261002003441`, after `20261006100008`), `consultations_nurse_write`, `queue_staff_update` (`20260805103110`). Revokes all grants on 4 tables. Revokes `start_consultation`, `call_next_patient` (`20260805171832`). Adds `private` schema and helpers, `get_patient_clinical_history`, 2 triggers. | **Compatible.** No deployed code reads or writes notes/vitals, writes `consultations`/`queue_entries` directly, or calls the legacy RPCs. Every writer is a postgres-owned SECURITY DEFINER function. |
| `grant_hygiene_m1b.sql` (**drafted**) | Revokes TRUNCATE, REFERENCES, TRIGGER (+ MAINTAIN, Part B) from anon, authenticated, PUBLIC on 10 tables | **Compatible** — no client uses these privileges; existing FKs and triggers keep working (only *creating* them needs the privilege). DML untouched. Self-checking migration. |
| `function_privileges_hardening.sql` | Revokes EXECUTE on `send_appointment_reminders` (`20260814083222`) and `reset_demo_state` (`20260809004301`) | F14 compatible (cron runs as postgres; verified by the §10d check). F13 breaks the live `e2e/helpers.ts` suites by design → after S1-T. |
| `profiles_identifier_access.sql` | Drops `profiles_select_admin/update_admin` (`20260804164222`), recreates `profiles_staff_read_clinic_patients` (`20260805171242`); replaces `search_patients`, `find_duplicate_patients`, `merge_patient_profiles`; adds scope function, merge core, `_with_reason`, audit table | Compatible with visible narrowing (Staff page, admin search/duplicates, reception cross-clinic search). Legacy 2-arg merge keeps working. |
| `queue_priority_reception.sql` Part 1 / Part 2 | Part 1 new objects only; Part 2 revokes `set_emergency_priority` (`20260805171832`), replaces `check_in_patient` (`20260805171321`) | Part 1 additive. **Part 2 breaks the deployed Nurse emergency toggle** → coordinated release. |
| `identity_documents_prototype.sql` | — | **Not deployable** (prototype). |

**Body-replacement risk:** `check_in_patient`, `search_patients`, `find_duplicate_patients` and `merge_patient_profiles`
are re-created from the committed text; if production's bodies differ the migration silently reverts that difference.
Gate G1 compares fingerprints first.

## 3. Staged plan

Each stage is a **separate migration** with its own approval, committed to `supabase/migrations/` in the same change
that applies it, with the version Supabase records. **None is approved.**

| Stage | Work | Fixes | Independent? | Prerequisites |
|---|---|---|---|---|
| **S0** | **Credential containment (C0)** — verify, rotate, remove from tree (§7). Not a migration. **Status 2026-10-12:** rotation authorised by the project owner; tree clean-up done in draft PR #37 (one occurrence remains in an applied migration); **rotation NOT done** — the Claude Code environment had no service-role key and no password manager, so the authorisation's stop conditions applied. Owner runs `scripts/rotate-demo-passwords.ts` per `docs/proposals/credential_rotation_runbook.md` (on PR #37's branch). | C0 | needs its own approval; **should not wait for any migration** | owner action |
| **S1-T** | **Test isolation (parallel to S1)** — local seed, local-only destructive suites, env-based credentials, CI against a local stack (§7). App/test change only. | prerequisite of M5; supports S0 | independent | S0 decisions |
| **S1** | M1a `clinical_records_access` | F1–F7, F9–F11, F15 | Yes — DB only | G1–G6 |
| **S1** | M1b `grant_hygiene_m1b` (**drafted**) | R1 (10 tables) | Yes — DB only | G1–G6 |
| **S1** | M1c F14 revoke (`send_appointment_reminders` only) | F14 | Yes | §10d check |
| **S2** | *App first:* explicit clinic filter on the Admin Staff page; then M2 `profiles_identifier_access` | F8, F16, Staff-page leak | Yes (visible narrowing) | G1 md5s; announce |
| **S3** | M3 priority Part 1 (additive) | groundwork | Yes — **after M1a** | — |
| **S4** | *App:* Reception priority control + escalation inbox; Nurse escalate; remove the Nurse toggle. Then M4 priority Part 2 | revised BR-10, F12 | **Coordinated** | M3 |
| **S5** | M5 F13 revoke (`reset_demo_state`) — **moved up: needs only S1-T, not S4** | F13 | Yes, after S1-T is merged and no tool calls it as an app user | S1-T |
| **S5b** | Drop `reset_demo_state()` from production; keep the local fixture version | F13 (permanent) | Yes | S5 + decision D-F13b |
| **S6** | Nurse V3 Phase 3 screens | feature | app | M1a |
| **S7** | Identity documents (real migration, Vault key, RPCs, UI, backfill) | supervisor req. 1 | Coordinated, multi-release | separate package |
| **S8** | Admin V3 without routine merge; revoke the 2-argument merge | merge cutover | Coordinated | M2, Admin V3 |

**Order of urgency:** S0 first (an exposed credential defeats every database control below it), then S1 (M1a, M1b, M1c
together in one window, applied and verified one at a time), S1-T in parallel, then S5, S2, S3, S4.

## 4. Verification gates

**Pre-deployment (every migration)**
- **G1 drift:** full `production_inventory.sql` output diffed against the local baseline; for every object the migration
  drops or replaces, the production policy text or function md5 must equal the committed definition. Any difference
  blocks the migration until it is rebased on production.
- **G2 local replay:** the exact migration file, under its final version name, on a fresh local stack; the relevant
  probes at `PHASE=proposed`, `regression_workflows.mjs`, and local Playwright specs for any queue/nurse stage.
- **G3 deployed code:** production's commit confirmed; grep for every revoked or dropped object.
- **G4 read-only facts (no row content):** row counts of affected tables; number of clinics; cron job owner and target
  via inventory §10d (**boolean target flags, never command text**).
- **G5 approval:** written approval of that one migration; group notified (shared database, previews included).
- **G6 explicit privileges (D-R3):** `assert_catalog_grants.sql` run on the local replay *with the migration applied*
  and on production *after*; every table has RLS and no excess privileges; no function relies on the PUBLIC default.
  **Planned (not implemented):** a CI linter over `supabase/migrations/` requiring, for each new `create table` or
  `create function`, a same-file `revoke … from public, anon` and a `-- privileges:` justification comment, and
  rejecting `crypt('<literal>'` / literal passwords.
- **G7 complete rollback (§6):** the rollback script exists, passed `rollback_cycle.mjs`, and a deliberately incomplete
  script fails it.

**Post-deployment**
- **P1 catalog:** the stage's read-only catalog files; no previously true row may turn false.
- **P2 health:** `system_health_check()` and `_v2()` — no new FAIL/WARN versus the pre-deploy run.
- **P3 migration record:** version present in `supabase_migrations.schema_migrations`; stored statement hash equals the
  committed file.
- **P4 read-only smoke** per role (page loads only).
- **P5 write smoke** only with explicit authorisation, on one designated synthetic patient.
- **P6 monitor** API errors (401/403/42501) for 24 h; prefer a forward fix to a rollback when a legitimate path fails.

## 5. Approval checklists (no item below is yet approved)

**M1a — clinical records access**
- [ ] G1: production has exactly the 8 policies to drop and no others on the 4 tables; `private` schema absent or known
- [ ] G3: no deployed caller of `start_consultation` / `call_next_patient` / direct writes
- [ ] G4: clinical row counts recorded · G6 passes · G7 **rollback script written and cycle-tested (currently missing)**
- [ ] P1: `assert_catalog.sql` 19/19 · P4: nurse queue/dashboard and reception queue load

**M1b — grant hygiene, 10 tables (drafted)**
- [ ] G1: production ACLs of the 10 tables equal the local baseline (inventory §3, §4); production PostgreSQL version read
- [ ] Decision on Part B (MAINTAIN) · G2 done locally (§8) · G6 · G7 done locally (§8)
- [ ] P1: `assert_catalog_grants.sql` — the 10 tables clean (the 4 clinical ones clean once M1a is applied)
- [ ] P4: any role's pages load (nothing should change)

**M1c — F14**
- [ ] §10d: job `send-appointment-reminders` active, owner `postgres`, targets the function (flag only)
- [ ] P1: the F14 rows true · P6: the next cron run succeeds (`cron.job_run_details` status only, no command text)
- [ ] G7 rollback script missing

**M2 — profiles / identity data**
- [ ] G1: md5 of the 3 functions and 3 policies equal the committed definitions · behaviour changes announced
- [ ] Staff-page clinic filter deployed first · G7: rollback must export `patient_merge_audit` and restore the 3 function bodies **from the production snapshot** (missing)
- [ ] P1: `assert_catalog_profiles.sql` 14/14

**M3 — priority Part 1** · [ ] M1a verified · [ ] G7 (export both audit tables) missing · [ ] P1 priority rows 1, 2, 5–9 true

**M4 — priority Part 2 (cutover)**
- [ ] S4 app live and Nurse toggle gone (classic and V3) · [ ] G1: `check_in_patient` md5 equals `20260805171321`
- [ ] G7 rollback restores the function **and** the grant · [ ] P4/P5: Reception sets/clears with reasons

**M5 — F13 (`reset_demo_state`)**
- [ ] S1-T merged: nothing calls it as an app user (grep + the destructive suites run only on a local stack)
- [ ] P1: the F13 row true · [ ] G7 · **No step executes the function on production — not from the SQL editor, not by any role.**

**S7 identity:** separate approval package. **S0:** separate approval (§7).

## 6. Rollback requirement (replaces the earlier prose)

A migration is **not eligible for approval** until all of these exist:
1. **A complete rollback script** committed next to it (proposals: `docs/proposals/rollback/<name>_rollback.sql`; after
   approval: `supabase/rollbacks/<version>_<name>.sql`, outside `supabase/migrations/` so it is never auto-applied).
2. **Cycle test passes** (`supabase/tests/clinical_records_access/rollback_cycle.mjs`) on a local stack whose catalog
   equals the **production pre-deploy snapshot** (`catalog_snapshot.sql`): snapshot → apply → differs → rollback →
   **identical to the original** → re-apply → identical to the migrated state.
3. **Negative control:** a deliberately incomplete rollback fails the same test (done for M1b, §8).
4. **Data:** any step that would destroy audit data first exports it (named step). Data written by the migrated code
   (merges, priority events) is **not** undone by a schema rollback — stated in the script.
5. **Prior state from production:** where production differs from the local baseline, the script is regenerated from the
   production snapshot and the cycle test re-run.
6. A rule for choosing **forward fix versus rollback** (a rollback re-opens the vulnerability).

| Migration | Rollback script | Cycle-tested |
|---|---|---|
| M1b | `rollback/grant_hygiene_m1b_rollback.sql` | **Yes** (§8) |
| M1a, M1c, M2, M3, M4, M5 | **missing** — the earlier prose in `clinical_records_access.md` §11 is *not* sufficient | no — **blocks approval** |

## 7. Credentials and test isolation (S0 and S1-T) — proposals only, nothing executed

**S0 — contain the exposed accounts (needs separate approval; do not rotate before it).**
1. *Verify without signing in (reviewer, read-only):* for the four e-mails, check in `auth.users` that the account exists
   and compare its `encrypted_password` with the committed password using `crypt()` — a boolean, no login attempt:
   `select email, role-from-profiles, (encrypted_password = crypt('<password from e2e/helpers.ts>', encrypted_password)) as still_published from auth.users where email in (…)`.
   Also look (read-only) for sign-ins from unrecognised addresses since the repository became public
   (`auth.audit_log_entries`, `auth.sessions`).
2. *Contain:* set a new random password (≥ 24 characters, CSPRNG) for each account that exists, stored in the team
   password manager. **Sessions (local GoTrue v2.197 experiment, runbook §3):** the admin password change itself ends the
   user's Auth sessions; already-issued access tokens keep working for direct REST calls until the project's JWT expiry
   (default 1 h); a ban adds nothing; there is no admin endpoint to end sessions by user id. Production's Auth version and
   JWT expiry are unverified. Consider disabling the admin account until S1-T replaces its use. The live
   suites will fail — accepted, they are moved off production by S1-T.
3. *Remove from the tree:* credentials come from environment variables (`E2E_*`); local seed accounts get random
   passwords written to a gitignored file; the `docs/ARCHITECTURE.md` table, `scripts/verify.ts`, `scripts/check-4b.ts`
   and the specs stop carrying literals. Add secret scanning (GitHub push protection / gitleaks) and the G6 linter.
4. *Do not rewrite history:* the repository is public and forkable; treat every committed value as burned.
   Migration `20260808154202` stays (append-only) — rotation neutralises it.
5. *Reduce what an account can do:* test/demo accounts live in a dedicated demo clinic (D-ID5), never with a shared admin
   whose role spans real clinics; production gets no account that the test suite can sign into.
6. *Check password reuse* elsewhere by whoever chose them; decide with the information officer whether any breach
   notification duty is engaged (only if real personal information was reachable).

**S1-T — isolate destructive E2E tests (parallel to S1).**
- *Inventory:* 20 specs. `resetDemoState()` / `setStaffIdleTimeoutMinutes()` are called by 9
  (`appointment-cancel`, `dashboard-guard`, `dashboard-queue-card`, `idle-timeout`, `nurse-undo`, `patient-v3`,
  `queue-explainability`, `reception-checkin`, `reception-walkin`); 3 of those also write to tables directly
  (`appointment-cancel`, `patient-v3`, `queue-explainability`). The `*.local.spec.ts` files and the mocked
  harness are already safe.
- *Plan:* (a) commit a seed (`supabase/seed.sql`, run only by `supabase start` / `db reset`, never by a hosted push)
  that creates the demo clinic, services, settings and accounts with generated passwords — this also fixes the known
  gap that the committed migrations do not replay on an empty database; (b) Playwright projects: `local-destructive`
  (guarded by `e2e/support/local-supabase-guard.ts`, URL and keys from environment) and `live-readonly`;
  (c) `e2e/helpers.ts` takes URL, keys and accounts from the environment and **refuses any non-local URL for a mutating
  helper**; (d) a local-only fixture function replaces `reset_demo_state` for tests; (e) CI starts a Supabase stack
  and runs the destructive project there.
- *Vercel previews* use the production database, so UI tests that mutate run the app via `next dev` against the local
  stack, as the existing `.local.spec.ts` suites do.

## 8. M1b — what was drafted and tested (isolated local Supabase stack, 2026-10-12)

`docs/proposals/grant_hygiene_m1b.sql` (+ `rollback/grant_hygiene_m1b_rollback.sql`). Part A revokes TRUNCATE,
REFERENCES, TRIGGER; Part B (PostgreSQL 17+, version-guarded) revokes MAINTAIN — **an addition beyond D-R1, delete it if
not approved**; it is included because clinical_records_access.sql already clears it on 4 tables and the inventory could
not show it. The migration snapshots DML, column and service_role privileges first and **aborts the whole transaction** if
a table is missing, any excess privilege remains, or anything else changed.

| Run (fresh stacks; Stack A = baseline, Stack B = M1b alone) | Result |
|---|---|
| `probe_grants.mjs` baseline (excess privileges must *work* — each negative test proves it exercises the thing) | **48/48 hold** |
| `probe_grants.mjs` M1b applied alone | **48/48 hold** |
| — TRUNCATE as anon and authenticated on each of the 10 tables | works before / denied after (20 tests) |
| — REFERENCES (real FK creation), TRIGGER (real `create trigger`), MAINTAIN, 60-fact privilege grid | works before / denied after |
| — DML registry (80 facts), `profiles` column UPDATE, service_role (70 facts + real TRUNCATE) | identical before and after |
| — per-role API use: anon `clinic_hours` + `get_public_queue_display`; patient, reception, nurse, admin reads/writes; RLS still refuses anon inserts/updates and patient role change | allowed/denied exactly as before |
| — a new table with default privileges is flagged by `assert_catalog_grants.sql` | yes |
| `regression_workflows.mjs` (reception, nurse, admin, patient RPCs) | **24/24** before and after |
| `assert_catalog_grants.sql` | baseline: 14 tables flagged · M1b alone: **only the 4 clinical tables** · M1b + all other proposals: **7/7 true** |
| Health checks on a clean stack, before vs after M1b | **identical** (22 PASS · 1 INFO · 1 FAIL — the FAIL is pre-existing: an event-trigger function counted as anon-executable) |
| Rollback cycle (fresh un-migrated stack) | **3/3**: apply removes 80 facts; rollback restores all 581 catalog facts exactly; re-apply reproduces the migrated state |
| Negative control: incomplete rollback (omits `authenticated` and MAINTAIN) | **fails the cycle as intended** |
| Negative control: variant that also revokes UPDATE on `clinics`; variant naming a missing table | **both abort**; catalog unchanged after the aborted run |
| `production_inventory.sql` with the new §10d (cron owner/target flags, no command text) | runs locally; `assert_catalog_priority.sql` F14 precondition true |

Corrections made while testing (recorded for honesty): four of my first M1b tests did not exercise the privilege (a
temp-table FK cannot reference a permanent table; anon cannot execute the trigger function; PUBLIC never held MAINTAIN;
patients cannot read `clinic_settings`). They failed in the baseline run — which is exactly what that run is for — and
were fixed before the M1b run. A first rollback-cycle run started from the wrong state because of my runner's ordering;
rerun from a clean stack above.

**Not run:** the full clinical/profiles/priority/identity probes and the Playwright specs (unchanged by M1b; the
M1b + all-proposals combination was checked with `assert_catalog_grants.sql` and `regression_workflows.mjs` only); any
production or preview access.

## 9. Remaining blockers and decisions

1. **C0:** reviewer to verify (read-only) whether the four accounts exist and accept the published passwords; separate
   approval to rotate (S0). This should be decided before any migration.
2. **Part B (MAINTAIN):** keep or delete?
3. **D-R4:** tighten `anon` DML privileges (R4) in a later migration?
4. **D-F13b:** drop `reset_demo_state()` from production once the local fixture exists (S5b)?
5. **Rollback scripts** for M1a, M1c, M2, M3, M4, M5 are missing and block their approval.
6. **G1:** the raw production inventory output (not just the scores) is needed for the drift diff, plus the production
   PostgreSQL version.
7. Migration linter (G6) and S1-T are specified, not built.
