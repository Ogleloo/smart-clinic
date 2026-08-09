# ADR-028: The waiting-room display uses a purpose-built anon RPC, not an anon RLS policy

## Status

Accepted (migration `public_queue_display`, 2026-08-08).

## Context

The waiting-room display board (`/display/[serviceId]`) has to run with
nobody signed in — it's a screen in the clinic, not a patient's own
device. Every other read in this system goes through Row Level Security
scoped to the caller's own `auth.uid()` (patient sees their own rows,
staff see their clinic's rows via role-checked policies). There is no
precedent anywhere in the schema for the `anon` role reading anything.

The board needs, per service: the token currently being served, the
next token, how many people are waiting, and a wait estimate with a
confidence label — the same shape of information `get_wait_estimate`
already computes for a signed-in patient, but aggregated across a whole
service queue instead of scoped to one queue entry, and reachable
without a session.

## Decision

Add one function, `get_public_queue_display(p_service_id)` — `STABLE
SECURITY DEFINER`, search_path pinned — and grant `EXECUTE` on it to
`anon`. Do not add an RLS policy that lets `anon` `SELECT` from
`queue_entries` (or a view over it) to serve the same screen.

The function returns exactly eight columns: `service_name,
now_serving_token, next_token, waiting_count, estimated_wait_minutes,
confidence, is_being_served, updated_at`. No `id`, no `patient_id`, no
`appointment_id`, no patient name — every value is either a token,
a count, or text describing a service. Given the same input, the worst
an anonymous caller can extract is "how busy is this queue right now,"
which is exactly what the board is for and what's already stencilled on
a printed token in every patient's hand.

This is deliberately the *only* function in the system grantable to
`anon`. Every other read stays behind RLS scoped to an authenticated
caller.

## Why not an anon RLS policy on `queue_entries`

**A policy is row-shaped, not response-shaped.** RLS decides which
*rows* a role can see; it does not decide which *columns* a query
against those rows is allowed to select. A `USING` clause permissive
enough for `anon` to read today's waiting entries for one service would
apply equally to `select patient_id, priority, checked_in_at from
queue_entries` as to the three or four columns the display board
actually needs. Restricting `anon` to safe columns would additionally
require column-level `GRANT`s kept in sync with the policy by hand —
two independent mechanisms that both have to be right, versus a
function whose `RETURNS TABLE(...)` is the entire contract in one place.

**The board's numbers don't live in one table.** `now_serving_token`
and `waiting_count` come from `queue_entries`; `estimated_wait_minutes`
and `confidence` come from `available_nurses`, `service_consultation_stats`,
and `confidence_label`. No RLS policy on any single table produces this
— it would still need a view or function to do the aggregation, at
which point a view exposed to `anon` has exactly the same "which
columns did I actually mean to expose" risk as a table policy, plus none
of the parameter validation a function gets for free (`p_service_id`
is checked against `services` and rejected with `Service not found` if
it's missing or deactivated, before anything else runs).

**Grants are easier to audit than policies.** `GRANT EXECUTE ON FUNCTION
get_public_queue_display TO anon` is one line, reviewed once, and its
entire anon-reachable surface is the function body. An RLS policy lives
on the table forever; every future column added to `queue_entries` (and
every future policy interaction on that table) has to be re-checked for
whether it's now anon-readable too. A function's return list doesn't
grow just because the underlying table did — widening what the board
exposes requires a deliberate, visible change to the function itself.

**No id ever leaves the boundary.** Even a heavily filtered `anon`
policy on `queue_entries` still returns real primary/foreign key values
in an `id` column. Handing an anonymous caller a live `queue_entries.id`
is surface area for a problem that doesn't exist yet — this function
never returns one, by construction.

## Consequences

- Any future unauthenticated-facing feature should follow the same
  shape: one `SECURITY DEFINER` function with a minimal, explicit
  return type and a targeted grant to `anon` — not a table/view RLS
  policy for the anon role. If a feature needs anon access to
  arbitrary columns or filters, that's a sign it needs a different
  function, not a wider one.
- `get_public_queue_display` returning `NULL` for `estimated_wait_minutes`
  and `confidence` (and `is_being_served = false`) when no nurse is on
  duty is treated as significant by every caller: the display board
  renders "Not currently being served" and never fabricates a number
  the clinic can't stand behind, matching the same honesty rule
  `get_wait_estimate` already applies for signed-in patients.
- The board polls this function every 15 seconds over plain
  request/response. It does not use the `queue-service:{id}` broadcast
  channel used elsewhere (`useQueueBroadcast`) — that channel is
  configured `private: true` and requires an authenticated realtime
  connection, which an anonymous screen will never have.

## Alternatives considered

- **Anon `SELECT` on a `queue_entries`-derived view.** Rejected: still
  row-shaped rather than response-shaped, still needs a second
  mechanism (column grants) to stay safe, and still doesn't produce the
  cross-table wait estimate without becoming a function in disguise.
- **Reuse `get_wait_estimate` with a shared/synthetic queue entry id.**
  Rejected: that function answers "where is *this* queue entry," scoped
  to one patient's row, not "how is this *service* doing" — it has no
  concept of aggregating across a service's queue, and RLS on
  `queue_entries` would block an anon caller from resolving the id in
  the first place.
- **A periodically refreshed materialized view behind a public cache
  layer.** Rejected as unnecessary operational overhead: a `STABLE`
  function doing a handful of indexed lookups every 15 seconds per
  active display screen is cheap enough that a caching layer would be
  solving a problem this system doesn't have.
