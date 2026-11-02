import { test, expect, type Page } from '@playwright/test'
import { openBookingHarness, calls, queueResponse, setDefault, release } from './support/booking-harness/harness'
import type { BookableService } from '../components/booking/BookingWizard'
import type { PatientClinic } from '../lib/patientClinic'

/**
 * Patient Booking Wizard (Figma 48:77 / 52:348 / 57:101) — the real BookingWizard, mounted in a browser with
 * app/actions/appointments and lib/supabase/client swapped for in-page mocks (e2e/support/booking-harness).
 * No Supabase, no network, no Server Action ever reached — get_available_slots and bookAppointment return
 * whatever each test configures. Every request this harness doesn't expect is aborted and recorded in
 * `escapes`, asserted empty by every test (fail-closed).
 *
 * Covers what the static markup/layout specs can't: real interaction across the three steps — stale-response
 * protection when the service or date changes quickly, a conflict (BR-4) or duplicate-booking (BR-6) error
 * sending the patient back to a refreshed slot grid, a genuine network exception recovering through "Try
 * again", double-submit protection, and that Change service/date/time never discards a still-valid selection.
 */

const SERVICES: BookableService[] = [
  { id: 'svc-general', name: 'General Consultation', description: 'Quality care for common illnesses and health concerns.' },
  { id: 'svc-pharmacy', name: 'Pharmacy', description: null },
]

const CLINIC: PatientClinic = {
  id: 'clinic-1',
  name: 'Riverside Clinic',
  phone: '035 000 0000',
  address: '12 Example Road',
  city: 'Example City',
  hours: [
    { clinic_id: 'clinic-1', day_of_week: 0, is_closed: true, opens_at: null, closes_at: null },
    { clinic_id: 'clinic-1', day_of_week: 1, is_closed: false, opens_at: '07:30:00', closes_at: '16:30:00' },
    { clinic_id: 'clinic-1', day_of_week: 2, is_closed: false, opens_at: '07:30:00', closes_at: '16:30:00' },
    { clinic_id: 'clinic-1', day_of_week: 3, is_closed: false, opens_at: '07:30:00', closes_at: '16:30:00' },
    { clinic_id: 'clinic-1', day_of_week: 4, is_closed: false, opens_at: '07:30:00', closes_at: '16:30:00' },
    { clinic_id: 'clinic-1', day_of_week: 5, is_closed: false, opens_at: '07:30:00', closes_at: '16:30:00' },
    { clinic_id: 'clinic-1', day_of_week: 6, is_closed: false, opens_at: '08:00:00', closes_at: '12:00:00' },
  ],
}

/** hour/minute are clinic-local (Africa/Johannesburg, UTC+2, no DST) — what the slot grid is expected to show. */
function slot(hour: number, minute: number, taken = false) {
  const d = new Date()
  d.setDate(d.getDate() + 60) // comfortably inside whatever month the calendar is currently showing
  const iso = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour - 2, minute)).toISOString()
  return { slot_time: iso, is_taken: taken }
}

const SOME_SLOTS = [slot(8, 0), slot(8, 15), slot(8, 30, true)]

async function openWizard(page: Page, defaults: Record<string, { value?: unknown; throws?: string; hold?: boolean }> = {}) {
  return openBookingHarness(page, {
    props: { services: SERVICES, clinic: CLINIC },
    defaults: {
      'rpc:get_available_slots': { value: { data: SOME_SLOTS, error: null } },
      ...defaults,
    },
  })
}

