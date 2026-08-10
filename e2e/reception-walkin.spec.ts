import { test, expect } from '@playwright/test'
import { ACCOUNTS, loginAs, resetDemoState, waitSettled } from './helpers'

/**
 * Regression test: WalkInWizard used to get permanently stuck on the
 * "Checked in" screen after the first walk-in of a session. The cause
 * was useActionState's internal state (the just-created patient, the
 * check-in token) having no imperative reset — clicking "Register
 * another walk-in" cleared local component state but not that, so the
 * wizard never returned to the service picker. Fixed by remounting the
 * wizard via a key counter on reset; this guards against it coming back.
 */
test('registering a walk-in twice in one session does not get stuck', async ({ page }) => {
  await resetDemoState()
  await loginAs(page, ACCOUNTS.receptionist.email, ACCOUNTS.receptionist.password)

  async function registerOneWalkIn(patientName: string) {
    await page.goto('/reception/walk-in')
    await page.waitForLoadState('networkidle')

    await page.locator('button[aria-pressed]').first().click()
    await page.fill('input[placeholder*="2 characters"]', patientName.toLowerCase())
    await page
      .waitForResponse((r) => r.url().includes('search_patients'), { timeout: 15_000 })
      .catch(() => {})
    await page.waitForTimeout(400)

    await page.getByRole('button', { name: 'Add new patient' }).click()
    await page.fill('input[name="full_name"]', patientName)
    await page.getByRole('button', { name: 'Add patient' }).click()
    await waitSettled(page)

    await page.getByRole('button', { name: 'Check in' }).click()
    await expect(page.getByText('Checked in')).toBeVisible({ timeout: 15_000 })
  }

  const suffix = Date.now()
  await registerOneWalkIn(`E2E Walkin One ${suffix}`)

  await page.getByRole('button', { name: 'Register another walk-in' }).click()
  // The regression: this used to stay on "Checked in" forever. It must
  // return to the service picker (step 1).
  await expect(page.getByText('1. SERVICE')).toBeVisible({ timeout: 5_000 })
  await expect(page.getByText('Checked in')).not.toBeVisible()

  await registerOneWalkIn(`E2E Walkin Two ${suffix}`)
  await expect(page.getByText('Checked in')).toBeVisible()
})
