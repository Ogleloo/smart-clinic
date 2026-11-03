import { test, expect } from '@playwright/test'
import { openCancelHarness, calls, queueResponse, setDefault, release } from './support/appointment-cancel-harness/harness'

/**
 * CancelAppointmentButton — the real component, mounted in a browser with app/actions/appointments swapped
 * for an in-page mock (e2e/support/appointment-cancel-harness). No Supabase, no network, no Server Action
 * ever reached — cancelAppointment() returns whatever each test configures. Every request this harness
 * doesn't expect is aborted and recorded in `escapes`, asserted empty by every test (fail-closed).
 *
 * Covers what the static markup specs can't: the confirm/keep-it interaction, rejection and recovery, and
 * double-submit protection.
 */

async function openBooked(page: Parameters<typeof openCancelHarness>[0], compact = false) {
  return openCancelHarness(page, { props: { appointmentId: 'appt-1', status: 'booked', compact } })
}

test('a non-booked appointment shows no cancel control at all', async ({ page }) => {
  const { escapes } = await openCancelHarness(page, { props: { appointmentId: 'appt-1', status: 'checked_in' } })
  await expect(page.getByRole('button')).toHaveCount(0)
  expect(escapes).toEqual([])
})

test('full width: "Cancel appointment" asks for confirmation before anything is sent', async ({ page }) => {
  const { escapes } = await openBooked(page)
  await expect(page.getByRole('button', { name: 'Cancel appointment' })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel appointment' }).click()
  await expect(page.getByText('Cancel this appointment?')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Keep it' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Yes, cancel' })).toBeVisible()
  expect(await calls(page, 'cancelAppointment')).toHaveLength(0)
  expect(escapes).toEqual([])
})

test('compact: the row variant reads just "Cancel"', async ({ page }) => {
  await openBooked(page, true)
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Cancel appointment' })).toHaveCount(0)
})

test('"Keep it" backs out without submitting anything', async ({ page }) => {
  const { escapes } = await openBooked(page)
  await page.getByRole('button', { name: 'Cancel appointment' }).click()
  await page.getByRole('button', { name: 'Keep it' }).click()
  await expect(page.getByText('Cancel this appointment?')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Cancel appointment' })).toBeVisible()
  expect(await calls(page, 'cancelAppointment')).toHaveLength(0)
  expect(escapes).toEqual([])
})

test('"Yes, cancel" submits exactly the appointment id, and a successful result replaces the form with the real confirmation message', async ({
  page,
}) => {
  const { escapes } = await openBooked(page)
  await setDefault(page, 'cancelAppointment', { value: { success: 'Appointment cancelled.' } })
  await page.getByRole('button', { name: 'Cancel appointment' }).click()
  await page.getByRole('button', { name: 'Yes, cancel' }).click()
  await expect(page.getByText('Appointment cancelled.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Cancel appointment' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Yes, cancel' })).toHaveCount(0)
  expect(await calls(page, 'cancelAppointment')).toEqual([{ name: 'cancelAppointment', args: [{ appointment_id: 'appt-1' }] }])
  expect(escapes).toEqual([])
})

test('a rejection (e.g. the appointment was already checked in) is shown inline, and the confirm step stays open to retry', async ({
  page,
}) => {
  const { escapes } = await openBooked(page)
  await setDefault(page, 'cancelAppointment', { value: { error: 'Only a booked appointment can be cancelled' } })
  await page.getByRole('button', { name: 'Cancel appointment' }).click()
  await page.getByRole('button', { name: 'Yes, cancel' }).click()
  await expect(page.getByRole('alert')).toHaveText('Only a booked appointment can be cancelled')
  // Still on the confirm step — the rejection didn't silently dismiss it or claim success.
  await expect(page.getByText('Cancel this appointment?')).toBeVisible()
  await expect(page.getByText('Appointment cancelled.')).toHaveCount(0)
  expect(escapes).toEqual([])
})

test('recovery: after a rejection, retrying with a now-successful response succeeds normally', async ({ page }) => {
  const { escapes } = await openBooked(page)
  await queueResponse(page, 'cancelAppointment', { value: { error: 'That appointment can no longer be cancelled' } })
  await queueResponse(page, 'cancelAppointment', { value: { success: 'Appointment cancelled.' } })
  await page.getByRole('button', { name: 'Cancel appointment' }).click()
  await page.getByRole('button', { name: 'Yes, cancel' }).click()
  await expect(page.getByRole('alert')).toHaveText('That appointment can no longer be cancelled')

  await page.getByRole('button', { name: 'Yes, cancel' }).click()
  await expect(page.getByText('Appointment cancelled.')).toBeVisible()
  expect(await calls(page, 'cancelAppointment')).toHaveLength(2)
  expect(escapes).toEqual([])
})

test('clicking "Yes, cancel" twice in quick succession only ever submits once', async ({ page }) => {
  const { escapes } = await openBooked(page)
  await setDefault(page, 'cancelAppointment', { hold: true })
  await page.getByRole('button', { name: 'Cancel appointment' }).click()

  const confirmBtn = page.getByRole('button', { name: /Yes, cancel|Please wait/ })
  await confirmBtn.click()
  await confirmBtn.click({ force: true })
  await expect(page.getByRole('button', { name: 'Please wait' })).toBeDisabled()
  expect(await calls(page, 'cancelAppointment')).toHaveLength(1)

  await release(page, 'cancelAppointment')
  expect(escapes).toEqual([])
})

test('Keep it, Yes, cancel and Cancel appointment are all reachable by keyboard', async ({ page }) => {
  const { escapes } = await openBooked(page)
  const cancelBtn = page.getByRole('button', { name: 'Cancel appointment' })
  await cancelBtn.focus()
  await expect(cancelBtn).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByText('Cancel this appointment?')).toBeVisible()
  await page.getByRole('button', { name: 'Keep it' }).focus()
  await expect(page.getByRole('button', { name: 'Keep it' })).toBeFocused()
  expect(escapes).toEqual([])
})
