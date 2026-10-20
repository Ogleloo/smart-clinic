import { expect } from '@playwright/test'
import { test } from './support/guarded-test'
import { loginAs, ACCOUNTS } from './helpers'

// Split out of clinic-hours.spec.ts: this test SAVES the clinic's opening hours (an admin write, even though the values
// are unchanged), so it is a destructive spec — disabled by default, local stack only (e2e/support/e2e-safety.ts).

test('admin opening-hours editor loads current values and saves', async ({ page }) => {
  await loginAs(page, ACCOUNTS.admin.email, ACCOUNTS.admin.password)
  await page.goto('/admin/settings')
  await expect(page.getByRole('heading', { name: 'Opening hours' })).toBeVisible()

  const sundayRow = page.locator('div.rounded-lg', { has: page.getByText('Sunday', { exact: true }) })
  await expect(sundayRow.getByRole('checkbox')).toBeChecked()

  const mondayRow = page.locator('div.rounded-lg', { has: page.getByText('Monday', { exact: true }) })
  await expect(mondayRow.getByRole('checkbox')).not.toBeChecked()
  await expect(mondayRow.locator('input[type="time"]').first()).toHaveValue('07:30')

  // Submits the form's own current (unchanged) values — proves the
  // server action, grant and admin-scoped RLS policy all work without
  // altering what production actually serves.
  await page.getByRole('button', { name: 'Save opening hours' }).click()
  await expect(page.getByText('Saved.')).toBeVisible()
})
