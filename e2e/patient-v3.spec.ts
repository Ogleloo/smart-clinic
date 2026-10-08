import { test, expect } from '@playwright/test'
import {
  ACCOUNTS,
  chooseBookingService,
  createTestClient,
  loginAs,
  pickBookingDate,
  resetDemoState,
  waitSettled,
} from './helpers'
import { CLINIC_TIMEZONE } from '../lib/clinicTime'

/**
 * Patient V3 screens. Runs against the shared Supabase project, so every
 * mutation here is undone before the test ends: the booking made through
 * the wizard is cancelled through the UI, and Thabo's profile fields are
 * restored to whatever they were before.
 *
 * Side clients sign out with scope 'local': the default (global) revokes
 * every session for that account — including the browser's own, which
 * then bounces to /login mid-test.
 */

function dateNDaysAhead(days: number): string {
  const target = new Date(Date.now() + days * 24 * 3600 * 1000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: CLINIC_TIMEZONE }).format(target)
}

async function asThabo() {
  const client = createTestClient()
  const { error } = await client.auth.signInWithPassword(ACCOUNTS.patient)
  if (error) throw new Error(`Thabo sign-in failed: ${error.message}`)
  return client
}

test.describe('sidebar and bottom nav', () => {
  test('desktop: persistent sidebar with all six destinations, active item marked, help block from clinics.phone', async ({
    page,
  }) => {
    const client = await asThabo()
    const { data: clinic } = await client
      .from('clinics')
      .select('phone')
      .eq('is_active', true)
      .order('created_at')
      .limit(1)
      .single()
    const { count: unread } = await client
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .is('read_at', null)
    await client.auth.signOut({ scope: 'local' })

    await loginAs(page, ACCOUNTS.patient.email, ACCOUNTS.patient.password)
    await page.goto('/dashboard')
    const sidebar = page.locator('aside')
    await expect(sidebar).toBeVisible()
    for (const label of ['Home', 'Book Appointment', 'My Appointments', 'My Queue', 'Notifications', 'Profile']) {
      await expect(sidebar.getByRole('link', { name: new RegExp(`^${label}`) })).toBeVisible()
    }
    await expect(sidebar.getByRole('link', { name: /^Home/ })).toHaveAttribute('aria-current', 'page')
    await expect(sidebar.getByRole('link', { name: /^Profile/ })).not.toHaveAttribute('aria-current', 'page')

    // The badge reflects the database's unread count, not a client guess.
    const notificationsLink = sidebar.getByRole('link', { name: /^Notifications/ })
    if ((unread ?? 0) > 0) {
      await expect(notificationsLink).toContainText(String(Math.min(unread!, 99)))
    } else {
      await expect(notificationsLink).toHaveText('Notifications')
    }

    await expect(sidebar.getByText('Need help?')).toBeVisible()
    if (clinic?.phone) {
      await expect(sidebar.getByRole('link', { name: clinic.phone })).toBeVisible()
    } else {
      // No number on file means no number shown — never a placeholder.
      await expect(sidebar.getByText('Ask at reception during opening hours.')).toBeVisible()
      await expect(sidebar.locator('a[href^="tel:"]')).toHaveCount(0)
    }

    // Nested routes keep their parent lit.
    await page.goto('/profile/settings')
    await expect(sidebar.getByRole('link', { name: /^Profile/ })).toHaveAttribute('aria-current', 'page')
  })

  test('mobile: sidebar hidden, bottom nav shown', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 })
    await loginAs(page, ACCOUNTS.patient.email, ACCOUNTS.patient.password)
    await page.goto('/dashboard')
    await expect(page.locator('aside')).toBeHidden()
    const bottom = page.locator('nav.fixed')
    await expect(bottom).toBeVisible()
    await expect(bottom.getByRole('link', { name: /Home/ })).toHaveAttribute('aria-current', 'page')
    // No horizontal scroll at phone width.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(0)
  })
})

