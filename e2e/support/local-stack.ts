import { test as base, expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../../lib/types/database.types'
import { isForeignSupabaseRequest, resolveLocalTarget } from './local-supabase-guard'

/**
 * Shared scaffolding for the specs that WRITE through the real app (classic and V3 Skip): they run only against a
 * disposable local Supabase stack, never the shared project. Read e2e/support/local-supabase-guard.ts for the
 * validation rules and e2e/nurse-classic-skip.local.spec.ts for the full rationale. In short:
 *
 *  - opt-in via LOCAL_SUPABASE_URL / _ANON / _SERVICE (+ E2E_BASE_URL); once opted in an invalid setup FAILS;
 *  - establishLocalTarget() proves the app SERVER reads the same stack through a canary only that stack contains;
 *  - every browser context blocks and records requests/WebSockets to any non-local Supabase host, before navigation.
 *
 * Usage in a spec:
 *   test.describe('...', () => {
 *     test.skip(target.state === 'unconfigured', '...')
 *     test.beforeAll(async () => { test.setTimeout(240_000); await establishLocalTarget() })
 *     ...
 */

export const target = resolveLocalTarget(process.env)

export const CLINIC_A = '11111111-1111-1111-1111-111111111111'
export const PW = 'local-only-password-1'
export const RUN = Date.now().toString(36)

// ------------------------------------------------------------------ browser guard (every context, before any navigation)

export const escapedByContext = new WeakMap<BrowserContext, string[]>()

export async function installGuard(ctx: BrowserContext): Promise<string[]> {
  if (target.state !== 'ok') throw new Error('guard: refusing to open a browser without a verified local target')
  const allowed = { appOrigin: target.appOrigin, supabaseOrigin: target.supabaseOrigin }
  const escaped: string[] = []
  await ctx.route(
    (url) => isForeignSupabaseRequest(url.href, allowed),
    (route) => {
      escaped.push(route.request().url())
      return route.abort('blockedbyclient')
    }
  )
  await ctx.routeWebSocket(
    (url) => isForeignSupabaseRequest(url.href, allowed),
    (ws) => {
      escaped.push(ws.url())
      ws.close({ code: 1008, reason: 'blocked by the local-only guard' })
    }
  )
  escapedByContext.set(ctx, escaped)
  return escaped
}

/** A context created by hand (the fixture one is guarded automatically). */
export async function guardedContext(browser: Browser): Promise<BrowserContext> {
  const ctx = await browser.newContext()
  await installGuard(ctx)
  return ctx
}

export const test = base.extend<{ context: BrowserContext }>({
  context: async ({ context }, provide) => {
    const escaped = await installGuard(context)
    await provide(context)
    expect(escaped, 'the page tried to reach a non-local Supabase host').toEqual([])
  },
})
export { expect }

// ------------------------------------------------------------------ verified local target

let admin: SupabaseClient<Database> | undefined
export function db(): SupabaseClient<Database> {
  if (!admin) throw new Error('local stack not established')
  return admin
}

/**
 * Runs once, before any integration test. Throws — failing every test — unless the configuration is valid AND the
 * app's server provably reads the same local stack. Nothing is written anywhere before this passes (a canary
 * service, created and deleted again, is the only write, and it goes to the local stack alone).
 */
export async function establishLocalTarget() {
  if (target.state === 'invalid') {
    throw new Error(`REFUSING TO RUN: unsafe local-test configuration. Nothing was sent anywhere.\n  - ${target.reasons.join('\n  - ')}`)
  }
  if (target.state !== 'ok') throw new Error('REFUSING TO RUN: no verified local target')
  const { supabaseOrigin, appOrigin } = target
  admin = createClient<Database>(supabaseOrigin, target.service, { auth: { persistSession: false, autoRefreshToken: false } })

  const id = crypto.randomUUID()
  const name = `Canary ${RUN} ${Math.random().toString(36).slice(2, 10)}`
  const prefix = Array.from({ length: 4 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('')
  const created = await admin.from('services').insert({ id, clinic_id: CLINIC_A, name, token_prefix: prefix })
  if (created.error) {
    throw new Error(`REFUSING TO RUN: cannot use the local Supabase stack at ${supabaseOrigin} (${created.error.message}). Is \`supabase start\` running, and is the key its service_role key?`)
  }
  try {
    let res: Response
    try {
      res = await fetch(`${appOrigin}/display/${id}`, { redirect: 'manual', signal: AbortSignal.timeout(150_000) })
    } catch (e) {
      throw new Error(`REFUSING TO RUN: the app at ${appOrigin} did not answer (${(e as Error).message}). Start it with NEXT_PUBLIC_SUPABASE_URL=${supabaseOrigin}.`)
    }
    const html = await res.text()
    if (res.status !== 200 || !html.includes(name)) {
      throw new Error(
        `REFUSING TO RUN: the app at ${appOrigin} is NOT using the local Supabase stack at ${supabaseOrigin}. Its server could not see ` +
          `the canary service that exists only in that stack (HTTP ${res.status}, ${html.includes('This board is unavailable') ? 'board unavailable' : 'canary name absent'}). ` +
          `Restart the app with NEXT_PUBLIC_SUPABASE_URL=${supabaseOrigin} and NEXT_PUBLIC_SUPABASE_ANON_KEY=<that stack's anon key>.`
      )
    }
  } finally {
    await admin.from('services').delete().eq('id', id)
  }
}

// ------------------------------------------------------------------ data helpers (local stack only)

export async function must<R extends { data: unknown; error: { message: string } | null }>(p: PromiseLike<R>, what: string): Promise<NonNullable<R['data']>> {
  const { data, error } = await p
  if (error) throw new Error(`${what}: ${error.message}`)
  return data as NonNullable<R['data']>
}

let n = 0
export async function makeUser(tag: string, role: 'nurse' | 'receptionist', clinicId = CLINIC_A) {
  if (target.state !== 'ok') throw new Error('no verified local target')
  n += 1
  const email = `${tag}${n}.${RUN}@local.test`
  const created = await must(db().auth.admin.createUser({ email, password: PW, email_confirm: true, user_metadata: { full_name: `Local ${tag} ${n}` } }), 'createUser')
  await must(db().from('profiles').update({ role, clinic_id: clinicId }).eq('auth_user_id', created.user!.id), 'profile')
  const client = createClient<Database>(target.supabaseOrigin, target.anon, { auth: { persistSession: false, autoRefreshToken: false } })
  await must(client.auth.signInWithPassword({ email, password: PW }), 'signIn')
  return { email, client }
}

/** A fresh service with nurse(s) on duty and patients checked in through the real RPCs. */
export async function scenario(patientCount: number, nurseCount = 1) {
  const svc = crypto.randomUUID()
  const prefix = Array.from({ length: 4 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('')
  await must(db().from('services').insert({ id: svc, clinic_id: CLINIC_A, name: `Skip ${RUN} ${prefix}`, token_prefix: prefix }), 'service')
  const nurses = []
  for (let i = 0; i < nurseCount; i++) {
    const nurse = await makeUser('nurse', 'nurse')
    await must(nurse.client.rpc('set_duty', { p_on_duty: true, p_service_id: svc }), 'set_duty')
    nurses.push(nurse)
  }
  const rec = await makeUser('rec', 'receptionist')
  const patients: { id: string; token: string }[] = []
  for (let i = 0; i < patientCount; i++) {
    const p = await must(rec.client.rpc('create_walkin_patient', { p_full_name: `Skip patient ${i} ${RUN}` }), 'walk-in')
    const e = await must(rec.client.rpc('check_in_patient', { p_service_id: svc, p_patient_id: p.id }), 'check-in')
    patients.push({ id: e.id, token: e.token })
  }
  return { svc, nurses, rec, patients }
}

export const entry = async (id: string) => must(db().from('queue_entries').select('status').eq('id', id).single(), 'entry')
export const openConsultations = async (id: string) => (await must(db().from('consultations').select('id').eq('queue_entry_id', id).is('ended_at', null), 'cons')).length

/**
 * Per-page view of the context guard: `escaped` is every browser request the guard blocked because it targeted a
 * Supabase host other than the local stack. Also records Server Action POST bodies: the nurse pages make other
 * read-only Server Action calls while they hydrate (coverage check, current-state reads), so the Skip action's own
 * POSTs are found by the queue entry id in the form body.
 */
export function guard(page: Page) {
  const escaped = escapedByContext.get(page.context())
  if (!escaped) throw new Error("guard: this page's context has no local-only guard installed")
  const actionBodies: string[] = []
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.headers()['next-action']) actionBodies.push(req.postDataBuffer()?.toString('latin1') ?? '')
  })
  const skipPosts = (entryId: string) => actionBodies.filter((b) => b.includes(entryId)).length
  return { escaped, skipPosts }
}
