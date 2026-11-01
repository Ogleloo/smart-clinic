# Smart Nurse Allocation Advisor — research MVP

## Status (read this first)

| | |
|---|---|
| Integration | Integrated on branch `feat/nurse-allocation-advisor-research-mvp` as **draft PR #43**. |
| Preview | The Vercel preview of that branch **built successfully**. No authenticated preview acceptance has been done yet. |
| Merged | **No.** The PR stays a draft until an authenticated, read-only preview review is accepted. |
| Production | **Not deployed to production.** Nothing here has been released. |
| Clinical validation | **Not clinically validated.** Its inputs are synthetic; it holds no real nurse eligibility, coverage or competency data. |
| Testing | Offline only (pure model tests, source contracts, layout/accessibility tests). Never run against the shared Supabase project. |

It is a research and demonstration page, not a staffing tool.

Target baseline: `Ogleloo/smart-clinic` `main` at `c062a10e686c9795ed6a3d6a4d12b948f650ca83` (PR #42 merge).

## What exists in the integrated code

- **Route:** `/admin/allocation-advisor`, linked as **Allocation Lab** in the Admin V3 sidebar and mobile navigation. Admin-only (`requireRole('admin')`); read-only.
- **Model:** `lib/research/nurseAllocationAdvisor.ts` — a small, pure, deterministic TypeScript snapshot model. Its formulas are exactly those of the handoff package; the integration changed none of them.
- **Page body:** `components/admin/v3/AllocationAdvisorView.tsx` — a client-side scenario explorer, plus an *Observed service snapshot* of aggregate figures from the existing Admin loader.
- **Mobile and tablet presentation:** below 1280 px each table is shown as a list of cards that carries every value of every row; from 1280 px it is a table. A table that is ever narrower than its minimum width sits in a keyboard-focusable, labelled scroll region and shows the visible hint "Swipe or scroll horizontally to view more columns".
- **Tests:** `e2e/nurse-allocation-advisor.spec.ts` (model and source contracts) and `e2e/allocation-advisor-layout.spec.ts` (layout, accessibility, documentation status), both in the offline suite.
- **Not present, by design:** any action that assigns, moves, approves or notifies a nurse; any write to the database; any server action; any migration or RLS change.

## Purpose

Build a clear, read-only demonstration of the research question: when could transferring one idle, hypothetically cross-qualified nurse between two parallel services improve the mean start-of-consultation waiting time, and when should the algorithm abstain?

This is **not** an approved staffing plan. No transfer or approval action is implemented. The UI uses the Admin V3 shell; the only live data shown is an aggregate snapshot obtained by reusing `getAdminDashboardData` and passing service-level counts and estimates to the client. Those live values are **not fed into the simulation**. No individual patient or nurse details are exposed by the new page.

## Relation to the existing research

Two different things must not be confused:

| | Eight-round WANR research | This page's TypeScript snapshot model |
|---|---|---|
| What it is | A standalone discrete-event simulation programme run outside this repository, documented in `Smart_Clinic_Allocation_Research_Brief.md` (16 October 2026) | A small deterministic calculation over patients already waiting at time zero, written for a demonstration |
| Evidence | Eight completed synthetic rounds, 107,300 policy-day evaluations, no universally preferable policy | None of its own: it reproduces none of those results, estimates or intervals |
| Standing | The research record | An illustration of the trade-off, with illustrative thresholds |

The report documents eight completed synthetic simulation rounds, 107,300 policy-day evaluations, and no universally preferable policy. The next scientific milestone in that brief is clinical requirements/eligibility/coverage review and calibration, **not** the unapproved deployment of a real allocation engine.

The included TypeScript model is **not a port of the standalone Python WANR discrete-event simulator** and none of the original round-by-round estimates, confidence intervals, or data sources are reproduced. In particular it does not support a claim that the tested WANR activation time is optimal or that an eligible nurse exists in the real clinic.

This smaller model deliberately demonstrates the trade-off using a transparent snapshot; its output can be presented alongside the earlier research without pretending it is live clinical research evidence.

## What is modeled

- Exactly two illustrative parallel services, each with waiting patients, a fixed assumed mean consultation time, assigned nurses, and a count of busy nurses.
- Patients are all already waiting at **time zero**. Priority patients are first; the rest follow arrival order. There are no modeled future arrivals, dynamic priorities or emergency pathways.
- A nurse completes one consultation at a time. Each queued patient starts with the nurse whose predicted *next-free time* is earliest; the selected nurse is then occupied for the full mean consultation duration.
- Busy nurses cannot be moved and are assumed to have half the service's mean consultation time remaining. This is uncalibrated.
- At most one idle, hypothetically cross-qualified nurse can move. A donor retains at least the illustrative minimum number of nurses (default one), and a donor with waiting priority patients is excluded. The moved nurse is unavailable during a specified transfer delay.
- All moves are **hypothetical**: no approval, acknowledgement, RLS checks, clinic reassignment, notification, database write or staff identity.

## Four comparison policies

1. **Current distribution:** baseline, no move.
2. **Longest queue (count):** choose the feasible single transfer towards the service with at least two more waiting patients. Does not consider consultation duration; it can worsen mean waiting.
3. **WANR-inspired workload proxy:** consider single moves that reduce maximum per-nurse estimated workload by at least 10 minutes and 10% and raise donor pressure by no more than 30 minutes. These are historical *research-model* threshold ideas, not validated staffing requirements. The code is not the full original WANR policy.
4. **Next-free snapshot:** compare feasible moves by deterministic queue-start times. Accept a simulated move only if mean wait improves by at least two minutes and 10% and donor mean wait does not rise by more than 10 minutes, or if a service becomes served without exceeding that donor limit. These thresholds are invented **for illustrative comparison** and are not clinic approval rules.

The results table shows each service's mean, total mean and unserved count. Any unserved patients cause an unavailable overall mean rather than a fabricated wait. A no-move outcome is a valid research result.

## Critical missing evidence

- A verified nurse-to-service clinical-competency and eligibility matrix.
- Approved minimum service coverage and relief/break/shift/room constraints.
- Treatment-specific consultation-duration estimates, arrival rates and residual times.
- Patient priority fairness requirements, clinically acceptable donor harm, uncertainty bounds, overtime and transfer costs.
- Supervisor authority and a revalidation/rollback/audit protocol for changes.
- Validation with clinic stakeholders and an appropriate institutional approval process before use with real operations.

No score or output from this page authorizes a human or the system to move a nurse.

## Security and test constraints

The new route `app/admin/allocation-advisor/page.tsx` invokes `requireRole('admin')`, reuses the existing Admin aggregate loader and passes only non-identifying service information to the Client Component. The simulation module is pure. No migrations, grants, auth policy, server actions, queue mutation or staff update APIs are added.

Run the new `e2e/nurse-allocation-advisor.spec.ts` with `npm run test:e2e:offline`. It must be added to `OFFLINE_SPECS` and never uses live helper accounts or network traffic. The new route must also be manually checked in a Vercel preview with an existing admin account, **navigation and read-only observations only**. Vercel previews share the production Supabase project; do not manipulate nurse duty, staff records, patients or queues from the preview.

## What has and has not been verified

Verified (at the time of writing, on the PR #43 branch, offline):

- the pure model with `tsc` and the package's 14 Node test cases, including 400 seeded variations;
- TypeScript, ESLint and the production build, which lists the route;
- the complete offline Playwright suite, including the model/contract spec and the layout/accessibility spec;
- layouts at 1440, 390 and 320 px from the real component and the app's real compiled CSS;
- a successful Vercel **preview build**.

**Not** verified:

- an authenticated admin opening the route on the preview (the preview uses the production Supabase project, so that check is read-only navigation only);
- the interactive controls in a signed-in browser session;
- any clinical meaning of the output — see "Critical missing evidence" above.

Until the authenticated preview review is accepted, PR #43 remains a draft; after it is accepted the page is still a research prototype, not a validated staffing tool.