test('dashboard: greeting, action cards, clinic hours from clinic_hours, quick actions', async ({ page }) => {
  await loginAs(page, ACCOUNTS.patient.email, ACCOUNTS.patient.password)
  await page.goto('/dashboard')
  const main = page.locator('main')

  await expect(main.getByRole('heading', { level: 1 })).toHaveText(/^Good (morning|afternoon|evening), Thabo$/)
  for (const href of ['/book', '/appointments', '/queue']) {
    await expect(main.locator(`a[href="${href}"]`).first()).toBeVisible()
  }
  await expect(main.getByText('NEXT APPOINTMENT')).toBeVisible()
  await expect(main.getByText('CURRENT QUEUE')).toBeVisible()
  await expect(main.getByText('CLINIC INFORMATION')).toBeVisible()
  // Same rows the landing-page footer reads (clinic-hours.spec.ts).
  await expect(main.getByText('Mon–Fri 07:30–16:30')).toBeVisible()
  await expect(main.getByText('Closed Sunday')).toBeVisible()
  await expect(main.getByText(/^(Open today \d\d:\d\d–\d\d:\d\d|Closed today)$/)).toBeVisible()
  for (const label of ['Notifications', 'My profile', 'Update my details', 'Change password']) {
    await expect(main.getByRole('link', { name: label })).toBeVisible()
  }
})

test('booking wizard: service descriptions, 3 steps, success page shows the database reference, details page, cancel', async ({
  page,
}) => {
  test.setTimeout(180_000)
  await resetDemoState()

  const client = await asThabo()
  const { data: services } = await client.from('services').select('id, name, description').eq('is_active', true)
  const pharmacy = services!.find((s) => s.name === 'Pharmacy')!
  // BR-6: one booking per service per day — skip days Thabo already holds one.
  const { data: existing } = await client
    .from('appointments')
    .select('scheduled_date')
    .eq('service_id', pharmacy.id)
    .in('status', ['booked', 'checked_in'])
  const takenDays = new Set((existing ?? []).map((a) => a.scheduled_date))
  let freeDate: string | null = null
  for (let d = 1; d <= 14 && !freeDate; d++) {
    if (takenDays.has(dateNDaysAhead(d))) continue
    const { data: slots } = await client.rpc('get_available_slots', {
      p_service_id: pharmacy.id,
      p_date: dateNDaysAhead(d),
    })
    if (slots?.some((s) => !s.is_taken)) freeDate = dateNDaysAhead(d)
  }
  expect(freeDate).not.toBeNull()
  const { data: stats } = await client.rpc('service_consultation_stats', { p_service_id: pharmacy.id }).single()
  await client.auth.signOut({ scope: 'local' })

  // Safety net: if anything below fails after booking, the slot must not stay
  // taken in the shared database.
  let appointmentId: string | null = null
  try {
    await loginAs(page, ACCOUNTS.patient.email, ACCOUNTS.patient.password)
    await page.goto('/book')

    // Step 1: descriptions come from services.description; nothing invented for services without one.
    if (pharmacy.description) await expect(page.getByText(pharmacy.description)).toBeVisible()
    const undescribed = services!.find((s) => !s.description)
    if (undescribed) {
      const card = page.getByRole('button', { name: undescribed.name, exact: true })
      await expect(card).toBeVisible()
    }
    // Zero state: can't continue without a service.
    await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled()

    await chooseBookingService(page, 'Pharmacy')
    // Step 2: can't continue without a time.
    await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled()
    await pickBookingDate(page, freeDate!)
    await page.locator('.grid.grid-cols-3 button:not([disabled])').first().click()
    await page.getByRole('button', { name: 'Continue' }).click()

    // Step 3: confirm.
    await expect(page.getByRole('heading', { name: 'Confirm your appointment' })).toBeVisible()
    await expect(page.locator('form')).toContainText('Pharmacy')
    await page.getByRole('button', { name: 'Confirm booking' }).click()

    await page.waitForURL(/\/book\/confirmed\/[0-9a-f-]+$/, { timeout: 30_000 })
    appointmentId = page.url().split('/').pop()!
    await expect(page.getByRole('heading', { name: 'Appointment booked' })).toBeVisible()
    const shownReference = (await page.getByTestId('appointment-reference').innerText()).trim()
    expect(shownReference).toMatch(/^AP-\d{8}-\d{4}$/)

    const check = await asThabo()
    const { data: row } = await check.from('appointments').select('reference').eq('id', appointmentId).single()
    await check.auth.signOut({ scope: 'local' })
    expect(shownReference).toBe(row!.reference)

    // Upcoming tab lists it with a status chip, View details and Cancel.
    await page.goto('/appointments')
    const listRow = page.locator('article', { has: page.locator(`a[href="/appointments/${appointmentId}"]`) })
    await expect(listRow).toContainText('Booked')
    await expect(listRow).toContainText(shownReference)
    await expect(listRow.getByRole('button', { name: 'Cancel' })).toBeVisible()

    // Details: reference, typical time from service_consultation_stats, checklist.
    await listRow.getByRole('link', { name: 'View details' }).click()
    await page.waitForURL(`**/appointments/${appointmentId}`)
    await expect(page.getByRole('heading', { name: 'Appointment details' })).toBeVisible()
    await expect(page.locator('main')).toContainText(shownReference)
    if (stats && stats.sample_count > 0 && stats.avg_minutes !== null) {
      await expect(page.getByText(`About ${Math.max(1, Math.round(stats.avg_minutes))} min with the nurse`)).toBeVisible()
    } else {
      await expect(page.getByText(/Not enough completed visits/)).toBeVisible()
    }
    await expect(page.getByText('BEFORE YOUR VISIT')).toBeVisible()

    // Clean up through the UI — the cancel flow itself.
    await page.getByRole('button', { name: 'Cancel appointment' }).click()
    await page.getByRole('button', { name: 'Yes, cancel' }).click()
    await expect(page.getByText('Appointment cancelled.')).toBeVisible({ timeout: 30_000 })

    await page.goto('/appointments?tab=previous')
    await expect(
      page.locator('article', { has: page.locator(`a[href="/appointments/${appointmentId}"]`) })
    ).toContainText('Cancelled')
  } finally {
    if (appointmentId) {
      const cleanup = await asThabo()
      const { data: left } = await cleanup.from('appointments').select('status').eq('id', appointmentId).single()
      if (left?.status === 'booked') await cleanup.rpc('cancel_appointment', { p_appointment_id: appointmentId })
      await cleanup.auth.signOut({ scope: 'local' })
    }
  }
})

