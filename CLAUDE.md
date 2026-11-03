@AGENTS.md

# CLAUDE.md — standing instructions

Project: Smart Clinic Appointment & Queue Management System
Live: `smart-clinic-alpha.vercel.app` · Supabase project `bffhjvpkfivtbzqielve`

---

## Project status — V3 controlled development

V3 replaces the V2 screens role by role. Each role is a single body of
work — do not mix roles in one session.

The authoritative, evidence-graded status is `docs/FINAL_RELEASE_STATUS.md`.
Summary (merged to `main`; "implemented" is not "fully tested" — see that file):

| Role           | Status                    | Merged PRs / notes |
|----------------|---------------------------|--------------------|
| Patient V3     | ✅ Implemented            | #15, #16, #17, #20; registration changes #38 |
| Reception V3   | ✅ Implemented (Phases 1–4) | #19, #21, #25–#29; profile **photo** backend not applied |
| Nurse V3       | 🔶 Partial                | Dashboard #30, My Queue #31; Phase 3 (patient details / vitals / notes / history) **not started** — blocked on the PR #36 security gate. Classic `/nurse` screen remains the working screen |
| Admin V3       | 🔲 Not started            | Admin V2 (#13) is what is deployed |
| Public Display | 🔲 V3 not started         | V2 display board (#7) is what is deployed |

Open: **PR #36** (security proposals, docs/tests only, draft, nothing applied).

Do **not** add features outside the current task scope. `Future_Features_V2.md`
(named here in earlier revisions) does not exist in the repository; record
future ideas in `docs/FINAL_RELEASE_STATUS.md` §8 instead.

---

## Context-efficiency policy

Claude Code sessions must stay focused and lightweight.

**Session boundaries**
- One session = one related group of tasks (e.g. "build Reception V3 screens").
- Before switching to an unrelated task, save a checkpoint to
  `docs/SESSION_HANDOFF.md` and start a fresh session.

**Repository inspection**
- Read `CLAUDE.md` and `AGENTS.md` at the start of every session.
- Read other docs only when relevant to the current task.
- Use targeted `grep` / `glob` searches — do not scan unrelated directories.

**Task execution**
- Work only within the requested scope.
- Do not refactor unrelated code encountered during the task.
- Preserve existing security rules, RLS policies, and test coverage.

**Context handoff** — before ending a session with unfinished or
follow-up work, update `docs/SESSION_HANDOFF.md` with:
```
## Last checkpoint
Date, branch, what was done, what remains, any blockers.
```

**Session prompt template** (paste into Claude Code):
```
Task: [DESCRIBE THE SPECIFIC TASK]
Read CLAUDE.md and only the project documentation relevant to this task.
If the task continues previous work, read docs/SESSION_HANDOFF.md.
Use targeted repository searches. Do not scan unrelated directories.
Work only within the requested scope. Preserve existing security and testing requirements.
Keep the final report concise.
```

---

## Branch and preview workflow

Never work directly on `main` unless explicitly instructed.

```
fix/     a defect
feat/    new behaviour
docs/    documentation only
chore/   tooling, config, dependencies
```

**Vercel preview warning:** preview deployments isolate code but share
the production database. Do not run destructive tests against it, and do not
run `reset_demo_state()` against the shared project at all — PR #36 (unmerged)
treats it as a destructive function that must not be callable by ordinary
admins. Say so first if you believe an exception is needed.

**Before pushing a branch**

1. Run the relevant Playwright specs **that are safe** (see "Safe testing" below)
2. Run `npm run test:e2e:offline` whenever `lib/`, auth or validation changed
3. `npx tsc --noEmit` and `eslint`
4. Run the database assertions if security or database behaviour changed
5. Review `git diff` in full

**After pushing**

1. Test the Vercel preview deployment, not just localhost
2. Record what was verified in the pull request
3. Only merge to `main` after preview verification
4. Smoke-test production after the merge

---

## Migrations must be committed, not just applied

Production, preview and local development all share one Supabase project
(`bffhjvpkfivtbzqielve`). Applying a migration — via the CLI, the
dashboard SQL editor, or the Supabase MCP connector — makes it live
immediately, on whatever branch. None of that touches git.

**Every migration must be committed to `supabase/migrations/` in the
same change that applies it.** A migration applied but not committed
does not exist as far as this repo is concerned: clone the repo and you
get an application with no database. That already happened once — 43
migrations were applied live over the course of this project with zero
record in git, recovered after the fact in
`chore/migrations-into-version-control` by reading the SQL back out of
`supabase_migrations.schema_migrations`. Recovery worked this time only
because Supabase still had the original statements; it would not have if
the project were ever deleted or reset.

---

## The database is a shared singleton — read this before any migration

Preview deployments isolate **code**. They do not isolate **data**.
Preview, production and local development all use the same Supabase project.

Two consequences.

**1. A migration cannot be previewed.** The moment it is applied it is live in
production, whatever branch the code is on. There is no staging database. So
every migration must leave *currently-deployed production code* working:

- Adding a column, table or function — safe. Old code ignores it.
- Changing an existing function's behaviour — this is a production change.
  Verify against the deployed site, not only the branch.
- Tightening an RLS policy — this is a production change, immediately.
- Removing anything — expand first, remove later, and only once no deployed
  code depends on it.

Migrations are **append-only**. Never edit an applied migration; write a new one.

**2. Tests mutate shared state.** Running the suite, or `reset_demo_state()`,
affects the same records group members are testing against. Say so before
running anything destructive.

---

## Safe testing — shared Supabase restrictions

Every spec in `e2e/` is classified in `e2e/support/e2e-safety.ts`; an
unclassified spec does not run.

| Class          | May run against the shared project? | How |
|----------------|--------------------------------------|-----|
| offline        | n/a — no backend, nothing leaves the machine | `npm run test:e2e:offline` (dev server forced to a dead port) |
| read-only      | Yes — signs in and looks; a browser guard aborts any write | `npx playwright test`, credentials from `E2E_*` env vars |
| self-guarded `.local` | No — local Supabase stack only | `LOCAL_SUPABASE_*` set; refuses anything but `localhost` / `127.0.0.1` |
| destructive    | **No.** Disabled by default; the shared project is rejected | `E2E_ENABLE_DESTRUCTIVE=1` against a verified local stack — no committed local seed exists yet, so today they run nowhere |

Passing the offline suite proves validators, contracts and page behaviour with
no backend. It does **not** prove a real registration, email delivery, a database
write, RLS behaviour or realtime propagation. Do not report them as such.
Details: `docs/proposals/credential_rotation_runbook.md` §7.

## Testing rule

No change is committed without local verification. For every change:

1. Identify the behaviours affected
2. Test the happy path
3. Test the zero/empty state
4. Test the failure state
5. Test relevant edge cases
6. Test retry and double-submit if the action mutates data
7. Test authorisation if protected data is involved
8. Run relevant regression tests
9. TypeScript, then ESLint
10. Review the diff
11. Only then commit

Never weaken security, skip a failing test, or modify production data merely to
make a test pass.

**Prefer assertions to clicking.** An invariant expressible as a database fact
belongs in `system_health_check_v2()`, not in a manual checklist. Manual effort
is reserved for interface behaviour, realtime propagation, and hostile use.

```sql
select * from public.system_health_check();      -- 14 rows (13 PASS + 1 INFO at the last recorded run)
select * from public.system_health_check_v2();   -- 10 assertions at the last recorded run
```

`reset_demo_state()` exists but must **not** be run against the shared
project (see the preview warning above).

---

## Architectural rules that must not be broken

- **RLS is the security boundary.** There is no middle tier. Never add
  client-side `patient_id` or `clinic_id` filters as a substitute for policy.
- **A policy without a grant does nothing.** RLS narrows access; it never widens
  it. An `UPDATE` policy fails silently if `GRANT UPDATE` was never issued.
- **`CREATE FUNCTION` grants `EXECUTE` to `PUBLIC` by default.** Every new
  function needs an explicit `revoke ... from public, anon`. Security is
  opt-out, not opt-in. This has already caused one live data leak.
- **Exactly one function is `anon`-callable** — `get_public_queue_display()`.
  Asserted continuously. Do not add a second without an explicit decision.
- **`getUser()`, never `getSession()`.**
- **Passwords are never trimmed.** One rule (`lib/passwordValidation.ts`) governs
  every place a password is created or changed; sign-in deliberately does not
  use it, so existing accounts can still log in.
- **Staff invitations (database only — no UI, not called by the app) depend on verified email.** `accept_staff_invitation()`
  requires `email_confirmed_at`; with Supabase *Confirm email* OFF anyone could
  register an invited address first and claim the role. Do not switch Confirm
  email off.
- **All timestamps display in the clinic timezone** (`Africa/Johannesburg`),
  never the browser's or the server's (ADR-020).
- **The prediction engine runs in the database**, never in React.
- **Never state a number the system cannot justify.** No nurse on duty means no
  estimate — not a fallback, not a default, not a guess.
- **Filter explicitly even when RLS would suffice.** A query's row-count
  invariant is its own concern. `.single()` on an unfiltered query returned one
  row for a patient and twenty-five for staff — that was a live crash.
- **Mutations are Server Actions**, consistent with existing code.

---

## Reporting

State what was verified and what was not. If something is implemented but
untested, say so. If a test passed but did not exercise the intended path, say
that too — "the test passed" and "the test tested the thing" are different
claims, and conflating them has already produced a false pass in this project.
