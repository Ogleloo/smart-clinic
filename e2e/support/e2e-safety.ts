/**
 * Fail-closed safety rules for the Playwright suite. Pure functions, no I/O, so every rule is unit-tested without a
 * browser, a database or a network (e2e/e2e-safety.spec.ts).
 *
 * Why: the shared Supabase project (see PRODUCTION_PROJECT_REF in local-supabase-guard.ts) is production, and Vercel previews share it. A spec that
 * writes (check-ins, call/undo, settings saves, reset_demo_state) must never be able to run against it — not through a
 * missing variable, a typo, a value like "true", a dev server that quietly reads .env.local, or a spec nobody
 * classified. Three layers use these rules:
 *
 *  1. SPEC CLASSIFICATION. Every e2e/<name>.spec.ts is declared offline, read-only, self-guarded or destructive below. The
 *     config runs an ALLOWLIST of exactly those files (specMatchPattern): anything not declared — in any sub-folder, with any
 *     test-file extension — is never run, in any mode, and a test fails until someone classifies it.
 *  2. playwright.config.ts: destructive specs are only on the allowlist when E2E_ENABLE_DESTRUCTIVE=1; with it,
 *     evaluateE2eSafety() must find NO problem or the config throws and nothing runs; the config never auto-starts a
 *     dev server in that mode (it would read .env.local, normally production) — see web-server-plan.ts.
 *  3. At run time: the destructive specs use the guarded `test` (browser requests to any non-local Supabase host are
 *     blocked), a global setup proves the app SERVER reads the local stack (canary), and the destructive helpers
 *     refuse any target that is not a local origin.
 */
import { PRODUCTION_PROJECT_REF, resolveLocalTarget } from './local-supabase-guard'

// ---------------------------------------------------------------------------------------------------- classification

/**
 * OFFLINE: no backend at all — pure logic, or the mocked harness that intercepts and fulfils every request itself. They
 * sign in nowhere (they must not use the live helpers: ACCOUNTS, loginAs, ...).
 */
export const OFFLINE_SPECS = ['e2e-safety', 'nurse-v3-queue', 'reception-profile-validation']

/**
 * READ-ONLY (live): run by default against whatever project the app server is wired to — possibly the shared one. They may
 * sign in (an Auth session) and sign out, navigate and look. They must NOT submit anything a server could act on, not even
 * input that is expected to be rejected: no Skip/Save/Update-password/Book/Check-in clicks, no Server Action handling, no
 * forged or repeated submissions. Enforced by findMutationSubmissions() (read-only-audit.ts, static) and by safe-test.ts (browser level).
 */
export const READ_ONLY_SPECS = [
  'admin-v2',
  'clinic-hours',
  'logout',
  'nurse-v3-dashboard',
  'nurse-v3-queue-live',
  'reception-profile',
  'reception-queue',
]

/** OFFLINE + READ-ONLY (everything that may run by default without being self-guarded). */
export const SAFE_SPECS = [...OFFLINE_SPECS, ...READ_ONLY_SPECS]

/** Opt in through LOCAL_SUPABASE_* and prove their own local target (canary + browser guard); skip otherwise. */
export const SELF_GUARDED_SPECS = ['nurse-classic-skip.local', 'nurse-v3-skip.local']

/**
 * SUBMIT or WRITE: reset_demo_state, check-ins, call/undo/record a consultation, bookings, clinic-settings saves — and any
 * test that submits a mutation-capable action even when the submission is EXPECTED TO FAIL (forged queue ids, invalid
 * profile fields, a wrong current password, double-submit attempts). Disabled by default; they run only with
 * E2E_ENABLE_DESTRUCTIVE=1 against a verified local Supabase stack.
 */
export const DESTRUCTIVE_SPECS = [
  'appointment-cancel',
  'clinic-hours-edit',
  'dashboard-guard',
  'dashboard-queue-card',
  'idle-timeout',
  'nurse-undo',
  'nurse-v2',
  'patient-v3',
  'queue-explainability',
  'reception-checkin',
  'reception-profile-actions',
  'reception-queue-actions',
  'reception-walkin',
]

