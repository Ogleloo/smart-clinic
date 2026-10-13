import { expect as baseExpect, type Page } from '@playwright/test'
import { test } from './support/guarded-test'
import { ACCOUNTS, loginAs as rawLoginAs } from './helpers'

/**
 * Reception Profile Settings — SUBMISSIONS (moved out of reception-profile.spec.ts).
 *
 * Every test here clicks Save Changes or Update password and so submits the real profile / password Server Action — with
 * deliberately invalid input that the action is expected to reject before touching data, and with same-tick double
 * submits. "Expected to fail" is not "cannot write": these call a mutation-capable endpoint, so they are DESTRUCTIVE by
 * classification — disabled by default, run only with E2E_ENABLE_DESTRUCTIVE=1 against a verified local Supabase stack
 * (e2e/support/e2e-safety.ts). The read-only profile tests stay in reception-profile.spec.ts.
 */
const SETTINGS = '/reception/profile/settings'

/** The shared loginAs can return before the post-login redirect lands on a slow server, and the next goto then aborts it. */
async function loginAs(page: Page, email: string, password: string) {
  await rawLoginAs(page, email, password)
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 120_000 })
}
// These pages do several sequential Supabase round trips per load (and recompile on first hit in dev); 5s is too tight.
const expect = baseExpect.configure({ timeout: 30_000 })
test.describe.configure({ timeout: 300_000 })

async function openSettings(page: Page) {
  await loginAs(page, ACCOUNTS.receptionist.email, ACCOUNTS.receptionist.password)
  await page.goto(SETTINGS)
  await expect(page.getByRole('heading', { name: 'Profile Settings', level: 1 })).toBeVisible()
}

/** Every Server Action invocation is a browser POST carrying a `next-action` header. */
function trackActions(page: Page) {
  const posts: string[] = []
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.headers()['next-action']) posts.push(req.url())
  })
  return posts
}

test.describe('Profile Settings — Save Changes submissions (local stack only)', () => {
  test.beforeEach(async ({ page }) => {
    await openSettings(page)
  })

  for (const [label, name, phone, expected] of [
    ['an empty name', '', '', /enter your full name/i],
    ['a one-character name', 'A', '', /at least 2 characters/i],
    ['a letters-only phone number', 'Valid Name', 'abc', /digits, spaces, dashes/i],
    ['a too-short phone number', 'Valid Name', '12345', /south african number/i],
  ] as const) {
    test(`rejects ${label} with a clear message and writes nothing`, async ({ page }) => {
      await page.locator('#full_name').fill(name)
      await page.locator('#phone').fill(phone)
      await page.getByRole('button', { name: 'Save Changes' }).click()
      await expect(page.getByRole('alert').filter({ hasText: expected })).toBeVisible({ timeout: 30_000 })
      // The header chip still shows the saved name: nothing was persisted.
      await expect(page.locator('[aria-label="Signed in as"]')).not.toContainText('Valid Name')
    })
  }

  test('double submit: three same-tick clicks send exactly one Server Action, even while the first is in flight', async ({ page }) => {
    // Invalid input again, so nothing is written whichever way this goes. A 1.5s hold keeps the first request pending.
    await page.route('**/*', async (route) => {
      const req = route.request()
      if (req.method() === 'POST' && req.headers()['next-action']) await new Promise((r) => setTimeout(r, 1500))
      await route.continue()
    })
    await page.locator('#full_name').fill('A')
    const posts = trackActions(page)
    await page.getByRole('button', { name: 'Save Changes' }).evaluate((el) => {
      const b = el as HTMLButtonElement
      b.click()
      b.click()
      b.click()
    })
    await expect(page.getByRole('alert').filter({ hasText: /at least 2 characters/i })).toBeVisible({ timeout: 30_000 })
    await page.waitForTimeout(1500)
    expect(posts.length).toBe(1)
  })
})

test.describe('Profile Settings — Update password submissions (local stack only)', () => {
  test.beforeEach(async ({ page }) => {
    await openSettings(page)
  })

  for (const [label, current, next, confirm, expected] of [
    ['a too-short new password', 'whatever-current', 'short', 'short', /at least 8 characters/i],
    ['mismatched confirmation', 'whatever-current', 'newpassword1', 'newpassword2', /don.t match/i],
    ['a new password equal to the current one', 'same-password-1', 'same-password-1', 'same-password-1', /different from your current/i],
  ] as const) {
    test(`rejects ${label} before any sign-in attempt`, async ({ page }) => {
      await page.getByRole('button', { name: 'Change Password' }).click()
      const panel = page.getByRole('form', { name: 'Change password' })
      await panel.getByLabel('Current password').fill(current)
      await panel.getByLabel('New password', { exact: true }).fill(next)
      await panel.getByLabel('Confirm new password', { exact: true }).fill(confirm)
      await panel.getByRole('button', { name: 'Update password' }).click()
      await expect(panel.getByRole('alert').filter({ hasText: expected })).toBeVisible({ timeout: 30_000 })
    })
  }

  test('a missing current password is stopped by the browser before anything is sent', async ({ page }) => {
    const posts = trackActions(page)
    await page.getByRole('button', { name: 'Change Password' }).click()
    const panel = page.getByRole('form', { name: 'Change password' })
    await panel.getByLabel('New password', { exact: true }).fill('newpassword1')
    await panel.getByLabel('Confirm new password').fill('newpassword1')
    await panel.getByRole('button', { name: 'Update password' }).click()
    await expect(panel.getByLabel('Current password')).toHaveJSProperty('validity.valueMissing', true)
    await page.waitForTimeout(500)
    expect(posts).toHaveLength(0)
  })
})
