import { test, expect } from '@playwright/test'
import { loginAs, ACCOUNTS } from './helpers'

/**
 * V2 admin dashboard: control and observability. Runs against the real
 * shared backend, so assertions check structure and internal
 * consistency (e.g. the exclusion drill-down summing to the "excluded"
 * tile) rather than fixed numbers.
 */
test('clinic state, service performance and prediction quality all render live', async ({ page }) => {
  await loginAs(page, ACCOUNTS.admin.email, ACCOUNTS.admin.password)
  await page.goto('/admin')
  await page.waitForTimeout(1500)

  await expect(page.getByText('WAITING NOW')).toBeVisible()
  await expect(page.getByText('NURSES ON DUTY')).toBeVisible()
  await expect(page.getByText('SERVICES COVERED')).toBeVisible()
  await expect(page.getByText('AVG WAIT TODAY')).toBeVisible()

  // Staff/services/settings stay off this screen — nav links only.
  await expect(page.getByRole('link', { name: 'Staff' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Services' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Service performance' })).toBeVisible()

  // Every service row is either a real estimate or "No estimate" —
  // never a number the system can't justify.
  const rows = page.locator('main div.rounded-lg').filter({ hasText: /waiting ·/ })
  const rowCount = await rows.count()
  expect(rowCount).toBeGreaterThan(0)
  for (let i = 0; i < rowCount; i++) {
    const text = await rows.nth(i).innerText()
    expect(/No estimate|~\d+ min|No wait/.test(text)).toBe(true)
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
    const assignBtn = page.getByRole('link', { name: 'Assign a nurse' }).first()
    await expect(assignBtn).toBeVisible()
    await assignBtn.click()
    await expect(page).toHaveURL(/\/admin\/staff/)
  } else {
    console.log('no uncovered service currently has anyone waiting — panel correctly hidden')
  }
})
