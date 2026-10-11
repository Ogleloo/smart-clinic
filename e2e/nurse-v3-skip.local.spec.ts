import { type Page } from '@playwright/test'
import { loginAs } from './helpers'
import { PW, entry, establishLocalTarget, expect, guard, guardedContext, makeUser, must, openConsultations, scenario, target, test, db } from './support/local-stack'

/**
 * Nurse V3 My Queue — waiting-row Skip (dialog → shared skipPatient Server Action → skip_waiting_patient()).
 *
 * LOCAL ISOLATED SUPABASE ONLY, and opt-in, with the same fail-closed guard as e2e/nurse-classic-skip.local.spec.ts
 * (see e2e/support/local-stack.ts): the real /nurse/queue page and the real Server Action run against a stack from
 * `supabase start`, through an app server verified (by canary) to read that same stack. Nothing here can reach the
 * shared project. Without LOCAL_SUPABASE_* the whole file skips; with an invalid setup it fails before any write.
 *
 * Race scenarios block the page's realtime socket so the list stays stale on purpose: the row on screen still says
 * "waiting" after another nurse has called, or reception has skipped, that patient — exactly the state the
 * database function must refuse to act on.
 */

test.describe('Nurse V3 Skip against the local stack', () => {
  test.skip(target.state === 'unconfigured', 'LOCAL_SUPABASE_* not set: the local isolated Supabase integration tests are opt-in')
  test.describe.configure({ mode: 'serial', timeout: 300_000 })

  test.beforeAll(async () => {
    test.setTimeout(240_000)
    await establishLocalTarget()
  })

  async function openQueue(page: Page, email: string, { stale = false } = {}) {
    await page.setViewportSize({ width: 1440, height: 1000 })
    // Stale: the realtime socket never connects, so the list shows only what the page first rendered.
    if (stale) await page.routeWebSocket(/\/realtime\//, () => {})
    await loginAs(page, email, PW)
    await page.goto('/nurse/queue')
    await expect(page.getByRole('heading', { level: 1, name: 'My Queue' })).toBeVisible({ timeout: 90_000 })
  }
  const row = (page: Page, token: string) => page.locator('tbody tr', { hasText: token })
  const skipButton = (page: Page, token: string) => row(page, token).getByRole('button', { name: new RegExp(`^Skip ${token},`) })
  const dialog = (page: Page) => page.getByRole('dialog', { name: 'Skip Patient' })
  const confirm = (page: Page) => dialog(page).getByRole('button', { name: 'Skip Patient' })

  test('waiting patient: skipped through the dialog; row leaves the list; toast; nothing else changes', async ({ page }) => {
    const g = guard(page)
    const { nurses, patients } = await scenario(3)
    const [a, b] = patients
    await openQueue(page, nurses[0]!.email)
    await expect(row(page, a!.token)).toBeVisible()
    await skipButton(page, a!.token).click()
    await expect(dialog(page)).toContainText(a!.token)
    await confirm(page).click()
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 30_000 })
    await expect(page.getByRole('status').filter({ hasText: 'was skipped' })).toContainText(a!.token)
    await expect(row(page, a!.token)).toHaveCount(0, { timeout: 30_000 })
    expect((await entry(a!.id)).status).toBe('skipped')
    expect(await openConsultations(a!.id)).toBe(0)
    expect((await entry(b!.id)).status).toBe('waiting')
    await expect(row(page, b!.token)).toBeVisible()
    await expect(page.locator('#my-queue-panel')).toBeFocused()
    expect(g.skipPosts(a!.id)).toBe(1)
    expect(g.escaped).toEqual([])
  })

  test('race: the row still says waiting but another nurse has called that patient — refused in the dialog, their consultation stays open, the list refreshes', async ({ page }) => {
    const g = guard(page)
    const { nurses, patients } = await scenario(2, 2)
    const [a] = patients
    await openQueue(page, nurses[0]!.email, { stale: true })
    await expect(row(page, a!.token)).toBeVisible()
    await skipButton(page, a!.token).click()
    // Nurse 2 calls the head of the queue (patient a) while the dialog is open.
    const called = await must(nurses[1]!.client.rpc('next_patient', { p_action_id: crypto.randomUUID() }), 'next_patient')
    expect((called as { queue_entry_id: string }).queue_entry_id).toBe(a!.id)
    await confirm(page).click()
    await expect(dialog(page).getByRole('alert')).toContainText('already in consultation', { timeout: 30_000 })
    await expect(dialog(page).getByRole('alert')).toContainText('Nothing was changed for this patient')
    await expect(confirm(page)).toHaveCount(0)
    expect((await entry(a!.id)).status).toBe('in_progress')
    expect(await openConsultations(a!.id)).toBe(1)
    // The refusal re-read the queue: behind the dialog the row is no longer a waiting row.
    await dialog(page).getByRole('button', { name: 'Close', exact: true }).click()
    await expect(row(page, a!.token)).toHaveCount(0, { timeout: 30_000 })
    await expect(page.getByText('1 other patient is in consultation with another nurse')).toBeVisible()
    expect(g.escaped).toEqual([])
  })

  test('already skipped by reception: refused with "no longer waiting", list refreshes', async ({ page }) => {
    const g = guard(page)
    const { nurses, rec, patients } = await scenario(2)
    const [a] = patients
    await openQueue(page, nurses[0]!.email, { stale: true })
    await expect(row(page, a!.token)).toBeVisible()
    await skipButton(page, a!.token).click()
    await must(rec.client.rpc('skip_patient', { p_queue_entry_id: a!.id }), 'reception skip')
    await confirm(page).click()
    await expect(dialog(page).getByRole('alert')).toContainText('no longer waiting', { timeout: 30_000 })
    expect((await entry(a!.id)).status).toBe('skipped')
    await dialog(page).getByRole('button', { name: 'Close', exact: true }).click()
    await expect(row(page, a!.token)).toHaveCount(0, { timeout: 30_000 })
    expect(g.escaped).toEqual([])
  })

  test('cross-clinic: a forged queue entry id from another clinic is refused as "Queue entry not found"', async ({ page }) => {
    const g = guard(page)
    const { nurses, patients } = await scenario(1)
    const clinicB = crypto.randomUUID()
    await must(db().from('clinics').insert({ id: clinicB, name: `Local B ${crypto.randomUUID().slice(0, 6)}` }), 'clinic B')
    const svcB = crypto.randomUUID()
    await must(db().from('services').insert({ id: svcB, clinic_id: clinicB, name: 'B svc', token_prefix: 'BBBC' }), 'svc B')
    const pB = await must(db().from('profiles').insert({ full_name: 'B patient', role: 'patient' }).select('id').single(), 'patient B')
    const eB = await must(db().from('queue_entries').insert({ clinic_id: clinicB, service_id: svcB, patient_id: pB.id, token: 'BBBC-001', token_number: 1 }).select('id').single(), 'entry B')
    await openQueue(page, nurses[0]!.email)
    // Rewrite the Server Action body so it carries clinic B's id instead of the row's own.
    await page.route('**/nurse/queue', async (route) => {
      const req = route.request()
      if (req.method() !== 'POST' || !req.headers()['next-action']) return route.continue()
      const body = req.postDataBuffer()!.toString('latin1').replaceAll(patients[0]!.id, eB.id)
      return route.continue({ postData: Buffer.from(body, 'latin1') })
    })
    await skipButton(page, patients[0]!.token).click()
    await confirm(page).click()
    await expect(dialog(page).getByRole('alert')).toContainText('Queue entry not found', { timeout: 30_000 })
    expect((await entry(eB.id)).status).toBe('waiting')
    expect((await entry(patients[0]!.id)).status).toBe('waiting')
    expect(g.escaped).toEqual([])
  })

  test('unauthorised callers: the same Server Action replayed with a patient session, an inactive receptionist and another clinic’s nurse changes nothing', async ({ page, browser }) => {
    const { nurses, patients } = await scenario(2)
    const [a] = patients
    // Capture the real Server Action request from a legitimate (but harmless: cancelled before it is sent) attempt.
    await openQueue(page, nurses[0]!.email)
    let captured: { url: string; headers: Record<string, string>; body: Buffer } | undefined
    await page.route('**/nurse/queue', async (route) => {
      const req = route.request()
      if (req.method() === 'POST' && req.headers()['next-action'] && req.postDataBuffer()?.toString('latin1').includes(a!.id)) {
        captured = { url: req.url(), headers: req.headers(), body: req.postDataBuffer()! }
        return route.abort() // never reaches the server
      }
      return route.continue()
    })
    await skipButton(page, a!.token).click()
    await confirm(page).click()
    await expect.poll(() => captured).toBeTruthy()
    await page.unroute('**/nurse/queue')

    const callers: { label: string; email: string }[] = []
    const patientUser = await makeUser('nurse', 'nurse') // role is rewritten below to patient
    await must(db().from('profiles').update({ role: 'patient' }).eq('auth_user_id', (await patientUser.client.auth.getUser()).data.user!.id), 'role')
    callers.push({ label: 'patient', email: patientUser.email })
    const inactive = await makeUser('rec', 'receptionist')
    await must(db().from('profiles').update({ is_active: false }).eq('auth_user_id', (await inactive.client.auth.getUser()).data.user!.id), 'deactivate')
    callers.push({ label: 'inactive receptionist', email: inactive.email })
    const otherClinicId = crypto.randomUUID()
    await must(db().from('clinics').insert({ id: otherClinicId, name: `Local C ${crypto.randomUUID().slice(0, 6)}` }), 'clinic C')
    const foreign = await makeUser('nurse', 'nurse', otherClinicId)
    callers.push({ label: 'nurse of another clinic', email: foreign.email })

    const results: string[] = []
    for (const c of callers) {
      const ctx = await guardedContext(browser)
      const p = await ctx.newPage()
      await loginAs(p, c.email, PW)
      // Replay everything but the original session and transport headers.
      const replayHeaders = Object.fromEntries(Object.entries(captured!.headers).filter(([k]) => !['cookie', 'host', 'content-length'].includes(k)))
      const res = await ctx.request.post(captured!.url, { headers: replayHeaders, data: captured!.body, maxRedirects: 0, failOnStatusCode: false })
      const text = await res.text()
      results.push(`${c.label}: ${/Not authorised/.test(text) ? 'Not authorised' : /Queue entry not found/.test(text) ? 'Queue entry not found' : `status ${res.status()} (no skip result)`}`)
      await ctx.close()
    }
    // The database's own refusals, exactly. The inactive receptionist is stopped before the action runs (the app
    // redirects the session), which is also a refusal; its database-level refusal is covered by the
    // skip_waiting_patient suite (supabase/tests/skip_waiting_patient).
    expect(results).toEqual(['patient: Not authorised', 'inactive receptionist: status 307 (no skip result)', 'nurse of another clinic: Queue entry not found'])
    expect((await entry(a!.id)).status).toBe('waiting')
    expect(await openConsultations(a!.id)).toBe(0)
  })

  test('duplicate submission: three same-tick clicks on Skip Patient send exactly one Server Action', async ({ page }) => {
    const g = guard(page)
    const { nurses, patients } = await scenario(2)
    const [a] = patients
    await openQueue(page, nurses[0]!.email)
    await skipButton(page, a!.token).click()
    await confirm(page).evaluate((el) => {
      const b = el as HTMLButtonElement
      b.click()
      b.click()
      b.click()
    })
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 30_000 })
    await page.waitForTimeout(1500)
    expect(g.skipPosts(a!.id)).toBe(1)
    expect((await entry(a!.id)).status).toBe('skipped')
    expect(g.escaped).toEqual([])
  })

  test('simultaneous Skip and Next Patient on the same head patient, swept across timings: never skipped AND in consultation; exactly one wins; both orders occur', async ({ page }) => {
    const g = guard(page)
    const outcomes = { skipWon: 0, callWon: 0 }
    // Next Patient is fired this long after Skip Patient is clicked. The first lands inside the Server Action's own
    // round trip (the call usually wins); the last lands long after it (the skip wins).
    const delaysMs = [0, 120, 300, 700, 1500, 3000]
    for (const delay of delaysMs) {
      const { nurses, patients } = await scenario(3, 2)
      const [head, second] = patients
      await openQueue(page, nurses[0]!.email, { stale: true })
      await expect(row(page, head!.token)).toBeVisible()
      await skipButton(page, head!.token).click()
      const [, called] = await Promise.all([
        confirm(page).click(),
        new Promise((r) => setTimeout(r, delay)).then(() => nurses[1]!.client.rpc('next_patient', { p_action_id: crypto.randomUUID() })),
      ])
      expect(called.error?.message ?? null).toBeNull()
      const callData = called.data as { status: string; queue_entry_id: string }
      expect(callData.status).toBe('called')
      // The dialog settles either way: closed with a toast on success, an alert on refusal.
      await expect(page.getByRole('dialog').getByRole('alert').or(page.getByRole('status').filter({ hasText: 'was skipped' }))).toBeVisible({ timeout: 30_000 })

      const headRow = await entry(head!.id)
      const secondRow = await entry(second!.id)
      const headCons = await openConsultations(head!.id)
      if (headRow.status === 'skipped') {
        outcomes.skipWon += 1
        expect(headCons, `delay ${delay}ms: a skipped patient must have no open consultation`).toBe(0)
        expect(callData.queue_entry_id, `delay ${delay}ms: when the skip won, nurse 2 must have been given the next patient`).toBe(second!.id)
        expect(secondRow.status).toBe('in_progress')
        await expect(page.getByRole('status').filter({ hasText: 'was skipped' })).toBeVisible()
      } else {
        outcomes.callWon += 1
        expect(headRow.status, `delay ${delay}ms`).toBe('in_progress')
        expect(headCons, `delay ${delay}ms: the called patient keeps their open consultation`).toBe(1)
        expect(callData.queue_entry_id).toBe(head!.id)
        await expect(page.getByRole('dialog').getByRole('alert')).toContainText('already in consultation')
        expect(secondRow.status).toBe('waiting')
      }
      await page.context().clearCookies() // a new scenario, a new session
    }
    console.log(`simultaneous Skip vs Next Patient over ${delaysMs.length} timings: skip won ${outcomes.skipWon}, call won ${outcomes.callWon}`)
    expect(outcomes.skipWon + outcomes.callWon).toBe(delaysMs.length)
    // Both orderings must really have been exercised, or this test proves nothing about one of them.
    expect(outcomes.skipWon, 'no timing let the skip win').toBeGreaterThan(0)
    expect(outcomes.callWon, 'no timing let the call win').toBeGreaterThan(0)
    expect(g.escaped).toEqual([])
  })
})
