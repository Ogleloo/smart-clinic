/**
 * Decides whether the Playwright config may start the Next.js dev server itself — and refuses when that server would be
 * wired to the shared (production) Supabase project.
 *
 * Why: `npm run dev` reads `.env.local`, which on most machines names the shared project. The old config started it
 * whenever E2E_BASE_URL was unset, so a plain `npx playwright test` quietly brought up an app configured against production
 * and pointed the read-only live specs (and the offline harness's shell fetch) at it. Now:
 *
 *   external  E2E_BASE_URL is set: the caller started the app and chose where it points. Nothing is started.
 *   none      destructive mode, or LOCAL_SUPABASE_* set without E2E_BASE_URL: never start a server (the config / specs check
 *             their own target); same as before.
 *   start     (offline mode) a dev server whose Supabase settings are forced to a dead local placeholder and whose secrets are
 *             blanked, so it cannot reach any real project, whatever .env.local says.
 *             (default mode) the app's own configuration — process environment over `.env.development.local`, `.env.local`,
 *             `.env.development`, `.env`, in the order Next.js reads them — names a plain local Supabase origin and nothing
 *             hosted anywhere.
 *   refuse    (default mode) anything else: a hosted/production URL, an unreadable or missing URL, a hosted reference in any
 *             related variable. The config then runs a command that prints WHY and exits non-zero, so the run stops with a
 *             message instead of silently contacting the shared project.
 *
 * Pure apart from loadNextEnvFiles(). Messages name variables and files, never values.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { HOSTED_SUPABASE_HOST, SCANNED_NAMES, isLocalOrigin } from './e2e-safety'
import { PRODUCTION_PROJECT_REF } from './local-supabase-guard'

type Env = Record<string, string | undefined>

export type Mode = 'default' | 'offline'

/** Where the offline dev server's Supabase client points: a closed local port, so nothing is ever reached. */
export const OFFLINE_SUPABASE_URL = 'http://127.0.0.1:9'
export const DEV_SERVER_COMMAND = 'npm run dev'

/** Next.js reads these in development, highest precedence first (the process environment beats all of them). */
export const NEXT_ENV_FILES = ['.env.development.local', '.env.local', '.env.development', '.env'] as const

export type EnvFiles = { values: Record<string, string>; origin: Record<string, string> }

/** Minimal dotenv parser: KEY=VALUE, optional `export`, quotes stripped, `#` comments. Enough to see WHICH variables a file sets. */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!m) continue
    let v = m[2].trim()
    const q = v[0]
    if ((q === '"' || q === "'") && v.lastIndexOf(q) > 0) v = v.slice(1, v.lastIndexOf(q))
    else v = v.replace(/\s+#.*$/, '')
    out[m[1]] = v
  }
  return out
}

/** The merged values Next.js would see from env files in `dir`, and which file each came from. Read-only; values stay in memory. */
export function loadNextEnvFiles(dir: string): EnvFiles {
  const values: Record<string, string> = {}
  const origin: Record<string, string> = {}
  for (const file of [...NEXT_ENV_FILES].reverse()) {
    const p = join(dir, file)
    if (!existsSync(p)) continue
    try {
      for (const [k, v] of Object.entries(parseEnvFile(readFileSync(p, 'utf8')))) {
        values[k] = v
        origin[k] = file
      }
    } catch {
      /* an unreadable file contributes nothing; the URL check below then refuses if the URL is missing */
    }
  }
  return { values, origin }
}

export type ServerPlan =
  | { kind: 'external'; reason: string }
  | { kind: 'none'; reason: string }
  | { kind: 'start'; reason: string; env?: Record<string, string> }
  | { kind: 'refuse'; reason: string }

const SECRETISH = /supabase|database|postgres|jwt|service_role|anon/i
const isHosted = (v: string) => v.toLowerCase().includes(PRODUCTION_PROJECT_REF) || HOSTED_SUPABASE_HOST.test(v)

/** Environment for the OFFLINE dev server: every Supabase/database/secret-looking variable blanked, the client URL a dead port. */
export function offlineServerEnv(env: Env, files: EnvFiles): Record<string, string> {
  const out: Record<string, string> = {}
  for (const name of new Set([...Object.keys(files.values), ...Object.keys(env)])) if (SECRETISH.test(name)) out[name] = ''
  out.NEXT_PUBLIC_SUPABASE_URL = OFFLINE_SUPABASE_URL
  out.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'offline-placeholder-not-a-key'
  return out
}

export function planWebServer(input: { mode: Mode; env: Env; files: EnvFiles }): ServerPlan {
  const { mode, env, files } = input
  const flag = (env.E2E_ENABLE_DESTRUCTIVE ?? '').trim()

  if (env.E2E_BASE_URL?.trim()) return { kind: 'external', reason: 'E2E_BASE_URL is set: using the app you started; no server is started here' }
  if (flag !== '' && flag !== '0') return { kind: 'none', reason: 'destructive mode never starts a dev server (it would read .env.local); start the app against the local stack and set E2E_BASE_URL' }
  if (['LOCAL_SUPABASE_URL', 'LOCAL_SUPABASE_ANON', 'LOCAL_SUPABASE_SERVICE'].some((k) => env[k]?.trim())) {
    return { kind: 'none', reason: 'LOCAL_SUPABASE_* is set without E2E_BASE_URL: no server is started; the local-only specs check their own target' }
  }

  if (mode === 'offline') {
    return { kind: 'start', reason: 'offline: a dev server with its Supabase settings forced to a dead local port and its secrets blanked', env: offlineServerEnv(env, files) }
  }

  const where = (name: string) => (env[name] !== undefined && env[name] !== '' ? 'the process environment' : files.origin[name] ?? 'an environment file')
  const effective: Record<string, string> = { ...files.values }
  for (const [k, v] of Object.entries(env)) if (v !== undefined) effective[k] = v

  const problems: string[] = []
  const url = effective.NEXT_PUBLIC_SUPABASE_URL?.trim()
  if (!url) problems.push('NEXT_PUBLIC_SUPABASE_URL is not set in the environment or in any .env file the dev server reads')
  else if (!isLocalOrigin(url)) problems.push(`NEXT_PUBLIC_SUPABASE_URL (from ${where('NEXT_PUBLIC_SUPABASE_URL')}) is not a plain local origin, so the app would talk to a hosted or unknown project`)
  for (const [name, value] of Object.entries(effective)) {
    if (name === 'NEXT_PUBLIC_SUPABASE_URL' || !value || !SCANNED_NAMES.test(name)) continue
    if (isHosted(value)) problems.push(`${name} (from ${where(name)}) refers to the shared/hosted Supabase project`)
  }

  if (problems.length === 0) return { kind: 'start', reason: 'the app is configured against a local Supabase stack' }
  return {
    kind: 'refuse',
    reason:
      'REFUSING TO START THE APP: the dev server Playwright would start reads a configuration that points at shared/hosted infrastructure. Nothing was started and nothing was sent anywhere.\n' +
      problems.map((p) => `  - ${p}`).join('\n') +
      '\nWhat to do instead:\n' +
      '  - offline specs only (no backend, no credentials):  npm run test:e2e:offline\n' +
      '  - local stack: start the app yourself against it, write its origin as http://localhost:<port>, and set E2E_BASE_URL (see .env.example)\n' +
      '  - an app you started yourself that IS wired to shared data (read-only specs only): set E2E_BASE_URL deliberately; nothing here will start it for you',
  }
}
