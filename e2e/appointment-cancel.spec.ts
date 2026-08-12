import { test, expect } from '@playwright/test'
import { ACCOUNTS, createTestClient, loginAs, resetDemoState } from './helpers'
import { CLINIC_TIMEZONE } from '../lib/clinicTime'

/**
 * Regression test: the dashboard showed the next appointment but the
 * card wasn't tappable, so there was no route to its details page and
 * therefore no way to cancel — a real workflow with no way in.
 *
 * The fixture appointment is created directly via the book_appointment
 * RPC rather than by driving the interactive booking wizard: what's
 * under test here is navigation (card -> details -> cancel), not
 * booking itself, and the wizard's own multi-step, network-bound slot
 * search adds a lot of exposure to this sandbox's variable Supabase
 * latency for no coverage benefit. Pharmacy (not General Consultation —
 * GC is what the demo fixtures center on) avoids colliding with
 * same-day-booking rule BR-6 against whatever reset_demo_state seeds.
 */
function dateNDaysAhead(days: number): string {
  const target = new Date(Date.now() + days * 24 * 3600 * 1000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: CLINIC_TIMEZONE }).format(target)
}

test('dashboard appointment card links to details, and cancel reaches it in two taps', async ({ page }) => {
  test.setTimeout(120_000)
  await resetDemoState()

  const asThabo = createTestClient()
  const { error: signInError } = await asThabo.auth.signInWithPassword(ACCOUNTS.patient)
  expect(signInError).toBeNull()

  const { data: services } = await asThabo
    .from('services')
    .select('id, name')
    .eq('is_active', true)
    .order('name')
  expect(services && services.length > 0).toBe(true)
  const service = services!.find((s) => s.name === 'Pharmacy') ?? services![services!.length - 1]

  let slot: string | null = null
  for (let daysAhead = 1; daysAhead <= 14 && !slot; daysAhead++) {
    const { data: slots } = await asThabo.rpc('get_available_slots', {
      p_service_id: service.id,
      p_date: dateNDaysAhead(daysAhead),
    })
    slot = slots?.find((s) => !s.is_taken)?.slot_time ?? null
  }
  expect(slot).not.toBeNull()

  const { data: appointment, error: bookError } = await asThabo.rpc('book_appointment', {
    p_service_id: service.id,
    p_slot: slot!,
  })
  expect(bookError).toBeNull()
  const appointmentId = appointment!.id
  await asThabo.auth.signOut()

  await loginAs(page, ACCOUNTS.patient.email, ACCOUNTS.patient.password)

  // Tap 1: the dashboard's next-appointment card must be a real link to
  // this exact appointment, not an inert div.
  await page.goto('/dashboard')
  await page.getByText('NEXT APPOINTMENT').waitFor()
  const card = page.locator(`a[href="/appointments/${appointmentId}"]`)
  await expect(card).toBeVisible()
  await card.click()
  await page.waitForURL(`**/appointments/${appointmentId}`)
  await expect(page.getByRole('heading', { name: 'Appointment details' })).toBeVisible()

  // Tap 2: cancel is reachable from here directly.
  await page.getByRole('button', { name: 'Cancel appointment' }).click()
  await page.getByRole('button', { name: 'Yes, cancel' }).click()
  await expect(page.getByText('Appointment cancelled.')).toBeVisible({ timeout: 30_000 })

  // The list page (new — previously the only way to reach any
  // appointment was this one dashboard card) reflects the cancellation
  // distinctly, not as a bare token.
  await page.goto('/appointments')
  const listRow = page.locator(`a[href="/appointments/${appointmentId}"]`)
  await expect(listRow).toContainText('Cancelled')
})
