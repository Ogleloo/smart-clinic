import { test, expect } from './support/safe-test'
import type { Page } from '@playwright/test'
import { ACCOUNTS, loginAs, waitSettled } from './helpers'

/**
 * Signing out is two steps since components/ui/SignOutConfirm.tsx: the control on the page opens a confirmation
 * dialog, and the dialog's own Sign Out button is the one that reaches the Server Action. Both buttons carry the
 * same accessible name, so the confirm has to be addressed through the dialog.
 *
 * What the dialog refuses to do — Cancel, Escape and the backdrop all signing nobody out — is covered offline in
 * e2e/signout-confirm.spec.ts, where logout() is mocked and "nobody was signed out" is provable as the absence of
 * a call. Here the mock is gone, so these tests only confirm what a confirmed sign-out really does to a live
 * session; Cancel is deliberately not clicked, as this spec is read-only.
 */
async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Sign Out' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Sign Out' }).click()
}

test('patient logout: happy path clears session and redirects to /login', async ({ page }) => {
  await loginAs(page, ACCOUNTS.patient.email, ACCOUNTS.patient.password)
  await expect(page).toHaveURL(/\/dashboard/)

  await signOut(page)
  await waitSettled(page)

  await expect(page).toHaveURL(/\/login$/)

  // Session must actually be gone server-side, not just a client redirect.
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/login/)
})

test('logout double-submit does not error and still lands on /login', async ({ page }) => {
  await loginAs(page, ACCOUNTS.patient.email, ACCOUNTS.patient.password)

  // The double-submit risk moved to the dialog's confirm button — that is the one that reaches the action.
  await page.getByRole('button', { name: 'Sign Out' }).click()
  const button = page.getByRole('dialog').getByRole('button', { name: 'Sign Out' })
  await Promise.all([button.click(), button.click({ force: true }).catch(() => {})])
  await waitSettled(page)

  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByText('Internal Server Error')).not.toBeVisible()
})

test('staff logout redirects to /login and protected staff route is no longer reachable', async ({ page }) => {
  await loginAs(page, ACCOUNTS.nurse.email, ACCOUNTS.nurse.password)
  // A nurse now lands on the V3 dashboard, whose sidebar carries "Sign Out" (the classic /nurse screen has "Log out").
  await expect(page).toHaveURL(/\/nurse\/dashboard$/)

  await signOut(page)
  await waitSettled(page)
  await expect(page).toHaveURL(/\/login$/)

  await page.goto('/nurse')
  await expect(page).toHaveURL(/\/login/)
})

test('visiting /login while already logged out shows the login form, no crash', async ({ page }) => {
  await page.goto('/login')
  await expect(page.locator('input[name="email"]')).toBeVisible()
  await expect(page.getByText('Internal Server Error')).not.toBeVisible()
})

test('idle-timeout reason param renders the distinct idle message, not the plain login form', async ({ page }) => {
  await page.goto('/login?reason=idle')
  await expect(page.getByText('You were signed out because this device was inactive.')).toBeVisible()
})
