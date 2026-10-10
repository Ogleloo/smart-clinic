import { test, expect, type Page } from '@playwright/test'
import { ACCOUNTS, loginAs } from './helpers'

const NONEXISTENT_ID = 'deadbeef-0000-4000-8000-000000000000'
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

/** Server Actions are invoked by a browser POST carrying a `next-action` header; their internal Supabase RPCs are invisible to page.route. */
function trackServerActions(page: Page) {
  const posts: string[] = []
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.headers()['next-action']) posts.push(req.url())
  })
  return posts
}

/**
 * Swaps the real queue_entry_id in every Server Action POST for a nonexistent UUID, so the real RPC
 * rejects it and nothing is mutated. Fails closed: matches any URL, and aborts any action POST it can't
 * prove it rewrote (not exactly one UUID, or the real id survives) — a real id must never reach the server.
 * `holdMs` keeps each request in flight that long before it is sent, so a test can prove what happens to a
 * second click WHILE the first is pending (an instantly-failing request makes a 'double click' ambiguous).
 */
async function forgeSkipId(page: Page, holdMs = 0) {
  const posts: string[] = []
  const aborted: string[] = []
  await page.route('**/*', async (route) => {
    const req = route.request()
    if (req.method() !== 'POST' || !req.headers()['next-action']) return route.continue()
    const body = req.postData() ?? ''
    const ids = body.match(new RegExp(UUID_RE.source, 'gi')) ?? []
    const forged = ids.length === 1 ? body.split(ids[0]).join(NONEXISTENT_ID) : ''
    if (ids.length !== 1 || ids[0].toLowerCase() === NONEXISTENT_ID || forged.includes(ids[0]) || !forged.includes(NONEXISTENT_ID)) {
      aborted.push(req.url())
      return route.abort()
    }
    posts.push(req.url())
    if (holdMs) await new Promise((r) => setTimeout(r, holdMs))
    await route.continue({ postData: forged })
  })
  return Object.assign(posts, { aborted })
}

/**
 * Queue Management (Phase 3 — Figma frames 114:736 / 114:1204 / 114:1353).
 *
 * Reads real, live data from the shared Supabase project and never performs
 * a successful skip. The Skip write path is exercised only with a forged
 * (nonexistent) queue entry id, which the database rejects without changing
 * anything. Specs needing a waiting patient skip themselves when today's
 * queue has none.
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

  test('Skip opens the modal with real patient details and an enabled Confirm; Cancel sends no Server Action', async ({
    page,
  }) => {
    const actionPosts = trackServerActions(page)
    const skipButton = page.getByRole('button', { name: 'Skip' }).first()
    test.skip((await skipButton.count()) === 0, 'no waiting patient in today\'s live queue')

    const row = page.locator('table tbody tr').filter({ has: page.getByRole('button', { name: 'Skip' }) }).first()
    const expectedToken = (await row.locator('td:nth-child(2)').textContent())?.trim()
    const expectedPatient = (await row.locator('td:nth-child(3)').textContent())?.trim()
    const expectedService = (await row.locator('td:nth-child(4)').textContent())?.trim()
    const rowsBefore = await page.locator('table tbody tr').count()

    await skipButton.click()

    const dialog = page.getByRole('dialog', { name: 'Skip patient' })
    await expect(dialog).toBeVisible()
    if (expectedToken) await expect(dialog).toContainText(expectedToken)
    if (expectedPatient) await expect(dialog).toContainText(expectedPatient)
    if (expectedService) await expect(dialog).toContainText(expectedService)
    await expect(dialog.getByText(/temporarily unavailable/i)).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: /Skip patient/i })).toBeEnabled()

    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).not.toBeVisible()
    expect(actionPosts.length).toBe(0)
    expect(await page.locator('table tbody tr').count()).toBe(rowsBefore)
  })

  test('Escape closes the Skip modal with no Server Action and no queue change', async ({ page }) => {
    const actionPosts = trackServerActions(page)
    const skipButton = page.getByRole('button', { name: 'Skip' }).first()
    test.skip((await skipButton.count()) === 0, 'no waiting patient in today\'s live queue')

    const rowsBefore = await page.locator('table tbody tr').count()
    await skipButton.click()
    await expect(page.getByRole('dialog')).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).not.toBeVisible()
    expect(actionPosts.length).toBe(0)
    expect(await page.locator('table tbody tr').count()).toBe(rowsBefore)
  })

  test('forged queue entry id: the database rejects it, the modal stays open with the error, nothing changes', async ({
    page,
  }) => {
    const skipButton = page.getByRole('button', { name: 'Skip' }).first()
    test.skip((await skipButton.count()) === 0, 'no waiting patient in today\'s live queue')

    const actionPosts = await forgeSkipId(page)
    const rowsBefore = await page.locator('table tbody tr').count()
    await skipButton.click()
    const dialog = page.getByRole('dialog', { name: 'Skip patient' })
    await dialog.getByRole('button', { name: /Skip patient/i }).click()

    await expect(dialog.getByRole('alert')).toContainText(/Queue entry not found/i)
    await expect(dialog).toBeVisible()
    expect(actionPosts.aborted).toEqual([])
    expect(actionPosts.length).toBe(1)
    expect(await page.locator('table tbody tr').count()).toBe(rowsBefore)
    await expect(page.getByRole('button', { name: 'Skip' }).first()).toBeVisible()
  })

  test('double submit while a skip is in flight sends exactly one Server Action; a deliberate retry after the error is allowed', async ({
    page,
  }) => {
    const skipButton = page.getByRole('button', { name: 'Skip' }).first()
    test.skip((await skipButton.count()) === 0, "no waiting patient in today's live queue")

    // Forged id (nothing is mutated) and a 3s hold, so the first request is provably still pending for both clicks.
    const actionPosts = await forgeSkipId(page, 3000)
    await skipButton.click()
    const dialog = page.getByRole('dialog', { name: 'Skip patient' })
    const confirm = dialog.getByRole('button', { name: /Skip patient|Please wait/i })
    // Three clicks in one JS task, before React can re-render the button as disabled. Not Playwright's click():
    // it waits for the button to be enabled, so it would land AFTER the first request finished — a legitimate
    // retry, not a double click. React queues extra submissions and runs them once the first settles, which is
    // why the count that matters is the one AFTER the request settles (verified: without the guard this is 3).
    await confirm.evaluate((el) => {
      const button = el as HTMLButtonElement
      button.click()
      button.click()
      button.click()
    })

    await expect(confirm).toBeDisabled()
    await expect(confirm).toHaveText(/Please wait/i)
    expect(actionPosts.length).toBe(1)

    await expect(dialog.getByRole('alert')).toContainText(/Queue entry not found/i, { timeout: 30_000 })
    await page.waitForTimeout(1500)
    expect(actionPosts.aborted).toEqual([])
    expect(actionPosts.length).toBe(1)

    // After the error the button re-enables, and a deliberate second attempt is a new, legitimate request.
    const retry = dialog.getByRole('button', { name: /Skip patient/i })
    await expect(retry).toBeEnabled({ timeout: 30_000 })
    await retry.click()
    await expect.poll(() => actionPosts.length).toBe(2)
    await expect(dialog.getByRole('alert')).toContainText(/Queue entry not found/i, { timeout: 30_000 })
    expect(actionPosts.aborted).toEqual([])
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