export type SpecClass = 'offline' | 'read-only' | 'self-guarded' | 'destructive' | 'unclassified'

export function classifySpec(name: string): SpecClass {
  const hits = [
    OFFLINE_SPECS.includes(name) && 'offline',
    READ_ONLY_SPECS.includes(name) && 'read-only',
    SELF_GUARDED_SPECS.includes(name) && 'self-guarded',
    DESTRUCTIVE_SPECS.includes(name) && 'destructive',
  ].filter(Boolean) as SpecClass[]
  return hits.length === 1 ? hits[0] : 'unclassified'
}

/** `foo.spec.ts` -> `foo`; `foo.local.spec.ts` -> `foo.local`. */
export const specName = (file: string): string => file.replace(/^.*[\\/]/, '').replace(/\.spec\.ts$/, '')

/**
 * Every file Playwright would treat as a test file by default (its default testMatch is `**\/*.@(spec|test).?(c|m)[jt]s?(x)`,
 * recursive). Used to prove nothing of that shape exists outside the classified top-level list.
 */
export const TEST_FILE_PATTERN = /\.(spec|test)\.[cm]?[jt]sx?$/i

/** The classified specs that may run: offline, read-only and self-guarded always; destructive only with the explicit opt-in. */
export function runnableSpecNames(destructiveEnabled: boolean): string[] {
  return [...OFFLINE_SPECS, ...READ_ONLY_SPECS, ...SELF_GUARDED_SPECS, ...(destructiveEnabled ? DESTRUCTIVE_SPECS : [])].filter(
    (n) => classifySpec(n) !== 'unclassified'
  )
}

const escapeRegex = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The ONLY files the config may run, as a Playwright `testMatch` regular expression: exactly `<testDir>/<name>.spec.ts` for
 * each runnable classified name. It is an allowlist, so a spec nobody classified, a spec in a sub-folder, a `.test.ts`, a
 * `.spec.tsx`/`.js`/`.mjs`… can never match, whatever its name — unlike a deny-list built from the files that happen to exist.
 * Case-sensitive on purpose. Accepts either path separator (Playwright matches against the native absolute path).
 * `only` narrows the allowlist further (the offline config passes OFFLINE_SPECS); it can never widen it.
 */
export function specMatchPattern(testDir: string, destructiveEnabled: boolean, only?: readonly string[]): RegExp {
  const dir = testDir
    .split(/[\\/]+/)
    .filter(Boolean)
    .map(escapeRegex)
    .join('[\\\\/]')
  const names = runnableSpecNames(destructiveEnabled)
    .filter((n) => !only || only.includes(n))
    .map(escapeRegex)
    .join('|')
  // `^[\\/]*` covers a leading separator (POSIX absolute paths); a Windows drive letter is part of `dir`. Nothing else is optional.
  return new RegExp(`^[\\\\/]*${dir}[\\\\/](?:${names})\\.spec\\.ts$`)
}

/**
 * Test-shaped files (any depth, any extension Playwright recognises) that are not a classified top-level `<name>.spec.ts`.
 * `relPaths` are relative to the e2e directory. Must be empty: such a file would be silently ignored by the allowlist, which
 * is safe, but it is also a test nobody will ever run, so it is reported.
 */
export function unclassifiedTestFiles(relPaths: string[]): string[] {
  return relPaths
    .map((p) => p.replace(/\\/g, '/'))
    .filter((p) => TEST_FILE_PATTERN.test(p))
    .filter((p) => p.includes('/') || !p.endsWith('.spec.ts') || classifySpec(specName(p)) === 'unclassified')
}

// ---------------------------------------------------------------------------------------------------- environment

type Env = Record<string, string | undefined>

