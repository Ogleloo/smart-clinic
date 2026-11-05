# Demonstration runbook — 6 November 2026

Written for whoever is driving the demonstration. Everything here is either a
step to perform or a thing to avoid; nothing in it is optional reading.

---

## 1. Three migrations are committed but NOT applied

`fix/demo-polish` adds three migration files. None of them has been run. The
database still has the old behaviour until someone applies them.

| File | What it does | Safe to apply during the day? |
|---|---|---|
| `20261105131920_nurse_title_naming.sql` | Renames `Sr. X` → `Nurse X` for nurses; updates `reset_demo_state()` to match either spelling | Yes |
| `20261105132322_one_identity_per_profile.sql` | Trigger refusing a duplicate `id_number`; `handle_new_user` drops an already-registered ID instead of failing signup | Yes |
| `20261105132831_pin_search_path_remaining_functions.sql` | Pins `search_path` on the two functions the Supabase advisor flags | Yes |

All three leave currently-deployed code working: nothing in `app/`, `lib/` or
`components/` matches on a nurse's name, and the identity trigger only inspects
the value being written, so existing rows are untouched.

**Apply them in filename order.** Either paste each file into the Supabase SQL
editor, or:

```bash
npx supabase link --project-ref bffhjvpkfivtbzqielve
npx supabase db push
```

`db push` applies only migrations not already in
`supabase_migrations.schema_migrations`, so it will pick up exactly these three.
Confirmed on 2026-11-05: 66 files in `supabase/migrations/`, 63 rows recorded
remotely. If those two numbers are not 3 apart when you run it, stop and find
out why before pushing — something was applied without being committed, which
has happened on this project before.

### Verify immediately after

```sql
-- 1. the rename took, and nothing is still titled "Sr."
select full_name, role, is_on_duty from public.profiles where role = 'nurse' order by full_name;

-- 2. the duplicate guard exists
select tgname from pg_trigger where tgrelid = 'public.profiles'::regclass and not tgisinternal;

-- 3. nothing regressed
select * from public.system_health_check();      -- expect 13 PASS + 1 INFO
select * from public.system_health_check_v2();   -- expect 10 PASS
```

Expected after step 1: `Nurse Botha`, `Nurse Mabaso`, `Nurse Pillay`, and
`Tshepo Cleopatra Baartman` unchanged — a nurse registered under their own name
keeps it; the migration only strips the `Sr. ` title.

### If you run `reset_demo_state()`

Say so in the group chat first — production, every preview and local dev share
one database, so it resets whatever anyone else is looking at. It is safe to run
either before or after these migrations: the function now matches both the old
and the new spelling on purpose.

---

## 2. One-time email codes: what is actually happening

Not every signup receives its code. The record on this project:

- **gmail.com** — 35 accounts, 33 confirmed. Codes arrive in **24–51 seconds**
  typically; one took 6 minutes and one took 69 minutes (past expiry, so that
  person had to request a new code).
- **icloud.com** — 1 account, **0 confirmed**. The only non-Gmail consumer
  address tried, and it never completed.
- Every other domain in the database (`riverside.test`, `example.com`,
  `stu.unizulu.ac.za`, …) is seeded or was confirmed by SQL, so those tell us
  nothing about delivery.

So "works for some users, not all" is real, and the pattern in the available
evidence is **Gmail works, other consumer mail does not reliably**. What the
data cannot tell us is *why* — the auth logs for the iCloud attempt are past
their retention window, and the sender configuration is a dashboard setting
this repository cannot read. Two candidates, both consistent with the evidence
and neither confirmed:

1. **Sender reputation / filtering.** iCloud and Outlook are stricter than Gmail
   about unauthenticated senders. The mail would be silently dropped or
   junked — which looks exactly like "no code arrived".
2. **The hourly send cap.** Supabase's built-in email service is rate-limited
   per project and is explicitly not intended for production. Several signups
   close together will exhaust it, and the ones past the cap get nothing, with
   no error shown to the registrant.

To tell them apart, open **Supabase → Authentication → Emails** and check
whether custom SMTP is configured. If it is not, cause 2 is live and cause 1 is
likely too.

### For the demonstration

- **Use Gmail addresses only.** That is the one domain with 33 successful
  confirmations behind it.
- **Register one account at a time**, and wait for the code before starting the
  next. Back-to-back signups are what exhausts a send cap.
