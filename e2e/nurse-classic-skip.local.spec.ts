import { test, expect, type Browser, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../lib/types/database.types'
import { loginAs } from './helpers'

/**
 * Classic /nurse waiting-list Skip → skipPatient() → skip_waiting_patient().
 *
 * LOCAL ISOLATED SUPABASE ONLY. Runs the real classic nurse page and the real Server Action against a local
 * stack (`supabase start`) — never the shared project. The suite skips itself unless:
 *   LOCAL_SUPABASE_URL   is http://127.0.0.1:<port> or http://localhost:<port>
 *   LOCAL_SUPABASE_ANON / LOCAL_SUPABASE_SERVICE   are that stack's keys
 *   E2E_BASE_URL         is a dev server whose .env.local points at that same local stack
 * and every test fails if the page sends any request to *.supabase.co.
 *
 * Scenarios that need the waiting list to be stale (the race this fixes: a row still shows "waiting" after
 * another nurse has called or reception has skipped that patient) block the page's realtime WebSocket, so the
 * list cannot refresh behind the test's back.
 */

const URL_ = process.env.LOCAL_SUPABASE_URL ?? ''
const ANON = process.env.LOCAL_SUPABASE_ANON ?? ''
const SERVICE = process.env.LOCAL_SUPABASE_SERVICE ?? ''
const isLocal = /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(URL_)
test.skip(!isLocal || !ANON || !SERVICE || !process.env.E2E_BASE_URL, 'local isolated Supabase stack not configured')
test.describe.configure({ mode: 'serial', timeout: 180_000 })

const CLINIC_A = '11111111-1111-1111-1111-111111111111'
const PW = 'local-only-password-1'
const RUN = Date.now().toString(36)
const admin: SupabaseClient<Database> = createClient<Database>(URL_ || 'http://127.0.0.1:1', SERVICE || 'x', { auth: { persistSession: false, autoRefreshToken: false } })

async function must<R extends { data: unknown; error: { message: string } | null }>(p: PromiseLike<R>, what: string): Promise<NonNullable<R['data']>> {
  const { data, error } = await p
  if (error) throw new Error(`${what}: ${error.message}`)
  return data as NonNullable<R['data']>
}

let n = 0
async function makeUser(tag: string, role: 'nurse' | 'receptionist', clinicId = CLINIC_A) {
  n += 1
  const email = `${tag}${n}.${RUN}@local.test`
  const created = await must(admin.auth.admin.createUser({ email, password: PW, email_confirm: true, user_metadata: { full_name: `Local ${tag} ${n}` } }), 'createUser')
  await must(admin.from('profiles').update({ role, clinic_id: clinicId }).eq('auth_user_id', created.user!.id), 'profile')
  const client = createClient<Database>(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
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
 * Fail closed: any request to the shared project from the page is recorded and fails the test.
 * Also records Server Action POST bodies: the classic page makes other read-only Server Action calls while it
 * hydrates (coverage check, current-state reads), so the Skip action's own POSTs are found by the queue entry id
 * in the form body.
 */
function guard(page: Page) {
  const escaped: string[] = []
  const actionBodies: string[] = []
  page.on('request', (req) => {
    if (/supabase\.co/.test(req.url())) escaped.push(req.url())
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
    const ctx = await browser.newContext()
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
  for (const p of pages) await p.context().close()
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

test('the waiting-row action calls skip_waiting_patient and never skip_patient', () => {
  const src = readFileSync('app/actions/nurse.ts', 'utf8')
  const fn = src.slice(src.indexOf('export async function skipPatient'), src.indexOf('export type EmergencyState'))
  expect(fn).toContain(".rpc('skip_waiting_patient'")
  expect(fn).not.toContain("'skip_patient'")
  expect(src).not.toMatch(/\.rpc\('skip_patient'/)
})
