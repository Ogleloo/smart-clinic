import { test, expect } from '@playwright/test'
import { loginAs, ACCOUNTS, chooseBookingService, pickBookingDate } from './helpers'

// Migration 0052: clinic_hours drives the landing-page footer, the
// booking screen's closed/fully-booked distinction, and an admin editor.
// day_of_week follows Postgres extract(dow): 0 = Sunday .. 6 = Saturday.

test('landing page footer reads live opening hours, grouped by consecutive day', async ({ page }) => {
  await page.goto('/')
  await expect(
    page.getByText('Mon–Fri 07:30–16:30 · Sat 08:00–12:00 · Closed Sunday')
  ).toBeVisible()
})

test('booking a closed day shows a closed message, not an empty slot grid', async ({ page }) => {
  await loginAs(page, ACCOUNTS.patient.email, ACCOUNTS.patient.password)
  await chooseBookingService(page, 'General Consultation')

  const today = new Date()
  const nextSunday = new Date(today)
  nextSunday.setDate(today.getDate() + ((7 - today.getDay()) % 7 || 7))
  const dateStr = nextSunday.toISOString().slice(0, 10)

  await pickBookingDate(page, dateStr)
  await expect(page.getByText(/The clinic is closed on Sundays\. Choose another day\./)).toBeVisible()
  await expect(page.locator('.grid.grid-cols-3')).toHaveCount(0)
})

test('booking an open day still shows the time-slot grid', async ({ page }) => {
  await loginAs(page, ACCOUNTS.patient.email, ACCOUNTS.patient.password)
  await chooseBookingService(page, 'General Consultation')

  const today = new Date()
  const nextMonday = new Date(today)
  nextMonday.setDate(today.getDate() + (((1 - today.getDay() + 7) % 7) || 7))
  const dateStr = nextMonday.toISOString().slice(0, 10)

  await pickBookingDate(page, dateStr)
  await expect(page.getByText(/The clinic is closed/)).toHaveCount(0)
  await expect(page.locator('.grid.grid-cols-3 button').first()).toBeVisible()
})

// 2026-11-30 is a Monday (open) with every General Consultation slot
// already taken — set up deliberately far in the future so it can
// never collide with demo-reset data. This is the one case the whole
// feature exists to get right: fully booked must read differently from
// closed, and neither may render as an empty grid.
test('a fully booked open day says so explicitly, not the closed-day message or an empty grid', async ({
  page,
}) => {
  await loginAs(page, ACCOUNTS.patient.email, ACCOUNTS.patient.password)
  await chooseBookingService(page, 'General Consultation')
  await pickBookingDate(page, '2026-11-30')

  await expect(page.getByText('Fully booked for this date. Choose another day.')).toBeVisible()
  await expect(page.getByText(/The clinic is closed/)).toHaveCount(0)
  await expect(page.locator('.grid.grid-cols-3')).toHaveCount(0)
})