- The verify screen's "Resend code" has a **60-second cooldown** and reports the
  hourly cap honestly when it is hit ("Too many requests, please wait a few
  minutes"). If you see that message, the cap — not the code — is the problem.
- **Have a pre-confirmed account ready** so a failed delivery cannot stall the
  demonstration. Any of the existing seeded accounts works.

The fix, after the demonstration, is custom SMTP (a Gmail App Password or
similar) so delivery stops depending on a shared, rate-limited sender. That is
a dashboard change, not a code change.

---

## 3. The staff-invitation end-to-end test, without Docker

`e2e/admin-staff-invitations.spec.ts` (on PR #50) is classified **DESTRUCTIVE**,
so `e2e/support/guarded-test.ts` refuses to run it unless
`E2E_ENABLE_DESTRUCTIVE=1` **and** the Supabase URL is a plain
`http://localhost:<port>`. `e2e/support/local-supabase-guard.ts` rejects any
`supabase.co` host outright, so a throwaway *cloud* project will not satisfy it
either. Do not edit the guard to get around this — it exists because a
"localhost" dev server can be secretly wired to the shared project.

### What you can run right now, with no Docker and no database

PR #50's other three specs need no backend at all:

```bash
npm run test:e2e:offline -- e2e/staff-invitation-validation.spec.ts e2e/staff-invite-harness.spec.ts e2e/auth-v3.spec.ts
```

These cover the invitable-role rules, the status derivation
(pending/accepted/revoked/expired), the invite form's behaviour including the
input-preserving rejection path, and the verify screen's post-activation
routing. What they do **not** cover is the database's authorisation — that is
what the destructive spec is for.

### Option A — get a Docker daemon working (the automated path)

The Supabase CLI needs a Docker-compatible socket; it does not need Docker
Desktop specifically. On Windows 11 Home the usual blocker is WSL2 rather than
Docker itself:

```powershell
wsl --install            # then reboot
wsl --set-default-version 2
wsl --status             # must report WSL 2
```

If Docker Desktop still refuses, **Rancher Desktop** or **Podman Desktop** both
expose a Docker API that `supabase start` accepts. Then:

```bash
npx supabase start                      # prints the local URL, anon key, service key
npx supabase db reset                   # applies every migration in supabase/migrations
# seed the six test accounts, then:
LOCAL_SUPABASE_URL=http://127.0.0.1:54321 \
LOCAL_SUPABASE_ANON=<anon> \
LOCAL_SUPABASE_SERVICE=<service> \
E2E_BASE_URL=http://localhost:3000 \
E2E_ENABLE_DESTRUCTIVE=1 \
npx playwright test e2e/admin-staff-invitations.spec.ts
```

Note the outstanding gap recorded in the previous checkpoint: **there is no
committed local seed**, so the six test accounts have to be created by hand
before the spec can sign in. That is the real reason the destructive specs "run
nowhere", not Docker alone.

### Option B — verify the same properties by hand (the realistic path for tomorrow)

The spec's substance is database authorisation, and **most of its assertions are
reads or writes the database is supposed to refuse**, so performing them by hand
leaves nothing behind. Worked through on the Vercel preview, the complete
residue is a few *revoked* `staff_invitations` rows for one fake address — no
auth account is created and no profile's role changes at any point.

Sign in as the administrator on the preview, go to **Admin → Staff**, and:

| Step | Expected | Writes anything? |
|---|---|---|
| Invite `demo-invite@example.test` as Nurse | Row appears, status **Pending**; panel states plainly that no email was sent | 1 row |
| Invite the same address again, as Receptionist | Still one open invitation; the first shows **Revoked** | 1 row |
| Revoke the open one, then revoke it again | Second attempt refused ("already been used") | no |
| Invite using an address that already has an account | Refused: "An account already exists for this email address" | no |
| Invite with a malformed email, then with a blank name | Refused, each with its own message; **what you typed is still in the form** | no |
| Confirm the role dropdown offers only Nurse and Receptionist | No Admin option anywhere | no |
| Sign in as the receptionist and open the same screen | No invitations visible at all | no |

The last row is the important one — it is RLS being the boundary, not the UI
hiding a button. Finish by revoking any invitation left open.

**State this honestly if asked:** this is a manual walk-through of the admin
screen, not a run of the automated database-authorisation spec. It demonstrates
that the refusals happen; it does not prove they are enforced in the database
rather than in the browser. The three offline specs above, plus the
`SECURITY DEFINER` definitions in migration 0053, are the evidence for that.

---

## 4. Known issues that are NOT fixed, and what they look like

- **Two ID numbers are each held by several profiles.** Seven profiles, all with
  real logins. The new trigger stops any *new* duplicate; it does not remove
  these. Cleanup needs a decision about which accounts keep their ID — see
  `docs/proposals/one_identity_per_profile_cleanup.sql`. One of the seven is a
  nurse whose ID a strict global constraint would stop them from also holding as
  a patient, which is the decision to make. Nothing on screen exposes this.
- **133 queue entries are still `waiting`/`in_progress` on 25 past dates.** Every
  screen filters by today, so none of them is visible and the prediction engine
  reads consultations rather than queue entries — but `reset_demo_state()` only
  closes *today's*, so the backlog keeps growing. Harmless for the
  demonstration, worth a sweep afterwards.
- **PR #50 is merged** (2026-11-05, `654e26c`, squashed). It went in before
  `e2e/admin-staff-invitations.spec.ts` had ever been run, so the database
  authorisation it adds is reviewed but not test-proven. §3 above is the
  substitute; run it before the demonstration.
- **Leaked-password protection is off** (Supabase advisor). A dashboard toggle.
