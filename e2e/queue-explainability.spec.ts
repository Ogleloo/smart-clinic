import { test, expect, type Page } from '@playwright/test'
import { ACCOUNTS, createTestClient, loginAs, resetDemoState, waitSettled } from './helpers'

/**
 * V2 patient queue screen — the explainability work (breakdown, expandable
 * confidence) is only trustworthy if the shown working actually reproduces
 * the shown answer. These check that identity against live data, not
 * fixtures, per ADR-009 (get_wait_estimate is the one source of truth;
 * nothing here re-derives queue logic).
 */

async function callNextPatientTimes(page: Page, times: number) {
  for (let i = 0; i < times; i++) {
    await page.getByRole('button', { name: /^(Call next patient|Next patient)$/ }).click()
    await waitSettled(page)
  }
}

test('booked but not checked in renders the explanatory state, not a blank', async ({ page }) => {
  const stamp = Date.now()
  const email = `qa-explain-booked-${stamp}@example.com`
  const password = 'Sup3rSecret!23'

  const anon = createTestClient()
  const { error: signUpError } = await anon.auth.signUp({
    email,
    password,
    options: { data: { full_name: 'QA Explain Booked', phone: '0000000009' } },
  })
  expect(signUpError).toBeNull()

  const { data: services } = await anon.from('services').select('id, name').eq('is_active', true).order('name')
  const service = services!.find((s) => s.name === 'Pharmacy') ?? services![services!.length - 1]

  let slot: string | null = null
  for (let daysAhead = 1; daysAhead <= 14 && !slot; daysAhead++) {
    const target = new Date(Date.now() + daysAhead * 24 * 3600 * 1000)
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg' }).format(target)
    const { data: slots } = await anon.rpc('get_available_slots', { p_service_id: service.id, p_date: date })
    slot = slots?.find((s) => !s.is_taken)?.slot_time ?? null
  }
  expect(slot).not.toBeNull()

  const { error: bookError } = await anon.rpc('book_appointment', { p_service_id: service.id, p_slot: slot! })
  expect(bookError).toBeNull()
  await anon.auth.signOut()

  await loginAs(page, email, password)
  // loginAs only waits for the login form's own "Please wait" to clear;
  // the dashboard it redirects to still has its own server-side fetches
  // in flight (profile, appointment, queue) under this sandbox's variable
  // latency, so wait for real dashboard content before reading it.
  await page.getByText(/^Hello, /).waitFor({ timeout: 15_000 })
  const mainText = await page.locator('main').innerText()
  expect(mainText).toMatch(/Your appointment is (today|on) /)
  expect(mainText).toContain('Check in at reception')
})

test('single-nurse breakdown reproduces the displayed estimate', async ({ page }) => {
  await resetDemoState()
  await loginAs(page, ACCOUNTS.patient.email, ACCOUNTS.patient.password)
  await page.goto('/queue')
  await page.waitForLoadState('networkidle')

  await page.getByRole('button', { name: 'How is this calculated?' }).click()
  const breakdownText = await page.locator('main').innerText()

  const match = breakdownText.match(/(\d+) \+ \((\d+) × (\d+) min\) ≈ (\d+) min/)
  expect(match).not.toBeNull()
  const [, soonestFree, ahead, avg, shownEstimate] = match!.map(Number)

  // Rounded independently at the database layer (ceil vs round — migration
  // 0050), so this is "≈", not "=": allow the same small rounding gap the
  // backend itself can produce, not exact equality.
  expect(Math.abs(soonestFree + ahead * avg - shownEstimate)).toBeLessThanOrEqual(1)
  expect(breakdownText).not.toMatch(/\d+\.\d/) // never a decimal
})

