@AGENTS.md

# CLAUDE.md — standing instructions

Project: Smart Clinic Appointment & Queue Management System
Live: `smart-clinic-alpha.vercel.app` · Supabase project `bffhjvpkfivtbzqielve`

---

## Status: feature freeze

Functionality is complete. Do **not** add features. If testing reveals a
missing behaviour that blocks a real workflow, say so and wait for a decision —
do not build it unprompted. Ideas for later go in `Future_Features_V2.md`.

---

## Branch and preview workflow

Never work directly on `main` unless explicitly instructed.

```
fix/     a defect
feat/    new behaviour (rare — see feature freeze)
docs/    documentation only
chore/   tooling, config, dependencies
```

**Before pushing a branch**

1. Run the relevant Playwright specs
2. Run the full suite when the change touches a shared workflow
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
select * from public.system_health_check();      -- 14 assertions
select * from public.system_health_check_v2();   -- 9 assertions
select * from public.reset_demo_state();         -- known-good demo scenario
```

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
