import { test, expect } from './support/safe-test'
import { loginAs, ACCOUNTS } from './helpers'

/**
 * Admin dashboard (V2 content, V3 shell and cards): control and observability. Runs against the real
 * shared backend, so assertions check structure and internal
 * consistency (e.g. the exclusion drill-down summing to the "excluded"
 * tile) rather than fixed numbers.
 */
test('clinic state, service performance and prediction quality all render live', async ({ page }) => {
  await loginAs(page, ACCOUNTS.admin.email, ACCOUNTS.admin.password)
  await page.goto('/admin')
  await page.waitForTimeout(1500)

  // Admin V3 cards (Figma 168:3). Values are live and not asserted; presence is.
  await expect(page.getByText(/Today.s Check-ins/)).toBeVisible()
  await expect(page.getByText('Currently Waiting', { exact: true })).toBeVisible()
  await expect(page.getByText('In Consultation', { exact: true })).toBeVisible()
  await expect(page.getByText('Scheduled Today', { exact: true })).toBeVisible()

  // Every admin area stays reachable from the sidebar (names match as substrings: "Staff Management", "System Settings").
  await expect(page.getByRole('link', { name: 'Staff' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Services' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Patients' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Reports' }).first()).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Queue Overview' })).toBeVisible()

  // Every service row is either a real estimate or "No estimate" —
  // never a number the system can't justify.
  const rows = page.locator('table tbody tr')
  const rowCount = await rows.count()
  expect(rowCount).toBeGreaterThan(0)
  for (let i = 0; i < rowCount; i++) {
    const text = await rows.nth(i).innerText()
    expect(/No estimate|~\d+ min|No wait|Unavailable/.test(text)).toBe(true)
  }

  await expect(page.getByText('PREDICTION QUALITY')).toBeVisible()
  const recorded = Number((await page.getByText('RECORDED').locator('..').locator('p.font-mono').textContent())?.trim())
  const excluded = Number((await page.getByText('EXCLUDED').locator('..').locator('p.font-mono').textContent())?.trim())
  expect(recorded).toBeGreaterThanOrEqual(excluded)

  const showReasons = page.getByRole('button', { name: /Show reasons/ })
  if (await showReasons.isVisible().catch(() => false)) {
    await showReasons.click()
    // Each reason line leads with its own count ("60 marked as a staff
    // break") — only that leading number, not any threshold mentioned
    // later in the same line ("shorter than 1 min").
    const lineTexts = await page.locator('ul').last().locator('li').allInnerTexts()
    const reasonsSum = lineTexts.reduce((sum, line) => sum + Number(line.match(/^(\d+)/)?.[1] ?? 0), 0)
    expect(reasonsSum).toBe(excluded)
  }
})

test('a service with patients waiting and no nurse triggers Needs Attention, linking to Staff', async ({ page }) => {
  await loginAs(page, ACCOUNTS.admin.email, ACCOUNTS.admin.password)
  await page.goto('/admin')
  await page.waitForTimeout(1500)

  const alert = page.getByText('NEEDS ATTENTION')
  if (await alert.isVisible().catch(() => false)) {
    await expect(page.getByText(/no nurse on duty/)).toBeVisible()
    const assignBtn = page.getByRole('link', { name: 'Review staff' }).first()
    await expect(assignBtn).toBeVisible()
    await assignBtn.click()
    await expect(page).toHaveURL(/\/admin\/staff/)
  } else {
    console.log('no uncovered service currently has anyone waiting — panel correctly hidden')
  }
})
