/**
 * Renders the real BookingConfirmedView to static HTML for a range of fixture states, and compiles the app's
 * real Tailwind CSS, then prints { states: { name: html }, css } as JSON. Run by
 * e2e/booking-confirmed-render.spec.ts through `tsx`. No network, no database, no Supabase client — every
 * prop is a plain, synthetic fixture: this appointment/reference/patient is make-believe, not a real record
 * or Figma's sample booking.
 */
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import { BookingConfirmedView, type ConfirmedAppointment } from '../../components/booking/BookingConfirmedView'
import type { PatientClinic } from '../../lib/patientClinic'

const CLINIC: PatientClinic = {
  id: 'clinic-1',
  name: 'Riverside Clinic',
  phone: '035 000 0000',
  address: '12 Example Road',
  city: 'Example City',
  hours: [],
}

const APPOINTMENT: ConfirmedAppointment = {
  id: 'appt-1',
  scheduled_time: '2026-11-04T08:00:00+02:00',
  status: 'booked',
  reference: 'AP-20261104-0012',
  service: { name: 'General Consultation' },
}

async function main() {
  const states: Record<string, string> = {
    confirmed: renderToStaticMarkup(createElement(BookingConfirmedView, { appointment: APPOINTMENT, clinic: CLINIC })),
    checkedIn: renderToStaticMarkup(
      createElement(BookingConfirmedView, { appointment: { ...APPOINTMENT, status: 'checked_in' }, clinic: CLINIC })
    ),
    noReference: renderToStaticMarkup(
      createElement(BookingConfirmedView, { appointment: { ...APPOINTMENT, reference: null }, clinic: CLINIC })
    ),
    noClinic: renderToStaticMarkup(createElement(BookingConfirmedView, { appointment: APPOINTMENT, clinic: null })),
    noServiceName: renderToStaticMarkup(
      createElement(BookingConfirmedView, { appointment: { ...APPOINTMENT, service: null }, clinic: CLINIC })
    ),
  }

  const cssPath = 'app/globals.css'
  const result = await postcss([tailwind()]).process(readFileSync(cssPath, 'utf8'), { from: cssPath })
  process.stdout.write(JSON.stringify({ states, css: result.css }))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