export const HOSTED_SUPABASE_HOST = /supabase\.(co|in|net|com)\b/i
/** Variables worth scanning for a hosted/production target (the scan reports the NAME, never the value). */
export const SCANNED_NAMES = /supabase|e2e|local_|database|postgres|api_url|base_url|next_public|jwt|service_role|anon/i

/** A plain http://localhost|127.0.0.1:<explicit port> origin and nothing else (no path, query, credentials). */
export function isLocalOrigin(value: string | undefined): boolean {
  if (!value) return false
  let u: URL
  try {
    u = new URL(value.trim())
  } catch {
    return false
  }
  return (
    u.protocol === 'http:' &&
    (u.hostname === 'localhost' || u.hostname === '127.0.0.1') &&
    !!u.port &&
    u.pathname === '/' &&
    !u.search &&
    !u.hash &&
    !u.username &&
    !u.password &&
    !value.toLowerCase().includes(PRODUCTION_PROJECT_REF)
  )
}

/** localhost and 127.0.0.1 are the same machine. */
export function sameLocalOrigin(a: string | undefined, b: string | undefined): boolean {
  if (!isLocalOrigin(a) || !isLocalOrigin(b)) return false
  const norm = (v: string) => {
    const u = new URL(v)
    return `${u.hostname === 'localhost' ? '127.0.0.1' : u.hostname}:${u.port}`
  }
  return norm(a!) === norm(b!)
}

/** Throws unless `url` is a plain local origin. Used by every helper that writes shared state. */
export function assertLocalSupabaseUrl(url: string | undefined, action: string): void {
  if (!isLocalOrigin(url)) {
    throw new Error(
      `${action} is destructive and only runs against a local Supabase stack, never the shared project. ` +
        `The configured URL is ${url ? `"${url}"` : '(not set)'}, which is not a plain http://127.0.0.1:<port> or http://localhost:<port> origin.`
    )
  }
}

export type Safety = { destructive: boolean; problems: string[] }

/**
 * Decides whether destructive testing may be enabled and lists EVERY reason it may not. `destructive` is true for any
 * non-empty, non-"0" E2E_ENABLE_DESTRUCTIVE (so "true" or "yes" are not silently treated as off); `problems` must then
 * be empty or the caller must refuse to run. Problem texts name variables, never secret values.
 */
export function evaluateE2eSafety(env: Env): Safety {
  const raw = (env.E2E_ENABLE_DESTRUCTIVE ?? '').trim()
  if (raw === '' || raw === '0') return { destructive: false, problems: [] }

  const problems: string[] = []
  if (raw !== '1') problems.push(`E2E_ENABLE_DESTRUCTIVE must be exactly "1" to enable destructive tests (or unset / "0" to disable), got "${raw}"`)

  // Any variable that points at the shared/hosted project makes the whole run unsafe — whatever it is called.
  for (const [name, value] of Object.entries(env)) {
    if (!value || !SCANNED_NAMES.test(name)) continue
    if (value.toLowerCase().includes(PRODUCTION_PROJECT_REF) || HOSTED_SUPABASE_HOST.test(value)) {
      problems.push(`${name} refers to the shared/hosted Supabase project; destructive tests are only allowed against a local stack`)
    }
  }

  // The same verified local target the self-guarded suites use: LOCAL_SUPABASE_URL/_ANON/_SERVICE + E2E_BASE_URL.
  const target = resolveLocalTarget(env)
  if (target.state === 'unconfigured') {
    problems.push('LOCAL_SUPABASE_URL, LOCAL_SUPABASE_ANON, LOCAL_SUPABASE_SERVICE and E2E_BASE_URL must all be set (a local Supabase stack and the app wired to it)')
  } else if (target.state === 'invalid') {
    problems.push(...target.reasons)
  }

  // The specs and helpers read E2E_SUPABASE_*: they must be exactly the local stack — never defaulted, never different.
  if (!env.E2E_SUPABASE_URL?.trim()) problems.push('E2E_SUPABASE_URL is not set (it must equal LOCAL_SUPABASE_URL)')
  else if (!isLocalOrigin(env.E2E_SUPABASE_URL)) problems.push('E2E_SUPABASE_URL is not a plain local origin (http://127.0.0.1:<port>)')
  else if (!sameLocalOrigin(env.E2E_SUPABASE_URL, env.LOCAL_SUPABASE_URL)) problems.push('E2E_SUPABASE_URL differs from LOCAL_SUPABASE_URL')
  if (!env.E2E_SUPABASE_ANON_KEY?.trim()) problems.push('E2E_SUPABASE_ANON_KEY is not set (it must equal LOCAL_SUPABASE_ANON)')
  else if (env.E2E_SUPABASE_ANON_KEY.trim() !== (env.LOCAL_SUPABASE_ANON ?? '').trim()) problems.push('E2E_SUPABASE_ANON_KEY differs from LOCAL_SUPABASE_ANON')

  // A dev server started from this shell inherits this value; it must not point anywhere else.
  const nextPublic = env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  if (nextPublic && !sameLocalOrigin(nextPublic, env.LOCAL_SUPABASE_URL)) problems.push('NEXT_PUBLIC_SUPABASE_URL is set to something other than the local stack')

  return { destructive: true, problems }
}

