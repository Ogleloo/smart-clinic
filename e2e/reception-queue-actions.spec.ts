import type { Page } from '@playwright/test'
import { test, expect } from './support/guarded-test'
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
 * Queue Management — Skip Patient Server Action (moved out of reception-queue.spec.ts).
 *
 * These tests CLICK Skip and submit the real Skip Patient Server Action — with a forged (nonexistent) queue entry id, and
 * repeatedly (double submit, retry). They are expected to be rejected by the database, but they still invoke a
 * mutation-capable endpoint, so they are DESTRUCTIVE by classification: disabled by default and run only with
 * E2E_ENABLE_DESTRUCTIVE=1 against a verified local Supabase stack (e2e/support/e2e-safety.ts). The read-only queue
 * tests stay in reception-queue.spec.ts.
 */
test.describe('Queue Management — Skip Patient submissions (local stack only)', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, ACCOUNTS.receptionist.email, ACCOUNTS.receptionist.password)
    await page.goto('/reception/queue')
    await page.waitForLoadState('networkidle')
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
})
