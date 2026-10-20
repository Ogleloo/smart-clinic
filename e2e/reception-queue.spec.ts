import { test, expect } from './support/safe-test'
import { ACCOUNTS, loginAs } from './helpers'

/**
 * Queue Management (Phase 3 — Figma frames 114:736 / 114:1204 / 114:1353) — READ-ONLY.
 *
 * Reads real, live data and checks layout. It never clicks Skip and never submits a Server Action: every test that
 * opens the Skip modal or submits a skip (including forged-id and double-submit attempts) lives in
 * reception-queue-actions.spec.ts, which is destructive-class and local-stack only. Tests needing a waiting patient
 * skip themselves when today's queue has none.
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

  test('responsive at 390px: stacked queue cards, no page-level horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(200)

    await expect(page.locator('table')).toBeHidden()

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    )
    expect(overflow).toBe(false)
  })

  // 768 used to overflow: the header's fixed 480px title block left the photo 0px wide and pushed the page sideways.
  for (const width of [768, 900, 1024, 1280]) {
    test(`no page-level horizontal scroll at ${width}px, and the header photo keeps a real width`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.waitForTimeout(250)

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
      )
      expect(overflow).toBe(false)

      const photoWidth = await page.locator('main img').first().evaluate((el) => el.getBoundingClientRect().width)
      expect(photoWidth).toBeGreaterThan(150)
    })
  }

  test('desktop at 1440px: the queue table never overflows its card', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1024 })
    await page.waitForTimeout(200)

    const table = page.locator('table')
    if ((await table.count()) === 0) return

    const overflow = await table.evaluate((el) => el.scrollWidth > el.clientWidth)
    expect(overflow).toBe(false)
  })
})
