import { test, expect } from '@playwright/test'
import { ACCOUNTS, loginAs } from './helpers'

/**
 * Queue Management (Phase 3 — Figma frames 114:736 / 114:1204 / 114:1353).
 *
 * Every assertion here reads real, live data from the shared dev Supabase
 * project (get_service_queue, services) — no resetDemoState(), no writes,
 * nothing mutated. That's deliberate: skip_patient() has a known clinic-
 * isolation gap (see docs/SESSION_HANDOFF.md and SkipPatientModal.tsx), so
 * the Confirm action is disabled in the UI and this suite never attempts to
 * call it — there is no live-write path to test here at all. Structural
 * behaviour (ordering, filtering, the waiting-vs-in-consultation action
 * split, the modal, responsiveness) is still fully exercised against
 * whatever the real queue happens to contain right now, rather than against
 * a fixed fixture.
 */
test.describe('Queue Management', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, ACCOUNTS.receptionist.email, ACCOUNTS.receptionist.password)
    await page.goto('/reception/queue')
    await page.waitForLoadState('networkidle')
  })

  test('loads the live queue with a coherent 1..N position column', async ({ page }) => {
    const positions = await page.locator('table tbody tr td:first-child').allTextContents()
    if (positions.length === 0) {
      test.info().annotations.push({ type: 'skip-reason', description: 'queue is currently empty — nothing to order' })
      return
    }
    expect(positions.map(Number)).toEqual(positions.map((_, i) => i + 1))
  })

  test('"All services" combines every service, and an individual filter narrows to just that service', async ({ page }) => {
    const allRows = await page.locator('table tbody tr').count()
    const serviceFilters = page.locator('button[aria-pressed]')
    const filterCount = await serviceFilters.count()
    test.skip(filterCount === 0, 'no individual service filters available (clinic has no active services)')

    const firstFilter = serviceFilters.first()
    const serviceName = (await firstFilter.textContent())?.trim()
    await firstFilter.click()
    await page.waitForTimeout(200)

    const filteredRows = await page.locator('table tbody tr').count()
    expect(filteredRows).toBeLessThanOrEqual(allRows)

    if (filteredRows > 0 && serviceName) {
      const serviceCells = await page.locator('table tbody tr td:nth-child(4)').allTextContents()
      for (const cell of serviceCells) expect(cell.trim()).toBe(serviceName)
    }
  })

  test('waiting rows offer Skip; in-consultation rows show status only, never a Next/action button', async ({ page }) => {
    await page.getByRole('button', { name: 'All services' }).click()
    await page.waitForTimeout(200)

    const rows = page.locator('table tbody tr')
    const rowCount = await rows.count()
    test.skip(rowCount === 0, 'queue is currently empty')

    for (let i = 0; i < rowCount; i++) {
      const row = rows.nth(i)
      const statusText = (await row.locator('td:nth-child(5)').textContent())?.trim() ?? ''
      const actionsCell = row.locator('td:last-child')
      // Nurse-only Call Next must never appear for a receptionist, in any row.
      await expect(actionsCell.getByRole('button', { name: 'Next' })).toHaveCount(0)

      if (statusText.includes('Waiting')) {
        await expect(actionsCell.getByRole('button', { name: 'Skip' })).toHaveCount(1)
      } else {
        await expect(actionsCell.getByRole('button', { name: 'Skip' })).toHaveCount(0)
      }
    }
  })

  test('Skip opens the confirmation modal with real patient details; Confirm is disabled and never calls skip_patient', async ({
    page,
  }) => {
    let skipPatientCalled = false
    await page.route(
      (url) => url.pathname.endsWith('/rest/v1/rpc/skip_patient'),
      (route) => {
        skipPatientCalled = true
        route.abort()
      }
    )

    const skipButton = page.getByRole('button', { name: 'Skip' }).first()
    test.skip((await skipButton.count()) === 0, 'no waiting patient currently available to open the modal against')

    const row = page.locator('table tbody tr').filter({ has: page.getByRole('button', { name: 'Skip' }) }).first()
    const expectedToken = (await row.locator('td:nth-child(2)').textContent())?.trim()
    const expectedPatient = (await row.locator('td:nth-child(3)').textContent())?.trim()

    await skipButton.click()

    const dialog = page.getByRole('dialog', { name: 'Skip patient' })
    await expect(dialog).toBeVisible()
    if (expectedToken) await expect(dialog).toContainText(expectedToken)
    if (expectedPatient) await expect(dialog).toContainText(expectedPatient)

    const confirmButton = dialog.getByRole('button', { name: /Skip patient/i })
    await expect(confirmButton).toBeDisabled()
    await expect(dialog.getByText(/temporarily unavailable/i)).toBeVisible()

    // Cancel must close without ever reaching the RPC.
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).not.toBeVisible()
    expect(skipPatientCalled).toBe(false)
  })

  test('Escape closes the Skip modal without changing the queue', async ({ page }) => {
    const skipButton = page.getByRole('button', { name: 'Skip' }).first()
    test.skip((await skipButton.count()) === 0, 'no waiting patient currently available to open the modal against')

    const rowsBefore = await page.locator('table tbody tr').count()
    await skipButton.click()
    await expect(page.getByRole('dialog')).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).not.toBeVisible()
    expect(await page.locator('table tbody tr').count()).toBe(rowsBefore)
  })

  test('responsive at 390px: stacked queue cards, no page-level horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(200)

    await expect(page.locator('table')).toBeHidden()

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    )
    expect(overflow).toBe(false)
  })

  test('desktop at 1440px: the queue table never overflows its card', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1024 })
    await page.waitForTimeout(200)

    const table = page.locator('table')
    if ((await table.count()) === 0) return

    const overflow = await table.evaluate((el) => el.scrollWidth > el.clientWidth)
    expect(overflow).toBe(false)
  })
})
