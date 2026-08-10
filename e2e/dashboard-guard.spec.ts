import { test, expect } from '@playwright/test'
import { ACCOUNTS, loginAs, resetDemoState } from './helpers'

/**
 * Regression test: the profiles query on /dashboard used to run
 * .single() with no auth_user_id filter, relying entirely on RLS to
 * return one row. That's true for a patient but not for staff — staff
 * can read patient profiles relationally (ADR-021), so RLS returned
 * many rows for a nurse/receptionist/admin, and .single() threw
 * PGRST116 ("Couldn't load your account"). The real fix is the missing
 * role guard on the (patient) layout (it only checked "is there a
 * user", never the role); the query filter is defense in depth.
 */
for (const [role, account, ownHome] of [
  ['nurse', ACCOUNTS.nurse, '/nurse'],
  ['receptionist', ACCOUNTS.receptionist, '/reception'],
  ['admin', ACCOUNTS.admin, '/admin'],
] as const) {
  test(`${role} visiting /dashboard directly is redirected, not crashed`, async ({ page }) => {
    await resetDemoState()
    await loginAs(page, account.email, account.password)

    await page.goto('/dashboard')
    await page.waitForURL(`**${ownHome}`, { timeout: 15_000 })

    await expect(page.getByText("Couldn't load your account")).not.toBeVisible()
  })
}

test('patient visiting /dashboard directly still works normally', async ({ page }) => {
  await resetDemoState()
  await loginAs(page, ACCOUNTS.patient.email, ACCOUNTS.patient.password)

  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')

  await expect(page.getByText("Couldn't load your account")).not.toBeVisible()
  await expect(page.getByText('Hello, Thabo')).toBeVisible()
})
