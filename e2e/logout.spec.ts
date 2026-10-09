import { test, expect } from '@playwright/test'
import { ACCOUNTS, loginAs, waitSettled } from './helpers'

test('patient logout: happy path clears session and redirects to /login', async ({ page }) => {
  await loginAs(page, ACCOUNTS.patient.email, ACCOUNTS.patient.password)
  await expect(page).toHaveURL(/\/dashboard/)

  await page.getByRole('button', { name: 'Sign Out' }).click()
  await waitSettled(page)

  await expect(page).toHaveURL(/\/login$/)

  // Session must actually be gone server-side, not just a client redirect.
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/login/)
})

test('logout double-submit does not error and still lands on /login', async ({ page }) => {
  await loginAs(page, ACCOUNTS.patient.email, ACCOUNTS.patient.password)

  const button = page.getByRole('button', { name: 'Sign Out' })
  await Promise.all([button.click(), button.click({ force: true }).catch(() => {})])
  await waitSettled(page)

  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByText('Internal Server Error')).not.toBeVisible()
})

test('staff logout redirects to /login and protected staff route is no longer reachable', async ({ page }) => {
  await loginAs(page, ACCOUNTS.nurse.email, ACCOUNTS.nurse.password)
  await expect(page).toHaveURL(/\/nurse/)

  await page.getByRole('button', { name: 'Log out' }).click()
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
