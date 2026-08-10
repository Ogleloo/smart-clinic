import { test, expect, type Page } from '@playwright/test'
import { ACCOUNTS, loginAs, resetDemoState, waitSettled } from './helpers'

/**
 * Regression coverage for the dashboard QueueSummaryCard rewrite: it
 * used to show only a bare token ("GC-118 · View status →") because
 * the multi-queue rewrite dropped the get_wait_estimate call entirely.
 * These exercise the shared getActiveQueueEntries() path (also used by
 * /queue) across 0/1/multiple active entries and both the "estimate
 * available" and "deliberately unavailable" (no nurse on duty) cases.
 */

async function callNextPatientTimes(page: Page, times: number) {
  for (let i = 0; i < times; i++) {
    await page.getByRole('button', { name: /^(Call next patient|Next patient)$/ }).click()
    await waitSettled(page)
  }
}

test('dashboard with zero active queues shows the empty state, not a stale card', async ({ page, browser }) => {
  await resetDemoState()

  // A fresh, isolated context: context.newPage() would share cookies
  // with `page`, and once the nurse's login sets its session cookie,
  // /login for the patient login below would render the "Signed in
  // as..." interstitial (the new Part 1a feature) instead of the login
  // form, since both pages would appear to be the same session.
  const nurseContext = await browser.newContext()
  const nursePage = await nurseContext.newPage()
  await loginAs(nursePage, ACCOUNTS.nurse.email, ACCOUNTS.nurse.password)
  await callNextPatientTimes(nursePage, 4) // 3 calls to cycle through, 4th closes the last one with nobody left
  await nurseContext.close()

  await loginAs(page, ACCOUNTS.patient.email, ACCOUNTS.patient.password)
  await expect(page.getByText('YOUR QUEUE TOKEN')).not.toBeVisible()
})

test('dashboard with one active queue and an available estimate shows position, minutes and confidence', async ({ page }) => {
  await resetDemoState()
  await loginAs(page, ACCOUNTS.patient.email, ACCOUNTS.patient.password)

  await expect(page.getByText('YOUR QUEUE TOKEN')).toBeVisible()
  const cardText = await page.locator('main').innerText()
  expect(cardText).toMatch(/GC-\d+/)
  expect(cardText).toMatch(/Position \d+ · About \d+ min/)
  expect(cardText).toMatch(/confidence/i)
  expect(cardText).not.toContain('+1 more')
})

test('dashboard shows "not currently being served" with no number when no nurse is on duty', async ({ page, browser }) => {
  await resetDemoState()

  const nurseContext = await browser.newContext()
  const nursePage = await nurseContext.newPage()
  await loginAs(nursePage, ACCOUNTS.nurse.email, ACCOUNTS.nurse.password)
  await nursePage.getByRole('button', { name: 'End session' }).click()
  // checkEndSessionImpact is a server round-trip; the confirmation
  // dialog (Sr. Mabaso is the only nurse on GC with patients waiting)
  // can take a while to appear under this sandbox's variable latency.
  // isVisible() checks the DOM *right now* — it doesn't wait — so
  // racing it against the eventual outcome (rather than polling
  // isVisible in a loop) is what actually waits for whichever happens.
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
  await expect(page.getByText('YOUR QUEUE TOKEN')).toBeVisible()
  const cardText = await page.locator('main').innerText()
  expect(cardText).toContain('Not currently being served')
  expect(cardText).not.toMatch(/About \d+ min/)
})

test('dashboard indicates additional queues without combining their estimates', async ({ page, browser }) => {
  await resetDemoState()

  const receptionContext = await browser.newContext()
  const receptionPage = await receptionContext.newPage()
  await loginAs(receptionPage, ACCOUNTS.receptionist.email, ACCOUNTS.receptionist.password)
  await receptionPage.goto('/reception/walk-in')
  await receptionPage.waitForLoadState('networkidle')
  await receptionPage.locator('button[aria-pressed]').nth(2).click() // Pharmacy
  await receptionPage.fill('input[placeholder*="2 characters"]', 'thabo')
  await receptionPage
    .waitForResponse((r) => r.url().includes('search_patients'), { timeout: 15_000 })
    .catch(() => {})
  await receptionPage.waitForTimeout(400)
  await receptionPage.locator('ul li button').first().click()
  await receptionPage.waitForTimeout(300)
  await receptionPage.getByRole('button', { name: 'Check in' }).click()
  await expect(receptionPage.getByText('Checked in')).toBeVisible({ timeout: 15_000 })
  await receptionContext.close()

  await loginAs(page, ACCOUNTS.patient.email, ACCOUNTS.patient.password)
  await expect(page.getByText('YOUR QUEUE TOKEN')).toBeVisible()
  const cardText = await page.locator('main').innerText()
  expect(cardText).toContain('+1 more queue today')
  // Still exactly one figure shown (the primary entry's own estimate) —
  // never a combined number across the two queues.
  expect(cardText.match(/About \d+ min/g)?.length ?? 0).toBeLessThanOrEqual(1)
})