test('multi-nurse shows the method sentence, no equation', async () => {
  // Marked fixme rather than deleted: this scenario genuinely needs a
  // second nurse on duty for the same service, and there is currently no
  // safe way to create that from a test.
  //
  //   - A throwaway nurse profile doesn't work: set_duty() checks the
  //     service's clinic_id against the caller's own clinic_id, and no
  //     public API sets clinic_id on a profile. admin_set_staff_status
  //     only touches role/is_active; the column-level grant on profiles
  //     covers just full_name/phone, even for an admin caller (RLS
  //     would allow the write — auth_role() = 'admin' — but there's no
  //     grant for that column, and a policy without a grant does nothing).
  //   - The existing second seeded nurse (Sr. Pillay) has clinic_id set
  //     and would work, but her password isn't known here, and directly
  //     writing her is_on_duty/current_service_id via elevated database
  //     access was (correctly) refused as a live write to shared state
  //     outside this test's own account.
  //   - Mocking the RPC response via page.route() does not work either:
  //     /queue's initial render is a Server Component, fetching directly
  //     from Node, never touching the browser's network stack that
  //     page.route() intercepts.
  //
  // The branch itself (nurses_serving !== 1 in WaitBreakdown) is a plain
  // conditional reusing the same Row primitive already proven correct in
  // the single-nurse test above, with static copy on the untested side —
  // reviewed, not live-verified. Automating this needs either a
  // clinic-scoping RPC for staff setup or credentials for a second
  // seeded nurse.
  test.fixme(true, 'No safe way to create live 2-nurse state — see comment above')
})

test('no nurse on duty: no number anywhere, breakdown absent', async ({ page, browser }) => {
  await resetDemoState()

  const nurseContext = await browser.newContext()
  const nursePage = await nurseContext.newPage()
  await loginAs(nursePage, ACCOUNTS.nurse.email, ACCOUNTS.nurse.password)
  await nursePage.getByRole('button', { name: 'End session' }).click()
  const continueBtn = nursePage.getByRole('button', { name: 'Continue' })
  const startSessionBtn = nursePage.getByText('Start session', { exact: true })
  await Promise.race([
    continueBtn.waitFor({ state: 'visible', timeout: 30_000 }),
    startSessionBtn.waitFor({ state: 'visible', timeout: 30_000 }),
  ])
  if (await continueBtn.isVisible().catch(() => false)) {
    await continueBtn.click()
    await startSessionBtn.waitFor({ state: 'visible', timeout: 30_000 })
  }
  await nurseContext.close()

  await loginAs(page, ACCOUNTS.patient.email, ACCOUNTS.patient.password)
  await page.goto('/queue')
  await page.waitForLoadState('networkidle')

  const text = await page.locator('main').innerText()
  expect(text).toContain('Not currently being served')
  expect(text).not.toMatch(/\d+ min/)
  expect(text).not.toContain('How is this calculated?')
})

test('position 1 with a busy nurse shows a non-zero estimate', async ({ page, browser }) => {
  await resetDemoState()

  const nurseContext = await browser.newContext()
  const nursePage = await nurseContext.newPage()
  await loginAs(nursePage, ACCOUNTS.nurse.email, ACCOUNTS.nurse.password)
  // Two calls: the first starts the nurse on the patient currently ahead
  // of Thabo; the second finishes that one and starts the next — leaving
  // Thabo at position 1 while the nurse is demonstrably still busy, not idle.
  await callNextPatientTimes(nursePage, 2)
  await nurseContext.close()

  await loginAs(page, ACCOUNTS.patient.email, ACCOUNTS.patient.password)
  await page.goto('/queue')
  await page.waitForLoadState('networkidle')

  const text = await page.locator('main').innerText()
  expect(text).toContain('You’re next')
  expect(text).toMatch(/~\d+ min/)
  expect(text).not.toMatch(/~0 min/)

  // Confirm against the database directly too — the UI showing a number
  // is only meaningful if it's actually position 1. queue_date scopes to
  // today: queue_entries accumulates every past day's rows, and RLS
  // scopes this query to Thabo's own regardless, but not to today alone.
  const asThabo = createTestClient()
  const { error: signInError } = await asThabo.auth.signInWithPassword(ACCOUNTS.patient)
  expect(signInError).toBeNull()
  const { data: entries } = await asThabo
    .from('queue_entries')
    .select('id')
    .eq('status', 'waiting')
    .eq('queue_date', 'today')
  expect(entries?.length).toBe(1)
  const { data: estimate } = await asThabo.rpc('get_wait_estimate', { p_queue_entry_id: entries![0].id }).single()
  expect(estimate?.queue_position).toBe(1)
  expect(estimate?.estimated_wait_minutes).not.toBeNull()
  expect(estimate?.estimated_wait_minutes ?? 0).toBeGreaterThan(0)
  await asThabo.auth.signOut()
})
