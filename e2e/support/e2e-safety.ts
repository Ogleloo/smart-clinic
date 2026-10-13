/**
 * Fail-closed safety rules for the Playwright suite. Pure functions, no I/O, so every rule is unit-tested without a
 * browser, a database or a network (e2e/e2e-safety.spec.ts).
 *
 * Why: the shared Supabase project (see PRODUCTION_PROJECT_REF in local-supabase-guard.ts) is production, and Vercel previews share it. A spec that
 * writes (check-ins, call/undo, settings saves, reset_demo_state) must never be able to run against it — not through a
 * missing variable, a typo, a value like "true", a dev server that quietly reads .env.local, or a spec nobody
 * classified. Three layers use these rules:
 *
 *  1. SPEC CLASSIFICATION. Every e2e/*.spec.ts is declared offline, read-only, self-guarded or destructive below. Anything not
 *     declared is treated as DESTRUCTIVE (the default fails closed) and a test fails until someone classifies it.
 *  2. playwright.config.ts: destructive and unclassified specs are ignored unless E2E_ENABLE_DESTRUCTIVE=1; with it,
 *     evaluateE2eSafety() must find NO problem or the config throws and nothing runs; the config never auto-starts a
 *     dev server in that mode (it would read .env.local, normally production).
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
 * forged or repeated submissions. Enforced by findMutationSubmissions() below (static) and by safe-test.ts (browser level).
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
 * Globs for Playwright's testIgnore. Without the explicit opt-in, everything that is not declared safe or self-guarded is
 * ignored — including specs nobody has classified yet.
 */
export function ignoredSpecGlobs(specFiles: string[], destructiveEnabled: boolean): string[] {
  if (destructiveEnabled) return []
  return specFiles
    .map(specName)
    .filter((name) => {
      const c = classifySpec(name)
      return c !== 'offline' && c !== 'read-only' && c !== 'self-guarded'
    })
    .map((name) => `**/${name}.spec.ts`)
}

// ---------------------------------------------------------------------------------------------------- environment

type Env = Record<string, string | undefined>

const HOSTED_SUPABASE_HOST = /supabase\.(co|in|net|com)\b/i
/** Variables worth scanning for a hosted/production target (the scan reports the NAME, never the value). */
const SCANNED_NAMES = /supabase|e2e|local_|database|postgres|api_url|base_url|next_public|jwt|service_role|anon/i

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

/**
 * Whether playwright.config.ts may start `npm run dev` itself. It must NOT when destructive testing is enabled or the
 * local-only suites are opted in: that server reads .env.local, which is normally the shared production project.
 */
export function mayAutoStartWebServer(env: Env): boolean {
  if (env.E2E_BASE_URL?.trim()) return false
  if (['LOCAL_SUPABASE_URL', 'LOCAL_SUPABASE_ANON', 'LOCAL_SUPABASE_SERVICE'].some((k) => env[k]?.trim())) return false
  if ((env.E2E_ENABLE_DESTRUCTIVE ?? '').trim() !== '' && (env.E2E_ENABLE_DESTRUCTIVE ?? '').trim() !== '0') return false
  return true
}

// ---------------------------------------------------------------------------------------------------- read-only enforcement

/** RPC names that write. Anything matching is blocked in the browser of a read-only spec. */
const MUTATING_RPC =
  /^(check_in|create_|next_|undo_|skip_|set_|end_|book_|cancel_|merge_|admin_|mark_|start_|call_|reset_|accept_|send_|update_|delete_|insert_|upsert_|register_|issue_|redeem_|replace_|request_|decline_)/

/**
 * True for a browser request to a Supabase API that would change data: any PATCH/PUT/DELETE, any POST to a table, a POST
 * to a write RPC, auth changes other than signing in and out, storage writes and edge-function calls. Sign-in (token) and
 * logout are the only allowed session operations. Used by safe-test.ts, which aborts and reports such requests.
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
  if (kind === 'graphql') return false
  if (kind === 'rest') {
    const rpc = /^\/rpc\/([^/?]+)/.exec(rest)
    return rpc ? MUTATING_RPC.test(rpc[1]) : true
  }
  return true // storage and edge functions: any non-read request
}

/** Names of controls that submit or change something. Matched against button names in read-only specs. */
const MUTATING_CONTROL =
  /\b(skip|save|update password|create account|register|sign up|confirm|book|check.?in|call next|next patient|undo|record|emergency|start session|end session|go (on|off) duty|off duty|on duty|remove photo|upload|submit|send|delete|remove|approve|merge|invite|revoke|reset|cancel (appointment|booking)|pay)\b/i

/**
 * A deliberately conservative STATIC tripwire for specs that run against a possibly-shared backend. Returns a description
 * for every pattern that submits, or prepares to submit, something a server could act on — including submissions that are
 * expected to be rejected. It is heuristic (it cannot see what a click ends up calling), which is why the browser-level
 * guard in safe-test.ts exists too, and why anything it cannot rule out belongs in a destructive spec. Comment lines are
 * ignored.
 */
export function findMutationSubmissions(source: string): string[] {
  const code = source
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n')
  const findings: string[] = []
  if (/next-action/i.test(code)) findings.push('tracks or handles Server Action POSTs ("next-action")')
  if (/\bforge\w*\b|\bpostData\b|route\.continue\(\s*\{/.test(code)) findings.push('rewrites or forges requests')
  if (/\[type=["']submit["']\]/.test(code)) findings.push('clicks a form submit button by selector')
  if (/\.requestSubmit\(|\.submit\(\)/.test(code)) findings.push('submits a form programmatically')
  if (/\.evaluate\([^]{0,400}?\.click\(\)/.test(code)) findings.push('clicks inside evaluate() (same-tick double-submit pattern)')
  if (/(getByLabel|locator)\(\s*['"`/#][^)]*password[^)]*\)\s*\.fill\(/i.test(code)) findings.push('types into a password field')
  const button = /getByRole\(\s*['"]button['"]\s*,\s*\{[^}]*?name:\s*(?:'([^']*)'|"([^"]*)"|\/((?:\\.|[^/\\])+)\/[a-z]*)[^}]*\}\s*\)/g
  for (const m of code.matchAll(button)) {
    const name = m[1] ?? m[2] ?? m[3] ?? ''
    if (!MUTATING_CONTROL.test(name)) continue
    const end = (m.index ?? 0) + m[0].length
    const after = code.slice(end, end + 80)
    const before = code.slice(Math.max(0, (m.index ?? 0) - 60), m.index ?? 0).replace(/\s+/g, ' ')
    const used = /^\s*(\.(first\(\)|last\(\)|nth\(\d+\)))*\s*\.(click|dblclick|press|tap|evaluate|dispatchEvent)\(/.test(after)
    const stored = /(const|let|var)\s+\w+\s*=\s*[\w.]*$/.test(before)
    if (used || stored) findings.push(`uses the "${name}" control`)
  }
  return findings
}

/** Live helpers that sign in or write; offline specs must not touch them. */
export const LIVE_HELPERS = /\b(ACCOUNTS|loginAs|createTestClient|resetDemoState|setStaffIdleTimeoutMinutes)\b/