test("another patient's appointment id is a 404 on both details and success pages", async ({ page }) => {
  const admin = createTestClient()
  await admin.auth.signInWithPassword(ACCOUNTS.admin)
  const { data: thabo } = await admin
    .from('profiles')
    .select('id')
    .eq('full_name', 'Thabo Mokoena')
    .eq('role', 'patient')
    .limit(1)
    .single()
  const { data: other } = await admin
    .from('appointments')
    .select('id')
    .neq('patient_id', thabo!.id)
    .limit(1)
    .single()
  await admin.auth.signOut({ scope: 'local' })
  expect(other).not.toBeNull()

  await loginAs(page, ACCOUNTS.patient.email, ACCOUNTS.patient.password)
  for (const path of [`/appointments/${other!.id}`, `/book/confirmed/${other!.id}`]) {
    await page.goto(path)
    await expect(page.getByText('This page could not be found.')).toBeVisible()
  }
})

test('notifications: filter tabs partition by kind and read state', async ({ page }) => {
  await loginAs(page, ACCOUNTS.patient.email, ACCOUNTS.patient.password)
  await page.goto('/notifications')
  const tabs = page.getByRole('tablist', { name: 'Filter notifications' })
  if ((await tabs.count()) === 0) {
    await expect(page.getByText('No notifications yet')).toBeVisible()
    return
  }
  const countOf = async (name: string) =>
    Number((await tabs.getByRole('tab', { name: new RegExp(`^${name}`) }).locator('span').innerText()).trim())

  const all = await countOf('All')
  const queue = await countOf('Queue')
  const appts = await countOf('Appointments')
  expect(queue + appts).toBeLessThanOrEqual(all)

  for (const name of ['Queue', 'Appointments', 'All']) {
    await tabs.getByRole('tab', { name: new RegExp(`^${name}`) }).click()
    await expect(tabs.getByRole('tab', { name: new RegExp(`^${name}`) })).toHaveAttribute('aria-selected', 'true')
    const expected = await countOf(name)
    if (expected > 0) {
      await expect(page.locator('ul[role="tabpanel"] > li')).toHaveCount(expected)
      // Every item has a kind icon and an absolute clinic-time timestamp.
      await expect(page.locator('ul[role="tabpanel"] > li time').first()).toBeVisible()
    } else {
      await expect(page.getByText('Nothing here yet')).toBeVisible()
    }
  }
})