/** The error the config throws; names every problem. */
export function unsafeConfigurationError(problems: string[]): Error {
  return new Error(`REFUSING TO RUN: unsafe destructive-test configuration. Nothing was sent anywhere.\n  - ${problems.join('\n  - ')}`)
}

// ---------------------------------------------------------------------------------------------------- read-only enforcement

/**
 * RPCs a read-only spec's browser may call: a POSITIVE allowlist (every other RPC name — including ones this list has never
 * heard of — is treated as a write and blocked). These are the read functions the app's client components call
 * (`grep "\.rpc("` in components/); PostgREST also refuses a GET on a volatile function, so GET /rpc/* needs no entry.
 * Each is declared STABLE in its latest migration, and PostgreSQL does not let a STABLE function modify the database (checked
 * when this list was written). Add a name here only after confirming the same of the new function.
 */
export const READ_ONLY_RPCS: ReadonlySet<string> = new Set([
  'available_nurses',
  'confidence_label',
  'find_duplicate_patients',
  'get_available_slots',
  'get_public_queue_display',
  'get_service_queue',
  'get_wait_estimate',
  'search_patients',
  'service_consultation_stats',
])

/**
 * True for a browser request to a Supabase API that would change data: any PATCH/PUT/DELETE, any POST to a table, a POST to
 * an RPC that is not on READ_ONLY_RPCS, any non-GET GraphQL request (a mutation travels in a POST body, which cannot be
 * told from a query here), auth changes other than signing in and out, storage writes and edge-function calls. Sign-in
 * (token) and logout are the only allowed session operations. Used by safe-test.ts, which aborts and reports such requests.
 */
export function isMutatingSupabaseRequest(method: string, url: string): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  const m = method.toUpperCase()
  const api = /^\/(rest|auth|storage|functions|graphql)\/v1(\/.*)?$/.exec(u.pathname)
  if (!api) return false
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return false
  const kind = api[1]
  const rest = api[2] ?? ''
  if (kind === 'auth') return !(m === 'POST' && (rest === '/token' || rest === '/logout'))
  if (kind === 'graphql') return true
  if (kind === 'rest') {
    const rpc = /^\/rpc\/([^/]+)$/.exec(rest)
    if (!rpc || m !== 'POST') return true
    let name: string
    try {
      name = decodeURIComponent(rpc[1])
    } catch {
      return true
    }
    return !READ_ONLY_RPCS.has(name)
  }
  return true // storage and edge functions: any non-read request
}

/** Live helpers that sign in or write; offline specs must not touch them. */
export const LIVE_HELPERS = /\b(ACCOUNTS|loginAs|createTestClient|resetDemoState|setStaffIdleTimeoutMinutes)\b/
