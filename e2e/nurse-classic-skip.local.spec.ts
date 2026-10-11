import { test as base, expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../lib/types/database.types'
import { loginAs } from './helpers'
import { PRODUCTION_PROJECT_REF, isForeignSupabaseRequest, resolveLocalTarget } from './support/local-supabase-guard'

/**
 * Classic /nurse waiting-list Skip → skipPatient() → skip_waiting_patient().
 *
 * Two kinds of test live here:
 *
 *  1. STANDALONE — always run, need no database, server or network: the static check that the waiting-row action
 *     calls skip_waiting_patient() and never skip_patient(), and the unit tests of the local-only guard's rules.
 *
 *  2. INTEGRATION — drive the real classic /nurse page and Server Action and WRITE (check-ins, skips, calls). They
 *     run only against a disposable local Supabase stack (`supabase start`), never the shared project
 *     (`bffhjvpkfivtbzqielve`), and are opt-in: they skip unless LOCAL_SUPABASE_URL / _ANON / _SERVICE is set.
 *     Once opted in, an invalid or unverifiable setup is a hard FAILURE before anything is written, never a skip.
 *
 * Opt-in configuration (all required; see e2e/support/local-supabase-guard.ts for the exact rules):
 *   LOCAL_SUPABASE_URL      http://127.0.0.1:<port> or http://localhost:<port> — the local stack's API
 *   LOCAL_SUPABASE_ANON     that stack's anon key
 *   LOCAL_SUPABASE_SERVICE  that stack's service_role key
 *   E2E_BASE_URL            http://127.0.0.1:<port> or http://localhost:<port> — a Next.js dev server whose
 *                           NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY point at the SAME local stack
 *
 * Why browser-side request monitoring is not enough: Server Actions and Server Components call Supabase from the
 * Next.js *server process*, which a browser (and page.route) never sees. A "localhost" app can silently be wired to
 * production through its .env.local. So before any test runs, a canary proves the app server reads THIS stack:
 * a service with a random id and unique name is created in the local database only, and the app's public display
 * page (/display/<id>, server-rendered, anonymous, read-only) must show that name. Production cannot contain it, so
 * a miswired server cannot pass. If the canary fails, nothing else runs. (If the app was miswired, that one probe is
 * a single anonymous read-only RPC with a random id, the same request any visitor to /display/<random> makes; no
 * credentials and no writes are ever sent before the canary passes.)
 *
 * Browser traffic: every browser context installs a guard BEFORE any navigation that blocks, and records, any
 * request or WebSocket to a hosted-Supabase host or to a Supabase API on any host that is neither the app nor the
 * local stack. Each test fails if the guard recorded anything.
 *
 * Scenarios that need the waiting list to be stale (the race this fixes: a row still shows "waiting" after
 * another nurse has called or reception has skipped that patient) block the page's realtime WebSocket, so the
 * list cannot refresh behind the test's back.
 */

const target = resolveLocalTarget(process.env)

// ------------------------------------------------------------------ browser guard (every context, before any navigation)

const escapedByContext = new WeakMap<BrowserContext, string[]>()

async function installGuard(ctx: BrowserContext): Promise<string[]> {
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
async function guardedContext(browser: Browser): Promise<BrowserContext> {
  const ctx = await browser.newContext()
  await installGuard(ctx)
  return ctx
}

const test = base.extend<{ context: BrowserContext }>({
  context: async ({ context }, provide) => {
    const escaped = await installGuard(context)
    await provide(context)
    expect(escaped, 'the page tried to reach a non-local Supabase host').toEqual([])
  },
})

// ------------------------------------------------------------------ 1. STANDALONE (no database, server or network)

test('the waiting-row action calls skip_waiting_patient and never skip_patient', () => {
  const src = readFileSync('app/actions/nurse.ts', 'utf8')
  const fn = src.slice(src.indexOf('export async function skipPatient'), src.indexOf('export type EmergencyState'))
  expect(fn.length).toBeGreaterThan(100)
  expect(fn).toContain(".rpc('skip_waiting_patient'")
  expect(fn).not.toContain("'skip_patient'")
  expect(src).not.toMatch(/\.rpc\('skip_patient'/)
})

test.describe('local-only guard rules (pure)', () => {
  const GOOD = {
    LOCAL_SUPABASE_URL: 'http://127.0.0.1:54321',
    LOCAL_SUPABASE_ANON: 'anon-key',
    LOCAL_SUPABASE_SERVICE: 'service-key',
    E2E_BASE_URL: 'http://localhost:3100',
  }
  const refusal = (over: Record<string, string | undefined>) => {
    const t = resolveLocalTarget({ ...GOOD, ...over })
    expect(t.state, JSON.stringify(over)).toBe('invalid')
    return t.state === 'invalid' ? t.reasons.join(' | ') : ''
  }

  test('a fully local configuration is accepted, whichever way localhost is spelled', () => {
    expect(resolveLocalTarget(GOOD)).toMatchObject({ state: 'ok', appOrigin: 'http://localhost:3100', supabaseOrigin: 'http://127.0.0.1:54321' })
    expect(resolveLocalTarget({ ...GOOD, E2E_BASE_URL: 'http://127.0.0.1:3100/', LOCAL_SUPABASE_URL: 'http://LOCALHOST:54321' }).state).toBe('ok')
  })

  test('nothing set: unconfigured (the integration tests skip). E2E_BASE_URL alone — even production — is inert', () => {
    expect(resolveLocalTarget({}).state).toBe('unconfigured')
    expect(resolveLocalTarget({ E2E_BASE_URL: 'https://smart-clinic-alpha.vercel.app' }).state).toBe('unconfigured')
    expect(resolveLocalTarget({ LOCAL_SUPABASE_URL: '  ', E2E_BASE_URL: '' }).state).toBe('unconfigured')
  })

  for (const url of [
    'https://smart-clinic-alpha.vercel.app',
    'https://smart-clinic-git-fix-classic-nurse-waiting-skip-ogleloos-projects.vercel.app',
    `https://${PRODUCTION_PROJECT_REF}.supabase.co`,
    'http://localhost.evil.com:3000',
    'http://localhost@evil.com:3000',
    'http://user:pw@localhost:3000',
    'http://evil.com:3000/localhost',
    'http://evil.com:3000/?host=localhost:3000',
    'https://localhost:3000',
    'http://localhost',
    'http://localhost:3000/nurse',
    'http://localhost:3000/?x=1',
    'localhost:3000',
    'not a url',
    '',
    '   ',
    'http://0.0.0.0:3000',
    'http://[::1]:3000',
    'http://127.0.0.2:3000',
    'http://192.168.1.20:3000',
    'http://10.0.0.5:3000',
    'ftp://localhost:3000',
  ]) {
    test(`E2E_BASE_URL ${JSON.stringify(url)} is refused (with a reason, before anything is sent)`, () => {
      expect(refusal({ E2E_BASE_URL: url })).toContain('E2E_BASE_URL')
    })
  }

  test('E2E_BASE_URL unset while opted in is refused (Playwright would otherwise fall back to http://localhost:3000 and a webServer using .env.local)', () => {
    expect(refusal({ E2E_BASE_URL: undefined })).toContain('E2E_BASE_URL is not set')
  })

  for (const url of [
    `https://${PRODUCTION_PROJECT_REF}.supabase.co`,
    'https://anything.supabase.co',
    'http://localhost.supabase.co:54321',
    'http://127.0.0.1',
    'https://127.0.0.1:54321',
    'http://db.example.com:54321',
    '',
  ]) {
    test(`LOCAL_SUPABASE_URL ${JSON.stringify(url)} is refused`, () => {
      expect(refusal({ LOCAL_SUPABASE_URL: url })).toContain('LOCAL_SUPABASE_URL')
    })
  }

  test('opted in through a key alone, without the URL: refused, not skipped', () => {
    const t = resolveLocalTarget({ LOCAL_SUPABASE_SERVICE: 'x', E2E_BASE_URL: 'http://localhost:3100' })
    expect(t.state).toBe('invalid')
  })

  test('missing keys, a production-looking key, and app == database host are all refused', () => {
    expect(refusal({ LOCAL_SUPABASE_ANON: undefined })).toContain('LOCAL_SUPABASE_ANON is not set')
    expect(refusal({ LOCAL_SUPABASE_SERVICE: '' })).toContain('LOCAL_SUPABASE_SERVICE is not set')
    expect(refusal({ LOCAL_SUPABASE_SERVICE: `eyJ.${PRODUCTION_PROJECT_REF}.sig` })).toContain('production project')
    expect(refusal({ E2E_BASE_URL: 'http://localhost:54321' })).toContain('same host:port')
  })

  test('a refusal lists every problem, so the setup can be fixed in one go', () => {
    const t = resolveLocalTarget({ LOCAL_SUPABASE_URL: `https://${PRODUCTION_PROJECT_REF}.supabase.co`, E2E_BASE_URL: 'https://smart-clinic-alpha.vercel.app', LOCAL_SUPABASE_ANON: 'a', LOCAL_SUPABASE_SERVICE: 's' })
    expect(t.state === 'invalid' && t.reasons.length).toBeGreaterThanOrEqual(2)
  })

  const allowed = { appOrigin: 'http://localhost:3100', supabaseOrigin: 'http://127.0.0.1:54321' }
  for (const [url, foreign] of [
    [`https://${PRODUCTION_PROJECT_REF}.supabase.co/rest/v1/rpc/get_service_queue`, true],
    [`wss://${PRODUCTION_PROJECT_REF}.supabase.co/realtime/v1/websocket?apikey=x`, true],
    ['https://some-other-project.supabase.co/auth/v1/token', true],
    ['https://api.supabase.com/v1/projects', true],
    ['https://evil.example/rest/v1/rpc/skip_patient', true],
    ['http://127.0.0.1:54399/rest/v1/profiles', true],
    ['http://localhost:54321/realtime/v1/websocket', false],
    ['ws://127.0.0.1:54321/realtime/v1/websocket', false],
    ['http://127.0.0.1:54321/rest/v1/rpc/get_service_queue', false],
    ['http://localhost:54321/rest/v1/rpc/get_service_queue', false],
    ['http://localhost:3100/_next/static/chunks/app.js', false],
    ['http://localhost:3100/nurse', false],
    ['https://fonts.gstatic.com/s/inter.woff2', false],
    ['data:image/png;base64,AAAA', false],
    ['chrome-extension://abc/page.html', false],
  ] as const) {
    test(`browser request ${url.slice(0, 70)} → ${foreign ? 'BLOCKED' : 'allowed'}`, () => {
      expect(isForeignSupabaseRequest(url, allowed)).toBe(foreign)
    })
  }
})

// ------------------------------------------------------------------ 2. INTEGRATION (local Supabase stack only)

const CLINIC_A = '11111111-1111-1111-1111-111111111111'
const PW = 'local-only-password-1'
const RUN = Date.now().toString(36)
let admin!: SupabaseClient<Database>

/**
 * Runs once, before any integration test. Throws — failing every test — unless the configuration is valid AND the
 * app's server provably reads the same local stack. Nothing is written anywhere before this passes (a canary
 * service, created and deleted again, is the only write, and it goes to the local stack alone).
 */
async function establishLocalTarget() {
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

test.describe('classic Skip against the local stack', () => {
  test.skip(target.state === 'unconfigured', 'LOCAL_SUPABASE_* not set: the local isolated Supabase integration tests are opt-in')
  test.describe.configure({ mode: 'serial', timeout: 180_000 })

  test.beforeAll(async () => {
    test.setTimeout(240_000)
    await establishLocalTarget()
  })

  test('browser guard: requests and WebSockets aimed at another Supabase backend or the production project are blocked and recorded', async ({ page, context }) => {
    const escaped = escapedByContext.get(context)!
    await page.goto('/login')
    // Harmless stand-ins the guard classifies as foreign: a Supabase API path on an unexpected host, and a URL that
    // names the production project. Both point at closed loopback ports, so even a broken guard sends nothing out.
    const apiProbe = 'http://127.0.0.1:54399/rest/v1/profiles?select=id'
    const refProbe = `http://127.0.0.1:1/?project=${PRODUCTION_PROJECT_REF}`
    const wsProbe = 'ws://127.0.0.1:54399/realtime/v1/websocket'
    const outcome = await page.evaluate(
      async ([api, ref, ws]) => {
        const settle = (u: string) => fetch(u, { mode: 'no-cors' }).then(() => 'responded', () => 'failed')
        const fetches = await Promise.all([settle(api!), settle(ref!)])
        const closeCode = await new Promise<number>((resolve) => {
          const sock = new WebSocket(ws!)
          sock.onclose = (e) => resolve(e.code)
          setTimeout(() => resolve(-1), 10_000)
        })
        return { fetches, closeCode }
      },
      [apiProbe, refProbe, wsProbe]
    )
    expect(outcome.fetches).toEqual(['failed', 'failed'])
    expect(outcome.closeCode).toBe(1008) // closed by the guard (a dead port would report 1006)
    expect(escaped).toEqual(expect.arrayContaining([apiProbe, refProbe]))
    expect(escaped.some((u) => u.startsWith('ws://127.0.0.1:54399/realtime/v1/websocket'))).toBe(true)
    // The recording is the point of this test; clear it so the fixture's end-of-test assertion doesn't re-fail it.
    escaped.length = 0
  })

  async function must<R extends { data: unknown; error: { message: string } | null }>(p: PromiseLike<R>, what: string): Promise<NonNullable<R['data']>> {
    const { data, error } = await p
    if (error) throw new Error(`${what}: ${error.message}`)
    return data as NonNullable<R['data']>
  }

  let n = 0
  async function makeUser(tag: string, role: 'nurse' | 'receptionist', clinicId = CLINIC_A) {
    if (target.state !== 'ok') throw new Error('no verified local target')
    n += 1
    const email = `${tag}${n}.${RUN}@local.test`
    const created = await must(admin.auth.admin.createUser({ email, password: PW, email_confirm: true, user_metadata: { full_name: `Local ${tag} ${n}` } }), 'createUser')
    await must(admin.from('profiles').update({ role, clinic_id: clinicId }).eq('auth_user_id', created.user!.id), 'profile')
    const client = createClient<Database>(target.supabaseOrigin, target.anon, { auth: { persistSession: false, autoRefreshToken: false } })
    await must(client.auth.signInWithPassword({ email, password: PW }), 'signIn')
    return { email, client }
  }

  /** A fresh service with nurse(s) on duty and patients checked in through the real RPCs. */
  async function scenario(patientCount: number, nurseCount = 1) {
    const svc = crypto.randomUUID()
    const prefix = Array.from({ length: 4 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('')
    await must(admin.from('services').insert({ id: svc, clinic_id: CLINIC_A, name: `Skip ${RUN} ${prefix}`, token_prefix: prefix }), 'service')
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

  const entry = async (id: string) => must(admin.from('queue_entries').select('status').eq('id', id).single(), 'entry')
  const openConsultations = async (id: string) => (await must(admin.from('consultations').select('id').eq('queue_entry_id', id).is('ended_at', null), 'cons')).length

  /**
   * Per-page view of the context guard (see installGuard): `escaped` is every browser request the guard blocked
   * because it targeted a Supabase host other than the local stack. Also records Server Action POST bodies: the
   * classic page makes other read-only Server Action calls while it hydrates (coverage check, current-state reads),
   * so the Skip action's own POSTs are found by the queue entry id in the form body.
   */
  function guard(page: Page) {
    const escaped = escapedByContext.get(page.context())
    if (!escaped) throw new Error("guard: this page's context has no local-only guard installed")
    const actionBodies: string[] = []
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.headers()['next-action']) actionBodies.push(req.postDataBuffer()?.toString('latin1') ?? '')
    })
    const skipPosts = (entryId: string) => actionBodies.filter((b) => b.includes(entryId)).length
    return { escaped, skipPosts }
  }

  async function openNurse(page: Page, email: string, { stale = false } = {}) {
    // Stale: the realtime socket never connects, so the waiting list shows only what the page first rendered.
    if (stale) await page.routeWebSocket(/\/realtime\//, () => {})
    await loginAs(page, email, PW)
    await page.goto('/nurse')
    await expect(page.getByText('WAITING LIST')).toBeVisible({ timeout: 90_000 })
  }
  const row = (page: Page, token: string) => page.locator('tbody tr', { hasText: token })

  async function confirmSkip(page: Page, token: string) {
    await row(page, token).getByRole('button', { name: 'Skip' }).click()
    await row(page, token).getByRole('button', { name: 'Confirm' }).click()
  }

  test('waiting patient: skipped through skip_waiting_patient; row leaves the list; nothing else changes', async ({ page }) => {
    const g = guard(page)
    const { nurses, patients } = await scenario(3)
    const [a, b] = patients
    await openNurse(page, nurses[0]!.email)
    await expect(row(page, a!.token)).toBeVisible()
    await confirmSkip(page, a!.token)
    await expect(row(page, a!.token)).toHaveCount(0, { timeout: 30_000 })
    expect((await entry(a!.id)).status).toBe('skipped')
    expect(await openConsultations(a!.id)).toBe(0)
    expect((await entry(b!.id)).status).toBe('waiting')
    await expect(row(page, b!.token)).toBeVisible()
    expect(g.skipPosts(a!.id)).toBe(1)
    expect(g.escaped).toEqual([])
  })

  test('race: the row is still on screen but another nurse has called that patient — Skip is refused, their consultation stays open', async ({ page }) => {
    const g = guard(page)
    const { nurses, patients } = await scenario(2, 2)
    const [a] = patients
    await openNurse(page, nurses[0]!.email, { stale: true })
    await expect(row(page, a!.token)).toBeVisible()
    // Nurse 2 calls the head of the queue (patient a) behind nurse 1's back.
    const called = await must(nurses[1]!.client.rpc('next_patient', { p_action_id: crypto.randomUUID() }), 'next_patient')
    expect((called as { queue_entry_id: string }).queue_entry_id).toBe(a!.id)
    await confirmSkip(page, a!.token)
    await expect(row(page, a!.token).getByRole('alert')).toContainText('already in consultation', { timeout: 30_000 })
    expect((await entry(a!.id)).status).toBe('in_progress')
    expect(await openConsultations(a!.id)).toBe(1)
    expect(g.escaped).toEqual([])
  })

  test('already skipped by reception: Skip is refused with "no longer waiting"', async ({ page }) => {
    const g = guard(page)
    const { nurses, rec, patients } = await scenario(2)
    const [a] = patients
    await openNurse(page, nurses[0]!.email, { stale: true })
    await expect(row(page, a!.token)).toBeVisible()
    await must(rec.client.rpc('skip_patient', { p_queue_entry_id: a!.id }), 'reception skip')
    await confirmSkip(page, a!.token)
    await expect(row(page, a!.token).getByRole('alert')).toContainText('no longer waiting', { timeout: 30_000 })
    expect((await entry(a!.id)).status).toBe('skipped')
    expect(g.escaped).toEqual([])
  })

  test('cross-clinic: a forged queue entry id from another clinic is refused as "Queue entry not found"', async ({ page }) => {
    const g = guard(page)
    const { nurses, patients } = await scenario(1)
    // An entry in clinic B, created directly (service role) — no clinic-A user can see it.
    const clinicB = crypto.randomUUID()
    await must(admin.from('clinics').insert({ id: clinicB, name: `Local B ${RUN}` }), 'clinic B')
    const svcB = crypto.randomUUID()
    await must(admin.from('services').insert({ id: svcB, clinic_id: clinicB, name: 'B svc', token_prefix: 'BBBB' }), 'svc B')
    const pB = await must(admin.from('profiles').insert({ full_name: `B patient ${RUN}`, role: 'patient' }).select('id').single(), 'patient B')
    const eB = await must(admin.from('queue_entries').insert({ clinic_id: clinicB, service_id: svcB, patient_id: pB.id, token: 'BBBB-001', token_number: 1 }).select('id').single(), 'entry B')
    await openNurse(page, nurses[0]!.email)
    // Rewrite the Server Action body so it carries clinic B's id instead of the row's own.
    await page.route('**/nurse', async (route) => {
      const req = route.request()
      if (req.method() !== 'POST' || !req.headers()['next-action']) return route.continue()
      const body = req.postDataBuffer()!.toString('latin1').replaceAll(patients[0]!.id, eB.id)
      return route.continue({ postData: Buffer.from(body, 'latin1') })
    })
    await confirmSkip(page, patients[0]!.token)
    await expect(row(page, patients[0]!.token).getByRole('alert')).toContainText('Queue entry not found', { timeout: 30_000 })
    expect((await entry(eB.id)).status).toBe('waiting')
    expect((await entry(patients[0]!.id)).status).toBe('waiting')
    expect(g.escaped).toEqual([])
  })

  test('duplicate submission: three same-tick clicks on Confirm send exactly one Server Action', async ({ page }) => {
    const g = guard(page)
    const { nurses, patients } = await scenario(2)
    const [a] = patients
    await openNurse(page, nurses[0]!.email)
    await row(page, a!.token).getByRole('button', { name: 'Skip' }).click()
    const confirm = row(page, a!.token).getByRole('button', { name: 'Confirm' })
    await confirm.evaluate((el) => {
      const b = el as HTMLButtonElement
      b.click()
      b.click()
      b.click()
    })
    await expect(row(page, a!.token)).toHaveCount(0, { timeout: 30_000 })
    await page.waitForTimeout(1500)
    expect(g.skipPosts(a!.id)).toBe(1)
    expect((await entry(a!.id)).status).toBe('skipped')
    expect(g.escaped).toEqual([])
  })

  test('two nurses confirm Skip on the same patient at the same moment: one succeeds, the other is refused', async ({ browser }: { browser: Browser }) => {
    const { nurses, patients } = await scenario(2, 2)
    const [a] = patients
    const pages: Page[] = []
    for (const nurse of nurses) {
      const ctx = await guardedContext(browser)
      const page = await ctx.newPage()
      await openNurse(page, nurse.email, { stale: true })
      await row(page, a!.token).getByRole('button', { name: 'Skip' }).click()
      pages.push(page)
    }
    await Promise.all(pages.map((p) => row(p, a!.token).getByRole('button', { name: 'Confirm' }).click()))
    await Promise.all(pages.map((p) => expect(p.getByText('Please wait…')).toHaveCount(0, { timeout: 30_000 })))
    const refused = await Promise.all(pages.map(async (p) => (await row(p, a!.token).getByRole('alert').count()) > 0))
    expect(refused.filter(Boolean)).toHaveLength(1)
    const alert = pages[refused.indexOf(true)]!
    await expect(row(alert, a!.token).getByRole('alert')).toContainText('no longer waiting')
    expect((await entry(a!.id)).status).toBe('skipped')
    for (const p of pages) {
      expect(escapedByContext.get(p.context()), 'a page tried to reach a non-local Supabase host').toEqual([])
      await p.context().close()
    }
  })

  test('rest of the classic screen unchanged: Call next, emergency toggle and End session are present; Skip only on waiting rows', async ({ page }) => {
    const g = guard(page)
    const { nurses } = await scenario(2)
    await openNurse(page, nurses[0]!.email)
    await expect(page.getByRole('button', { name: 'Call next patient' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Mark emergency' }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'End session' })).toBeVisible()
    await expect(page.locator('tbody tr').getByRole('button', { name: 'Skip' })).toHaveCount(2)
    expect(g.escaped).toEqual([])
  })
})
