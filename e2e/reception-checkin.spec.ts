import { test, expect } from '@playwright/test'
import { ACCOUNTS, loginAs, resetDemoState, waitSettled } from './helpers'

/**
 * Unified check-in wizard (Phase 2 — Figma frames 111:183 / 111:342 /
 * 111:487 / 112:302). Covers the walk-in path end to end; the
 * appointment path needs either a seeded "booked today" fixture or a
 * same-day booking helper this suite doesn't have yet — see the
 * test.skip block at the bottom and docs/SESSION_HANDOFF.md.
 */

async function registerAndCheckInWalkIn(page: import('@playwright/test').Page, patientName: string, service: string) {
  await page.goto('/reception/check-in')
  await page.waitForLoadState('networkidle')

  await page.fill('input[placeholder*="2 characters"]', patientName.toLowerCase())
  await page
    .waitForResponse((r) => r.url().includes('search_patients'), { timeout: 15_000 })
    .catch(() => {})
  await page.waitForTimeout(400)

  await page.getByRole('button', { name: 'Register walk-in patient' }).click()
  await page.fill('input[name="full_name"]', patientName)
  await page.getByRole('button', { name: 'Add patient' }).click()
  await waitSettled(page)

  await expect(page.getByText('No booked appointment today')).toBeVisible()
  await page.getByText(service, { exact: true }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Confirm check-in' }).click()
  await waitSettled(page)
}

test.describe('Unified check-in wizard', () => {
  test.beforeEach(async ({ page }) => {
    await resetDemoState()
    await loginAs(page, ACCOUNTS.receptionist.email, ACCOUNTS.receptionist.password)
  })

  test('genuine new walk-in: search finds nobody, register, check in, real token shown', async ({ page }) => {
    const name = `E2E CheckIn WalkIn ${Date.now()}`
    await registerAndCheckInWalkIn(page, name, 'General Consultation')

    await expect(page.getByText('Patient checked in successfully!')).toBeVisible()
    await expect(page.getByText(name)).toBeVisible()
    // A real token, not a placeholder — matches the GC-### / IM-### / PH-### format real services issue.
    await expect(page.locator('text=/^[A-Z]{2,3}-\\d{3}$/')).toBeVisible()
  })

  test('check in another patient resets the wizard back to step 1 (no stuck regression)', async ({ page }) => {
    const name = `E2E CheckIn Reset ${Date.now()}`
    await registerAndCheckInWalkIn(page, name, 'Pharmacy')
    await expect(page.getByText('Patient checked in successfully!')).toBeVisible()

    await page.getByRole('button', { name: 'Check in another patient' }).click()
    await expect(page.getByText('1. Find patient')).toBeVisible()
    await expect(page.locator('input[placeholder*="2 characters"]')).toBeVisible()
    await expect(page.getByText('Patient checked in successfully!')).not.toBeVisible()
  })

  test('duplicate / rapid check-in for the same patient and service surfaces the real RPC error', async ({ page }) => {
    const name = `E2E CheckIn Dup ${Date.now()}`
    await registerAndCheckInWalkIn(page, name, 'Immunization')
    await expect(page.getByText('Patient checked in successfully!')).toBeVisible()

    // Re-check-in the same patient for the same service — the first screen
    // after reset is the search box again; the patient now has a queue
    // entry, so search_patients will find them this time.
    await page.getByRole('button', { name: 'Check in another patient' }).click()
    await page.fill('input[placeholder*="2 characters"]', name.toLowerCase())
    await page
      .waitForResponse((r) => r.url().includes('search_patients'), { timeout: 15_000 })
      .catch(() => {})
    await page.waitForTimeout(400)
    await page.locator('ul li button').first().click()
    await page.waitForTimeout(600)

    await page.getByText('Immunization', { exact: true }).click()
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByRole('button', { name: 'Confirm check-in' }).click()

    await expect(page.getByText('already in the queue for this service today')).toBeVisible({ timeout: 10_000 })
    // The button must recover, not stay disabled forever.
    await expect(page.getByRole('button', { name: 'Confirm check-in' })).toBeEnabled()
  })

  test('legacy /reception/walk-in redirects to the new wizard, preserving patientId/patientName/newPatientName', async ({
    page,
  }) => {
    await page.goto(
      '/reception/walk-in?patientId=00000000-0000-0000-0000-000000000000&patientName=Old+Link&newPatientName=Prefill+Name'
    )
    await page.waitForURL('**/reception/check-in**')
    const url = new URL(page.url())
    expect(url.pathname).toBe('/reception/check-in')
    expect(url.searchParams.get('patientId')).toBe('00000000-0000-0000-0000-000000000000')
    expect(url.searchParams.get('patientName')).toBe('Old Link')
    expect(url.searchParams.get('newPatientName')).toBe('Prefill Name')

    // A bogus patientId from a URL must never be trusted/displayed — it's
    // re-verified through RLS and rejected since no such profile exists.
    await expect(page.getByText('Couldn’t verify this patient')).toBeVisible({ timeout: 10_000 })
  })
})

test.describe('Unified check-in wizard — appointment path', () => {
  // Needs a real "booked, today, in the clinic timezone" appointment —
  // reset_demo_state() does not seed one (it resets queue/consultation/
  // notification state, not appointments), and this suite has no
  // same-day booking helper yet. Covered by manual verification this
  // session (code review + live walkthrough of the branch logic); left
  // here as a named gap rather than a flaky or fabricated test.
  test.skip('existing patient with a valid booked appointment today checks in via checkInAppointment, not checkInPatient', () => {})
  test.skip('patient with multiple eligible appointments today lets the receptionist choose the correct one', () => {})
  test.skip('cancelled / already-checked-in / stale appointment is not offered as eligible', () => {})
})