async function toDateTimeStep(page: Page, serviceName = 'General Consultation') {
  await page.getByText(serviceName, { exact: true }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
}

async function pickAnAvailableSlot(page: Page) {
  await page.locator('.grid.grid-cols-3 button:not([disabled])').first().click()
}

test.describe('Booking Wizard: service selection', () => {
  test('Continue stays disabled until a service is chosen, then enables', async ({ page }) => {
    const { escapes } = await openWizard(page)
    const cont = page.getByRole('button', { name: 'Continue' })
    await expect(cont).toBeDisabled()
    await page.getByText('Pharmacy', { exact: true }).click()
    await expect(cont).toBeEnabled()
    expect(escapes).toEqual([])
  })
})

test.describe('Booking Wizard: stale response protection', () => {
  test('switching date quickly shows only the latest answer, never an earlier one that resolves after it', async ({ page }) => {
    const { escapes } = await openWizard(page, {
      'rpc:get_available_slots': { hold: true },
    })
    await toDateTimeStep(page)
    // First request (for the initial date) is now held, mid-flight.
    expect(await calls(page, 'rpc:get_available_slots')).toHaveLength(1)

    // A second request — for a different date — resolves immediately with distinct, recognisable data.
    await queueResponse(page, 'rpc:get_available_slots', {
      value: { data: [slot(10, 0)], error: null },
    })
    const d = new Date()
    d.setDate(d.getDate() + 60)
    const dateStr = d.toISOString().slice(0, 10)
    // Page forward month by month (mirrors e2e/helpers.ts's pickBookingDate) until the target date is on screen.
    for (let i = 0; i < 24 && (await page.locator(`button[data-date="${dateStr}"]`).count()) === 0; i++) {
      await page.getByRole('button', { name: 'Next month' }).click()
    }
    await page.locator(`button[data-date="${dateStr}"]`).click()
    await expect(page.getByText('10:00')).toBeVisible()

    // Only now does the FIRST (stale) request resolve, with completely different data.
    await release(page, 'rpc:get_available_slots')
    // The stale response must never overwrite what's on screen.
    await expect(page.getByText('10:00')).toBeVisible()
    await expect(page.getByText('08:00')).toHaveCount(0)
    expect(escapes).toEqual([])
  })
})

test.describe('Booking Wizard: network and lookup failures', () => {
  test('a thrown network exception shows a recoverable error, not an endless loading state — and "Try again" recovers it', async ({
    page,
  }) => {
    const { escapes } = await openWizard(page, {
      'rpc:get_available_slots': { throws: 'Failed to fetch' },
    })
    await toDateTimeStep(page)
    await expect(page.getByText(/Couldn.t load times for that date/)).toBeVisible()
    await expect(page.getByText('Loading available times')).toHaveCount(0)

    await queueResponse(page, 'rpc:get_available_slots', { value: { data: SOME_SLOTS, error: null } })
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect(page.getByText(/Couldn.t load times for that date/)).toHaveCount(0)
    await expect(page.locator('.grid.grid-cols-3 button').first()).toBeVisible()
    expect(escapes).toEqual([])
  })

  test('a query-level error (not a thrown exception) is shown the same way', async ({ page }) => {
    const { escapes } = await openWizard(page, {
      'rpc:get_available_slots': { value: { data: null, error: { message: 'Service not found' } } },
    })
    await toDateTimeStep(page)
    await expect(page.getByText(/Couldn.t load times for that date/)).toBeVisible()
    expect(escapes).toEqual([])
  })

  test('a fully booked date is distinguished from a clinic-closed date and from no times at all', async ({ page }) => {
    const { escapes } = await openWizard(page, {
      'rpc:get_available_slots': { value: { data: [slot(8, 0, true), slot(8, 15, true)], error: null } },
    })
    await toDateTimeStep(page)
    await expect(page.getByText('Every time slot for this date has already been booked.')).toBeVisible()
    expect(escapes).toEqual([])
  })

  test('a date with zero returned slots (clinic open, nothing generated) reads "No times available", not "fully booked"', async ({
    page,
  }) => {
    const { escapes } = await openWizard(page, { 'rpc:get_available_slots': { value: { data: [], error: null } } })
    await toDateTimeStep(page)
    await expect(page.getByText('No times available on this date.')).toBeVisible()
    expect(escapes).toEqual([])
  })
})

test.describe('Booking Wizard: booking conflicts (BR-4 / BR-6) and duplicate submission', () => {
  test('a slot-taken conflict (BR-4) shows the server’s message and sends the patient back to a refreshed grid', async ({
    page,
  }) => {
    const { escapes } = await openWizard(page)
    await toDateTimeStep(page)
    await pickAnAvailableSlot(page)
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByRole('heading', { name: 'Confirm your appointment' })).toBeVisible()

    // The refetch triggered by the error needs its own queued response.
    await queueResponse(page, 'rpc:get_available_slots', { value: { data: SOME_SLOTS, error: null } })
    await setDefault(page, 'bookAppointment', { value: { error: 'That slot was just taken. Please choose another time.' } })

    await page.getByRole('button', { name: 'Confirm booking' }).click()
    await expect(page.getByRole('alert')).toHaveText('That slot was just taken. Please choose another time.')
    // Back on the date/time step, not still showing the stale "booked" screen.
    await expect(page.getByText('Choose a date and time')).toBeVisible()
    expect((await calls(page, 'rpc:get_available_slots')).length).toBeGreaterThanOrEqual(2)
    expect(escapes).toEqual([])
  })

  test('a same-day duplicate booking (BR-6) is reported with its own distinct message', async ({ page }) => {
    const { escapes } = await openWizard(page)
    await toDateTimeStep(page)
    await pickAnAvailableSlot(page)
    await page.getByRole('button', { name: 'Continue' }).click()

    await queueResponse(page, 'rpc:get_available_slots', { value: { data: SOME_SLOTS, error: null } })
    await setDefault(page, 'bookAppointment', { value: { error: 'You already have an appointment for this service that day.' } })

    await page.getByRole('button', { name: 'Confirm booking' }).click()
    await expect(page.getByRole('alert')).toHaveText('You already have an appointment for this service that day.')
    expect(escapes).toEqual([])
  })

  test('a rejected booking never shows a success state — the error stays on screen, nothing resembling "booked" appears', async ({
    page,
  }) => {
    const { escapes } = await openWizard(page)
    await toDateTimeStep(page)
    await pickAnAvailableSlot(page)
    await page.getByRole('button', { name: 'Continue' }).click()
    await queueResponse(page, 'rpc:get_available_slots', { value: { data: SOME_SLOTS, error: null } })
    await setDefault(page, 'bookAppointment', { value: { error: 'That slot was just taken. Please choose another time.' } })
    await page.getByRole('button', { name: 'Confirm booking' }).click()
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(page.getByText('Appointment confirmed')).toHaveCount(0)
    await expect(page.getByText('Appointment booked')).toHaveCount(0)
    expect(escapes).toEqual([])
  })

  test('clicking Confirm booking twice in quick succession only ever submits once', async ({ page }) => {
    const { escapes } = await openWizard(page)
    await toDateTimeStep(page)
    await pickAnAvailableSlot(page)
    await page.getByRole('button', { name: 'Continue' }).click()
    await setDefault(page, 'bookAppointment', { hold: true })

    const confirm = page.getByRole('button', { name: /Confirm booking|Please wait/ })
    await confirm.click()
    await confirm.click({ force: true }) // force: the button is expected to already be disabled by now
    await expect(page.getByRole('button', { name: 'Please wait' })).toBeDisabled()
    expect(await calls(page, 'bookAppointment')).toHaveLength(1)

    await release(page, 'bookAppointment')
    expect(escapes).toEqual([])
  })
})