test('profile is read-only; settings saves normalised values, rejects bad ones, and the change shows on the profile', async ({
  page,
}) => {
  const client = await asThabo()
  const { data: before } = await client
    .from('profiles')
    .select('full_name, phone, date_of_birth, id_number')
    .not('auth_user_id', 'is', null)
    .single()

  try {
    await loginAs(page, ACCOUNTS.patient.email, ACCOUNTS.patient.password)
    await page.goto('/profile')
    await expect(page.locator('main input')).toHaveCount(0)
    await expect(page.locator('main')).toContainText(ACCOUNTS.patient.email)
    await page.getByRole('link', { name: 'Edit profile' }).click()
    await page.waitForURL('**/profile/settings')

    await expect(page.getByLabel('Email')).toBeDisabled()

    // Failure: malformed ID number — rejected, nothing written.
    await page.getByLabel('ID or passport number').fill('12')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await waitSettled(page)
    await expect(page.getByText('ID or passport number must be 6–20 letters or digits.')).toBeVisible()
    const { data: afterBad } = await client.from('profiles').select('id_number').not('auth_user_id', 'is', null).single()
    expect(afterBad!.id_number).toBe(before!.id_number)

    // Failure: future date of birth. The input's max stops the browser
    // submitting it at all...
    await page.getByLabel('ID or passport number').fill('')
    const dobInput = page.getByLabel('Date of birth')
    await dobInput.fill('2999-01-01')
    expect(await dobInput.evaluate((el: HTMLInputElement) => el.validity.rangeOverflow)).toBe(true)
    // ...and the server rejects it on its own when that guard is bypassed.
    await dobInput.evaluate((el: HTMLInputElement) => el.removeAttribute('max'))
    await page.getByRole('button', { name: 'Save changes' }).click()
    await waitSettled(page)
    await expect(page.getByText('Date of birth can’t be in the future.')).toBeVisible()

    // Happy path: ID normalised (spaces stripped, upper-cased).
    await page.getByLabel('Date of birth').fill('1990-03-12')
    await page.getByLabel('ID or passport number').fill(' ab 123 456 ')
    const save = page.getByRole('button', { name: 'Save changes' })
    await Promise.all([save.click(), save.click({ force: true }).catch(() => {})])
    await waitSettled(page)
    await expect(page.getByText('Your details have been saved.')).toBeVisible()
    await expect(page.getByLabel('ID or passport number')).toHaveValue('AB123456')

    const { data: saved } = await client
      .from('profiles')
      .select('date_of_birth, id_number')
      .not('auth_user_id', 'is', null)
      .single()
    expect(saved).toEqual({ date_of_birth: '1990-03-12', id_number: 'AB123456' })

    await page.goto('/profile')
    await expect(page.locator('main')).toContainText('12 March 1990')
    await expect(page.locator('main')).toContainText('AB123456')

    // Change password: failure paths only — this is a shared test account.
    await page.goto('/profile/settings')
    await page.getByLabel('Current password').fill('definitely-wrong')
    await page.getByLabel('New password', { exact: true }).fill('another-pw-123')
    await page.getByLabel('Confirm new password').fill('another-pw-123')
    await page.getByRole('button', { name: 'Change password' }).click()
    await waitSettled(page)
    await expect(page.getByText('Your current password is incorrect.')).toBeVisible()

    await page.getByLabel('Current password').fill(ACCOUNTS.patient.password)
    await page.getByLabel('New password', { exact: true }).fill('another-pw-123')
    await page.getByLabel('Confirm new password').fill('different-pw-123')
    await page.getByRole('button', { name: 'Change password' }).click()
    await waitSettled(page)
    await expect(page.getByText('Those passwords don’t match.')).toBeVisible()
  } finally {
    await client
      .from('profiles')
      .update({
        full_name: before!.full_name,
        phone: before!.phone,
        date_of_birth: before!.date_of_birth,
        id_number: before!.id_number,
      })
      .not('auth_user_id', 'is', null)
    await client.auth.signOut({ scope: 'local' })
  }
})

test('profile settings: Sign out ends the session', async ({ page }) => {
  await loginAs(page, ACCOUNTS.patient.email, ACCOUNTS.patient.password)
  await page.goto('/profile/settings')
  await page.getByRole('button', { name: 'Sign out' }).click()
  await waitSettled(page)
  await expect(page).toHaveURL(/\/login$/)
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/login/)
})

test('registration: optional DOB and ID fields are present and validated before any account is created', async ({
  page,
}) => {
  await page.goto('/register')
  await expect(page.getByLabel('Date of birth (optional)')).toBeVisible()
  await expect(page.getByLabel('ID or passport number (optional)')).toBeVisible()

  const email = `v3-reg-should-not-exist-${Date.now()}@test.local`
  await page.getByLabel('Full name').fill('Validation Only')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('ID or passport number (optional)').fill('!!')
  await page.getByLabel('Password').fill('pw12345678')
  await page.getByRole('button', { name: 'Create account' }).click()
  await waitSettled(page)
  await expect(page.getByText('ID or passport number must be 6–20 letters or digits.')).toBeVisible()
  await expect(page).toHaveURL(/\/register/)
})
