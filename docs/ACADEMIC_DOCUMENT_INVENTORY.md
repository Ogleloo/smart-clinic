# Academic document inventory — SRS, SDD, SPMP, Test Plan

Written 2026-11-01 against `main` @ `37e4ee6` (plus the documentation branch). Final documentation is due **3 Nov 2026 11:00 SAST**; presentation 6 Nov 2026.

## 1. What exists

**None of the four documents exists in this repository.** A search of every tracked file (names and extensions: `srs`, `sdd`, `spmp`, `test plan`, `.docx`, `.pdf`, `.pptx`, `.xlsx`) found no academic deliverable. There is no committed copy of any course template, so the structure required by the course is **not known from the repository** and is not assumed here. If these documents exist elsewhere (Drive, a submitted draft, a supervisor's template), they were not visible to this analysis.

The repository does hold engineering documents that can serve as *evidence* for them:

| File | What it is |
|---|---|
| `CLAUDE.md` | Working rules, workflow, architecture rules, testing rule |
| `docs/ARCHITECTURE.md` | Stack, schema summary, security model, auth, registration, prediction engine |
| `docs/V3_REQUIREMENTS.md` | Roles/terminology, Figma sources, per-role scope, cross-cutting requirements |
| `docs/SESSION_HANDOFF.md` | Dated engineering checkpoints, deviations from Figma, test results, decisions |
| `docs/FINAL_RELEASE_STATUS.md` | Release baseline: status, test evidence, limitations, security concerns, configuration |
| `docs/adr/ADR-028-…md` | The only architecture decision record present |
| `docs/PROPOSAL_profile_photos.md`, `docs/proposals/*` | Design proposals (photo storage, skip/next-patient fixes, credential runbook incl. §7 test safety) — not all applied |
| `README.md` | Overview, stack, run instructions |
| `supabase/migrations/` (63 files) | The database schema, policies and functions as committed |
| `supabase/tests/` | Four local Postgres test harnesses (avatar proposal, next-patient lock, skip authorisation, skip-waiting) |
| `e2e/` (26 spec files) | Playwright specs, classified in `e2e/support/e2e-safety.ts` |
| GitHub PRs #1–#38 | Dated change history with descriptions and test notes |

On the unmerged PR #36 branch (`feat/nurse-v3-patient-details-history`): `docs/proposals/supervisor_requirements.md`, `clinical_records_access.md`, `staged_migration_plan.md` and SQL drafts.

## 2. Gaps that matter for the documents

- **Requirement identifiers have no source document.** Code comments cite `BR-1`…`BR-10`, `FR-1.1`…`FR-6` and `ADR-003`…`ADR-029` (17 other ADR numbers are cited in code and comments), but only ADR-028 exists. Those requirements and decisions can be *quoted from the code comments* but there is no authoritative list; do not present them as a traceability matrix unless the originals are found.
- **No requirement-to-test traceability exists.** Tests are named after behaviour, not requirement IDs.
- **No project plan data**: no schedule, effort, resource, risk register or stakeholder list; only dated PRs and checkpoints.
- **No test plan, test cases-by-requirement, or test report**; test evidence is spread across specs, `SESSION_HANDOFF.md` and PR descriptions.
- `Future_Features_V2.md` (named in earlier revisions of `CLAUDE.md`) does not exist.
- Figma file `xKCONNQAkEBe56q0rbQuYC` is the design source for V3 screens but is outside the repository.

## 3. Mapping — repository evidence for each document

Headings below are **evidence groupings**, not a required document structure. Fit them to the course template.

### SRS (software requirements specification)

| Content | Evidence | Gap |
|---|---|---|
| Purpose, scope, users, roles (patient, receptionist, nurse, admin) and terminology | `README.md`; `docs/V3_REQUIREMENTS.md` (roles table); `docs/ARCHITECTURE.md` | Stakeholders/problem statement are not documented |
| Functional requirements per role | `docs/V3_REQUIREMENTS.md`; `docs/FINAL_RELEASE_STATUS.md` §2–§3; route list under `app/`; Figma frames | No numbered requirement list; FR/BR IDs exist only in code comments |
| Business rules (staff roles only by trigger/invitation; no estimate without a nurse on duty; timestamps in Africa/Johannesburg; one anon function) | `CLAUDE.md` "Architectural rules"; ADR-028; migrations | |
| Registration / identity requirements | `docs/V3_REQUIREMENTS.md` (registration); `lib/registrationValidation.ts`, `lib/profileValidation.ts`, `lib/passwordValidation.ts`; `docs/proposals/supervisor_requirements.md` (PR #36) | Passport country / document type not implemented |
| Non-functional: security (RLS, POPIA), accessibility (contrast fixes), timezone, performance notes | `CLAUDE.md`; `docs/SESSION_HANDOFF.md` (contrast, load times); PR #36 documents | No stated performance or availability targets |
| Constraints and assumptions (shared Supabase, Vercel, Gmail SMTP) | `docs/ARCHITECTURE.md`; `docs/FINAL_RELEASE_STATUS.md` §7 | |
| Out of scope / future | `docs/FINAL_RELEASE_STATUS.md` §8 | |

### SDD (software design description)

| Content | Evidence | Gap |
|---|---|---|
| Architecture (Next.js App Router, Server Actions, Supabase, Vercel; RLS as the security boundary; prediction engine in the database) | `docs/ARCHITECTURE.md`; `CLAUDE.md` | No architecture diagram |
| Data design (tables, relationships, RLS policies, functions, grants) | `supabase/migrations/`; `lib/types/database.types.ts`; `docs/ARCHITECTURE.md` schema section | No ER diagram; migrations do not replay on an empty database |
| Component / module design (shells per role, shared hooks, validators) | `app/`, `components/`, `lib/`; `docs/SESSION_HANDOFF.md` (per-feature design notes) | No component catalogue |
| Interface design | Figma V3 file; deviations list in `docs/SESSION_HANDOFF.md`; `app/globals.css` tokens | Figma is external |
| Key algorithms: queue ordering, wait estimate, atomic next/undo/skip | migrations `queue_engine_*`, `wait_estimate_*`, `next_patient_*`, `skip_*`; `docs/proposals/next_patient_no_key_update.md`, `skip_waiting_patient_atomic.md` | |
| Security design | `docs/ARCHITECTURE.md`; ADR-028; PR #36 proposals; `docs/proposals/credential_rotation_runbook.md` | Proposals are not applied |
| Design decisions | ADR-028 only; rationale in `SESSION_HANDOFF.md` and PR descriptions | Other ADRs cited in code are missing |

### SPMP (software project management plan)

| Content | Evidence | Gap |
|---|---|---|
| Process and workflow (branch types, PR flow, review before merge, preview verification) | `CLAUDE.md` "Branch and preview workflow", "Context-efficiency policy" | |
| Timeline and milestones as actually achieved | PR list with dates (#1 Aug 2026 … #38 1 Nov 2026), `git log`; V2 → V3 role-by-role order | No planned schedule or estimates |
| Deliverables and status | `docs/FINAL_RELEASE_STATUS.md` §2 | |
| Risks and issues | `docs/FINAL_RELEASE_STATUS.md` §5–§6; PR #36 `staged_migration_plan.md` (risk-ordered stages S0–S8, gates G1–G7) | No formal risk register |
| Configuration / change management | Migrations append-only and committed; `docs/proposals/` vs `supabase/migrations/` convention; squash-merge history | |
| Quality assurance approach | `CLAUDE.md` "Testing rule", "Safe testing" | |
| Team, roles, responsibilities, effort, budget | — | **Not in the repository** |

### Test Plan

| Content | Evidence | Gap |
|---|---|---|
| Test strategy and levels (offline unit/contract, real-page offline, read-only live, local-stack, database harnesses, health-check assertions) | `CLAUDE.md` "Safe testing"; `e2e/support/e2e-safety.ts`; `docs/proposals/credential_rotation_runbook.md` §7 | |
| Test environment and safety constraints (shared Supabase, no destructive runs, `E2E_*` variables, local stack) | same; `.env.example` (names only) | No committed local seed |
| Test items and cases | `e2e/*.spec.ts` (26 files); `supabase/tests/*`; `system_health_check()` / `_v2()` | No cases mapped to requirements |
| Results to date | `docs/FINAL_RELEASE_STATUS.md` §1 and §4 (432 offline tests passed on `main`; earlier runs dated in `SESSION_HANDOFF.md`) | Live and destructive suites not re-run for the release |
| Negative controls / defect evidence | PR #38 description and `SESSION_HANDOFF.md` ("negative controls") | |
| Known untested areas | `docs/FINAL_RELEASE_STATUS.md` §5 | Fresh-account identity persistence; staff invitation end-to-end; public display; visual review |
| Entry/exit criteria, schedule, responsibilities | — | **Not in the repository** |

## 4. Suggested next step

Obtain the course templates and the supervisor's expectations first, then draft in this order: SRS (the requirement list is the weakest piece), SDD (most evidence already exists), Test Plan (collect results and add a requirement mapping), SPMP (needs facts only the team has). Any numbers in these documents should be taken from `docs/FINAL_RELEASE_STATUS.md`, which states what each figure proves.