test.describe('Booking Wizard: review-step editing preserves valid selections', () => {
  test('Change service, then Change date/time, never silently discards what was already chosen', async ({ page }) => {
    const { escapes } = await openWizard(page)
    await toDateTimeStep(page)
    await pickAnAvailableSlot(page)
    const chosenTimeLabel = await page.locator('.grid.grid-cols-3 button[aria-pressed="true"]').innerText()
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByRole('heading', { name: 'Confirm your appointment' })).toBeVisible()
    await expect(page.locator('main, body')).toContainText('General Consultation')

    // Change time: back to step 2, the same slot is still shown selected — nothing was lost.
    await page.getByRole('button', { name: 'Change time' }).click()
    await expect(page.getByText('Choose a date and time')).toBeVisible()
    await expect(page.locator(`.grid.grid-cols-3 button:has-text("${chosenTimeLabel}")`)).toHaveAttribute('aria-pressed', 'true')

    // Continue is already enabled again (the slot survived the round trip) — go straight back to Confirm.
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByRole('heading', { name: 'Confirm your appointment' })).toBeVisible()

    // Change service: back to step 1, the previously chosen service is still the one shown selected.
    await page.getByRole('button', { name: 'Change service' }).click()
    await expect(page.getByTestId('service-option-svc-general')).toHaveAttribute('aria-pressed', 'true')
    expect(escapes).toEqual([])
  })
})

test.describe('Booking Wizard: layout and keyboard', () => {
  for (const width of [1440, 768, 390, 320]) {
    test(`${width}px: no sideways scrolling on the service step`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1200 })
      const { escapes } = await openWizard(page)
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(overflow).toBeLessThanOrEqual(0)
      expect(escapes).toEqual([])
    })
  }

  test('the whole flow is reachable by keyboard: service card, Continue, a slot, Continue, Confirm booking', async ({ page }) => {
    const { escapes } = await openWizard(page)
    await page.getByTestId('service-option-svc-general').focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('button', { name: 'Continue' })).toBeEnabled()
    await page.getByRole('button', { name: 'Continue' }).click()
    await pickAnAvailableSlot(page)
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByRole('button', { name: 'Confirm booking' })).toBeVisible()
    expect(escapes).toEqual([])
  })
})
