/**
 * Renders the real AppointmentsListView to static HTML for a range of fixture states, and compiles the app's
 * real Tailwind CSS, then prints { states: { name: html }, css } as JSON. Run by
 * e2e/appointments-list-render.spec.ts through `tsx`. No network, no database, no Supabase client — every
 * prop is a plain, synthetic fixture: this patient, these appointments and this reference are make-believe,
 * never Figma's sample patient/reference/address and never a real record.
 */
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import { AppointmentsListView, type AppointmentsListViewProps } from '../../components/patient/AppointmentsListView'
import type { AppointmentCardAppointment } from '../../components/patient/AppointmentCard'

const BASE: AppointmentsListViewProps = {
  fullName: 'Sipho Dlamini',
  tab: 'upcoming',
  upcomingCount: 2,
  previousCount: 3,
  rows: [],
  error: false,
  checkedInToday: null,
  bookedToday: null,
}

function appt(over: Partial<AppointmentCardAppointment> = {}): AppointmentCardAppointment {
  return {
    id: 'appt-1',
    scheduled_time: '2026-11-04T08:00:00+02:00',
    status: 'booked',
    reference: 'AP-20261104-0012',
    service: { name: 'General Consultation', description: 'Quality care for common illnesses and health concerns.', clinic: { name: 'Riverside Clinic', city: 'Example City' } },
    ...over,
  }
}

const UPCOMING_ROWS = [appt({ id: 'appt-1' }), appt({ id: 'appt-2', status: 'checked_in', reference: 'AP-20261105-0003', service: { name: 'Pharmacy', description: null, clinic: { name: 'Riverside Clinic', city: null } } })]
const PREVIOUS_ROWS = [
  appt({ id: 'appt-3', status: 'completed', reference: 'AP-20261001-0007' }),
  appt({ id: 'appt-4', status: 'cancelled', reference: 'AP-20261002-0011' }),
  appt({ id: 'appt-5', status: 'no_show', reference: 'AP-20261003-0019' }),
]

async function main() {
  const states: Record<string, string> = {
    upcomingWithRows: renderToStaticMarkup(createElement(AppointmentsListView, { ...BASE, rows: UPCOMING_ROWS })),
    upcomingEmpty: renderToStaticMarkup(createElement(AppointmentsListView, { ...BASE, rows: [], upcomingCount: 0 })),
    previousWithRows: renderToStaticMarkup(createElement(AppointmentsListView, { ...BASE, tab: 'previous', rows: PREVIOUS_ROWS })),
    previousEmpty: renderToStaticMarkup(createElement(AppointmentsListView, { ...BASE, tab: 'previous', rows: [], previousCount: 0 })),
    loadError: renderToStaticMarkup(createElement(AppointmentsListView, { ...BASE, rows: [], error: true })),
    checkedInBanner: renderToStaticMarkup(
      createElement(AppointmentsListView, {
        ...BASE,
        rows: UPCOMING_ROWS,
        checkedInToday: { service: { name: 'General Consultation' }, scheduled_time: '2026-11-02T08:00:00+02:00', reference: 'AP-20261102-0001' },
      })
    ),
    bookedTodayBanner: renderToStaticMarkup(
      createElement(AppointmentsListView, {
        ...BASE,
        rows: UPCOMING_ROWS,
        bookedToday: { service: { name: 'Pharmacy' }, scheduled_time: '2026-11-02T14:00:00+02:00', reference: 'AP-20261102-0002' },
      })
    ),
    rowNoClinic: renderToStaticMarkup(
      createElement(AppointmentsListView, { ...BASE, rows: [appt({ service: { name: 'General Consultation', description: null, clinic: null } })] })
    ),
    rowNoReference: renderToStaticMarkup(createElement(AppointmentsListView, { ...BASE, rows: [appt({ reference: null })] })),
  }

  const cssPath = 'app/globals.css'
  const result = await postcss([tailwind()]).process(readFileSync(cssPath, 'utf8'), { from: cssPath })
  process.stdout.write(JSON.stringify({ states, css: result.css }))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
