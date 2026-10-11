/**
 * Pure guard logic for the local-only integration specs (e2e/nurse-classic-skip.local.spec.ts). No I/O here, so
 * every rule is unit-testable without a database, a server or a network.
 *
 * Why this exists: those specs WRITE (check patients in, skip, call). They must only ever do that against a
 * disposable local Supabase stack. The shared project `bffhjvpkfivtbzqielve` is production, previews share it, and
 * a Next.js dev server reads its Supabase URL from its own environment/.env files — so a spec can be pointed at a
 * "localhost" app that is secretly wired to production. The spec therefore (1) validates every URL with the rules
 * below, (2) proves at runtime that the app *server* uses the same stack (see the canary in the spec), and
 * (3) blocks browser traffic to any Supabase host other than the local one.
 */

/** The shared production project. Appearing in any configured value is an immediate refusal. */
export const PRODUCTION_PROJECT_REF = 'bffhjvpkfivtbzqielve'

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1'])

export type LocalTarget =
  | { state: 'unconfigured' }
  | { state: 'invalid'; reasons: string[] }
  | { state: 'ok'; supabaseOrigin: string; appOrigin: string; anon: string; service: string }

type Env = Record<string, string | undefined>

/** Parses a value that must be a plain http://localhost|127.0.0.1:<port> origin. Pushes one reason per problem. */
function parseLocalOrigin(name: string, raw: string | undefined, reasons: string[]): string | null {
  const value = raw?.trim() ?? ''
  if (!value) {
    reasons.push(`${name} is not set`)
    return null
  }
  if (value.toLowerCase().includes(PRODUCTION_PROJECT_REF) || /supabase\.(co|in|net|com)/i.test(value)) {
    reasons.push(`${name} refers to a hosted Supabase project (${value})`)
    return null
  }
  let u: URL
  try {
    u = new URL(value)
  } catch {
    reasons.push(`${name} is not a valid URL (${value})`)
    return null
  }
  const before = reasons.length
  if (u.protocol !== 'http:') reasons.push(`${name} must use http:// on a local stack, not ${u.protocol}// (${value})`)
  if (!LOCAL_HOSTNAMES.has(u.hostname)) reasons.push(`${name} host must be localhost or 127.0.0.1, not "${u.hostname}" (${value})`)
  if (u.username || u.password) reasons.push(`${name} must not carry credentials (${value})`)
  if (!u.port) reasons.push(`${name} must name an explicit port (${value})`)
  if (u.pathname !== '/' || u.search || u.hash) reasons.push(`${name} must be a bare origin, without path, query or fragment (${value})`)
  return reasons.length === before ? u.origin : null
}

/**
 * Opt-in switch: the suite is inert unless one of LOCAL_SUPABASE_URL / _ANON / _SERVICE is set. Once opted in,
 * EVERY requirement must hold or the result is 'invalid' — which callers must treat as a hard failure, never a skip.
 * E2E_BASE_URL is required too: without it Playwright would silently fall back to http://localhost:3000 and its
 * webServer would start a dev server using whatever .env.local says (usually the production project).
 */
export function resolveLocalTarget(env: Env): LocalTarget {
  const optedIn = ['LOCAL_SUPABASE_URL', 'LOCAL_SUPABASE_ANON', 'LOCAL_SUPABASE_SERVICE'].some((k) => !!env[k]?.trim())
  if (!optedIn) return { state: 'unconfigured' }

  const reasons: string[] = []
  const supabaseOrigin = parseLocalOrigin('LOCAL_SUPABASE_URL', env.LOCAL_SUPABASE_URL, reasons)
  const appOrigin = parseLocalOrigin('E2E_BASE_URL', env.E2E_BASE_URL, reasons)
  const anon = env.LOCAL_SUPABASE_ANON?.trim() ?? ''
  const service = env.LOCAL_SUPABASE_SERVICE?.trim() ?? ''
  if (!anon) reasons.push('LOCAL_SUPABASE_ANON is not set')
  if (!service) reasons.push('LOCAL_SUPABASE_SERVICE is not set')
  if ([anon, service].some((k) => k.toLowerCase().includes(PRODUCTION_PROJECT_REF))) reasons.push('a LOCAL_SUPABASE key mentions the production project')
  if (supabaseOrigin && appOrigin && canonicalHost(supabaseOrigin) === canonicalHost(appOrigin)) {
    reasons.push('E2E_BASE_URL and LOCAL_SUPABASE_URL are the same host:port — the app and the database are different servers')
  }
  if (reasons.length || !supabaseOrigin || !appOrigin) return { state: 'invalid', reasons }
  return { state: 'ok', supabaseOrigin, appOrigin, anon, service }
}

/** localhost and 127.0.0.1 are the same machine; compare them as one so a different spelling isn't a false alarm. */
function canonicalHost(urlOrOrigin: string): string {
  const u = new URL(urlOrOrigin)
  const host = u.hostname === 'localhost' ? '127.0.0.1' : u.hostname
  return `${host}:${u.port}`
}

const HOSTED_SUPABASE_HOST = /(^|\.)supabase\.(co|in|net|com)$/i
const SUPABASE_API_PATH = /^\/(rest|auth|realtime|storage|functions|graphql)\/v1(\/|$)/

/**
 * True for a browser request that must never leave the page: any hosted-Supabase host, anything naming the
 * production project, or a Supabase API path on a host that is neither the app nor the local stack (an app wired
 * to some other backend). Requests to the app and to the local stack are never foreign.
 */
export function isForeignSupabaseRequest(url: string, allowed: { appOrigin: string; supabaseOrigin: string }): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  // data:, blob:, about:, extension URLs… cannot reach a server.
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(u.protocol)) return false
  if (url.toLowerCase().includes(PRODUCTION_PROJECT_REF) || HOSTED_SUPABASE_HOST.test(u.hostname)) return true
  const here = canonicalHost(u.origin.replace(/^ws/, 'http'))
  if (here === canonicalHost(allowed.appOrigin) || here === canonicalHost(allowed.supabaseOrigin)) return false
  return SUPABASE_API_PATH.test(u.pathname)
}
