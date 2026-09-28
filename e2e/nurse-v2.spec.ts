import { test, expect } from '@playwright/test'
import { loginAs, ACCOUNTS } from './helpers'

/**
 * V2 nurse consultation screen. Deliberately tolerant of whatever state
 * the shared demo queue is already in (a long-open consultation, an
 * expiring undo strip, an empty queue) rather than assuming a fixed
 * starting point — this suite runs against the real backend, not a
 * per-test-isolated database.
 */
test('call, elapsed timer, undo, and waiting-list row actions', async ({ page }) => {
  await loginAs(page, ACCOUNTS.nurse.email, ACCOUNTS.nurse.password)
  await page.goto('/nurse')

  await expect(page.getByText(/On duty ·/)).toBeVisible()
  await page.waitForTimeout(1500) // let hydration + the initial live-queue fetch settle

  // Resolve a long-consultation gate if one happens to be open from a
  // prior run — it blocks everything else on this screen.
  const recordBtn = page.getByRole('button', { name: /Record \d+ min/ })
  if (await recordBtn.isVisible().catch(() => false)) {
    await recordBtn.click()
    await page.waitForTimeout(1000)
  }

  // If an undo strip is already showing from a prior run, resolve it —
  // this both exercises undo and clears the slate.
  let undoBtn = page.getByRole('button', { name: /Undo \(\d+s\)/ })
  if (await undoBtn.isVisible().catch(() => false)) {
    await undoBtn.click()
    await page.waitForTimeout(1000)
  }

  // Call/advance once — the one primary action available whether idle
  // or already serving someone.
  const callBtn = page.getByRole('button', { name: /Next patient|Call next patient/ })
  await expect(callBtn).toBeVisible({ timeout: 15000 })
  await callBtn.click()

  if (await recordBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await recordBtn.click()
    await page.waitForTimeout(1000)
  }

  // Elapsed timer runs, if the call actually reached someone.
  const inConsultation = await page.getByText('In consultation').isVisible({ timeout: 5000 }).catch(() => false)
  if (inConsultation) {
    const timerLocator = page.locator('p.font-mono.text-2xl', { hasText: /^\d\d:\d\d$/ }).first()
    await expect(timerLocator).toBeVisible()
    const t1 = await timerLocator.textContent()
    await page.waitForTimeout(2200)
    const t2 = await timerLocator.textContent()
    expect(t1).not.toBe(t2)

    // Skip/Mark emergency appear on waiting rows only.
    const waitingRows = page.locator('table tbody tr')
    if ((await waitingRows.count()) > 0) {
      await expect(waitingRows.first().getByRole('button', { name: 'Skip' })).toBeVisible()
      await expect(waitingRows.first().getByRole('button', { name: 'Mark emergency' })).toBeVisible()
    }
  }

  // Undo the call just made, and confirm it actually reverses it — not
  // just that the button disappears, but that the queue entry the RPC
  // owns is genuinely back to 'waiting'.
  undoBtn = page.getByRole('button', { name: /Undo \(\d+s\)/ })
  await expect(undoBtn).toBeVisible({ timeout: 10000 })
  const undoLine = await page.getByText(/^Called /).textContent()
  const undoneToken = undoLine?.match(/Called ([A-Z]{2,3}-\d+)/)?.[1]
  await undoBtn.click()

  if (undoneToken) {
    await expect(page.getByText(undoneToken).first()).toBeVisible({ timeout: 10000 })
    // Restored to the waiting table specifically, not just visible
    // somewhere on the page (e.g. still lingering in a stale card).
    await expect(page.locator('table').getByText(undoneToken)).toBeVisible()
  }
})
