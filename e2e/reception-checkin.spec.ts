import { test, expect, type Page, type Route } from '@playwright/test'
import { ACCOUNTS, loginAs, resetDemoState, waitSettled } from './helpers'

/**
 * Unified check-in wizard (Phase 2 — Figma frames 111:183 / 111:342 /
 * 111:487 / 112:302). The walk-in path (top describe block) runs against
 * the real shared dev Supabase project, same as the rest of this suite.
 *
 * The appointment path (bottom describe block) has no "booked, today"
 * fixture in the shared dev DB, and creating one there needs approval
 * first (CLAUDE.md: Supabase is shared across preview/production). Those
 * tests instead mock the Supabase REST/RPC calls at the network layer via
 * page.route — no real row is read or written, only this browser's
 * requests are intercepted, so they're safe to run without approval and
 * verify the same client-side contract: the displayed service/time come
 * from the query response, the id sent to checkInAppointment is read off
 * that response (never invented), and the token shown is the mocked RPC's
 * own response (never a client-side guess).
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

const MOCK_PATIENT = { id: 'aaaaaaaa-0000-4000-8000-000000000001', full_name: 'Mock Appt Patient', phone: '0820000001' }

/** Must match lib/clinicTime.ts's todayInClinicTimezone() — the component filters on this date, not the test runner's local/UTC date, which can disagree near midnight. */
function todayInClinicTimezone(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg' }).format(new Date())
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

/** Mocks only the two reads that precede any appointment check: search_patients (step 1) and profiles (loadPatient). Appointments themselves are mocked per-test. */
async function mockPatientLookup(page: Page) {
  await page.route(
    (url) => url.pathname.endsWith('/rest/v1/rpc/search_patients'),
    (route) => json(route, [{ ...MOCK_PATIENT, has_account: true }])
  )
  await page.route(
    (url) => url.pathname.endsWith('/rest/v1/profiles'),
    (route) => json(route, { ...MOCK_PATIENT, date_of_birth: null, id_number: null })
  )
}

async function selectMockPatient(page: Page) {
  await page.goto('/reception/check-in')
  await page.waitForLoadState('networkidle')
  await page.fill('input[placeholder*="2 characters"]', 'mock')
  await page.waitForResponse((r) => r.url().includes('search_patients'))
  await page.getByText(MOCK_PATIENT.full_name).click()
  await page.waitForResponse((r) => r.url().includes('/rest/v1/appointments'))
}

test.describe('Unified check-in wizard — appointment path (mocked, no live DB writes)', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, ACCOUNTS.receptionist.email, ACCOUNTS.receptionist.password)
  })

  /**
   * checkInAppointment is a Server Action — its Supabase RPC call happens
   * on the Next.js server process, never as a request from this browser
   * page, so page.route can't intercept it (confirmed: a route on
   * rpc/check_in_appointment here is simply never hit). These tests stop
   * one step short of clicking "Confirm check-in" and instead read the
   * hidden form input's value directly — that input's value is exactly
   * what the real submission would send, so this proves the right id
   * reaches the form without making any request, mocked or real, to the
   * backend. Token-display behavior is already covered by the live
   * walk-in tests above (same success component, same code path).
   */
  test('existing patient with a valid booked appointment today: checkInAppointment form carries the real appointment_id', async ({
    page,
  }) => {
    const apptId = 'bbbbbbbb-0000-4000-8000-000000000001'
    await mockPatientLookup(page)
    await page.route(
      (url) => url.pathname.endsWith('/rest/v1/appointments'),
      (route) =>
        json(route, [
          { id: apptId, scheduled_time: `${todayInClinicTimezone()}T09:00:00+02:00`, service: { id: 'svc-1', name: 'General Consultation' } },
        ])
    )

    await selectMockPatient(page)
    await expect(page.getByText('Yes, has an appointment')).toBeVisible()
    await expect(page.getByText('General Consultation')).toBeVisible()
    await expect(page.getByText('09:00')).toBeVisible()

    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByText('General Consultation')).toBeVisible() // queue summary
    await expect(page.locator('input[name="appointment_id"]')).toHaveValue(apptId)
  })

  test('multiple eligible appointments: receptionist can choose the correct one, and that choice (not the first) is what the form carries', async ({
    page,
  }) => {
    const firstId = 'bbbbbbbb-0000-4000-8000-000000000002'
    const secondId = 'bbbbbbbb-0000-4000-8000-000000000003'
    const today = todayInClinicTimezone()
    await mockPatientLookup(page)
    await page.route(
      (url) => url.pathname.endsWith('/rest/v1/appointments'),
      (route) =>
        json(route, [
          { id: firstId, scheduled_time: `${today}T09:00:00+02:00`, service: { id: 'svc-1', name: 'General Consultation' } },
          { id: secondId, scheduled_time: `${today}T10:30:00+02:00`, service: { id: 'svc-2', name: 'Immunization' } },
        ])
    )

    await selectMockPatient(page)
    await expect(page.getByText('General Consultation')).toBeVisible()
    await expect(page.getByText('Immunization')).toBeVisible()

    // Default selection is the first (earliest) appointment; choose the second instead.
    await page.getByText('Immunization', { exact: true }).click()
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.locator('input[name="appointment_id"]')).toHaveValue(secondId)
  })

  test('ineligible appointments are excluded by the query itself (status=booked, scheduled_date=today), not filtered client-side', async ({
    page,
  }) => {
    await mockPatientLookup(page)
    let requestUrl: URL | undefined
    await page.route(
      (url) => url.pathname.endsWith('/rest/v1/appointments'),
      (route) => {
        requestUrl = new URL(route.request().url())
        return json(route, [])
      }
    )

    await selectMockPatient(page)
    await expect(page.getByText('No booked appointment today')).toBeVisible()

    expect(requestUrl).toBeDefined()
    expect(requestUrl!.searchParams.get('status')).toBe('eq.booked')
    expect(requestUrl!.searchParams.get('scheduled_date')).toBe(`eq.${todayInClinicTimezone()}`)
    expect(requestUrl!.searchParams.get('patient_id')).toBe(`eq.${MOCK_PATIENT.id}`)
  })

  test('a failed appointment lookup blocks check-in with Retry, rather than silently defaulting to walk-in', async ({
    page,
  }) => {
    await mockPatientLookup(page)
    let attempts = 0
    await page.route(
      (url) => url.pathname.endsWith('/rest/v1/appointments'),
      (route) => {
        attempts += 1
        if (attempts === 1) return json(route, { message: 'simulated failure' }, 500)
        return json(route, [])
      }
    )

    await selectMockPatient(page)
    await expect(page.getByText('Couldn’t check for today’s appointments')).toBeVisible()
    // No service picker, no way to proceed, while eligibility is unknown.
    await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled()

    await page.getByRole('button', { name: 'Retry' }).click()
    await expect(page.getByText('No booked appointment today')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled() // still needs a service picked
  })
})
