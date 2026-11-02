/**
 * Renders the real DashboardView to static HTML for a range of fixture states, and compiles the app's real
 * Tailwind CSS, then prints { states: { name: html }, css } as JSON. Run by e2e/dashboard-render.spec.ts
 * through `tsx` (Playwright's own JSX transform can't render app components). No network, no database, no
 * Supabase client is created — every prop is a plain, synthetic fixture (see TASK: "Use isolated fixtures for
 * populated-state visual tests. Never create fake data in the shared production Supabase project").
 */
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import { DashboardView, type DashboardViewProps, type NextAppointmentSummary } from '../../components/patient/DashboardView'
import type { ActiveQueueEntry } from '../../lib/patientQueue'
import type { PatientClinic } from '../../lib/patientClinic'
import type { WaitEstimate } from '../../lib/types/database.types'

const TODAY = '2026-11-02' // a Monday

const CLINIC: PatientClinic = {
  id: 'clinic-1',
  name: 'Riverside Clinic',
  phone: '035 000 0000',
  address: '12 Example Road',
  city: 'Example City',
  hours: [
    { clinic_id: 'clinic-1', day_of_week: 1, is_closed: false, opens_at: '07:30:00', closes_at: '16:30:00' },
    { clinic_id: 'clinic-1', day_of_week: 2, is_closed: false, opens_at: '07:30:00', closes_at: '16:30:00' },
    { clinic_id: 'clinic-1', day_of_week: 3, is_closed: false, opens_at: '07:30:00', closes_at: '16:30:00' },
    { clinic_id: 'clinic-1', day_of_week: 4, is_closed: false, opens_at: '07:30:00', closes_at: '16:30:00' },
    { clinic_id: 'clinic-1', day_of_week: 5, is_closed: false, opens_at: '07:30:00', closes_at: '16:30:00' },
    { clinic_id: 'clinic-1', day_of_week: 6, is_closed: false, opens_at: '08:00:00', closes_at: '13:00:00' },
    { clinic_id: 'clinic-1', day_of_week: 0, is_closed: true, opens_at: null, closes_at: null },
  ],
}

const BASE: DashboardViewProps = {
  fullName: 'Sipho Dlamini',
  idNumber: '8001015009087',
  nextAppointment: null,
  appointmentError: false,
  activeEntries: [],
  clinic: CLINIC,
  unreadCount: 0,
  today: TODAY,
}

const APPOINTMENT: NextAppointmentSummary = {
  id: 'appt-1',
  scheduled_time: '2026-11-04T08:00:00+02:00',
  status: 'booked',
  reference: 'AP-20261104-0012',
  service: { name: 'General Consultation' },
}

const waitEstimate = (over: Partial<WaitEstimate>): WaitEstimate => ({
  token: 'GC-102',
  status: 'waiting',
  queue_position: 2,
  estimated_wait_minutes: 15,
  confidence: 'high',
  average_minutes: 14,
  nurses_serving: 1,
  patients_ahead: 1,
  sample_count: 40,
  service_name: 'General Consultation',
  soonest_free_minutes: 5,
  ...over,
})

const activeEntry = (estimate: WaitEstimate): ActiveQueueEntry => ({
  entryId: 'entry-1',
  serviceId: 'service-1',
  estimate,
  nowServingToken: estimate.status === 'in_progress' ? estimate.token : 'GC-101',
})

async function main() {
  const states: Record<string, string> = {
    noAppointmentNoQueue: renderToStaticMarkup(createElement(DashboardView, BASE)),
    upcomingAppointment: renderToStaticMarkup(createElement(DashboardView, { ...BASE, nextAppointment: APPOINTMENT })),
    appointmentToday: renderToStaticMarkup(
      createElement(DashboardView, { ...BASE, nextAppointment: { ...APPOINTMENT, scheduled_time: `${TODAY}T14:00:00+02:00` } }),
    ),
    appointmentError: renderToStaticMarkup(createElement(DashboardView, { ...BASE, appointmentError: true })),
    queueWaitingWithEstimate: renderToStaticMarkup(
      createElement(DashboardView, { ...BASE, activeEntries: [activeEntry(waitEstimate({}))] }),
    ),
    queueInProgress: renderToStaticMarkup(
      createElement(DashboardView, {
        ...BASE,
        activeEntries: [activeEntry(waitEstimate({ status: 'in_progress', queue_position: 0, estimated_wait_minutes: 0 }))],
      }),
    ),
    queueNoEstimateAvailable: renderToStaticMarkup(
      createElement(DashboardView, {
        ...BASE,
        activeEntries: [activeEntry(waitEstimate({ status: 'not_being_served', estimated_wait_minutes: 0, confidence: '' }))],
      }),
    ),
    queueWithOtherQueues: renderToStaticMarkup(
      createElement(DashboardView, { ...BASE, activeEntries: [activeEntry(waitEstimate({})), activeEntry(waitEstimate({ token: 'PH-004' }))] }),
    ),
    missingClinicInfo: renderToStaticMarkup(createElement(DashboardView, { ...BASE, clinic: null })),
    noPhoneClinic: renderToStaticMarkup(createElement(DashboardView, { ...BASE, clinic: { ...CLINIC, phone: null } })),
    noHoursClinic: renderToStaticMarkup(createElement(DashboardView, { ...BASE, clinic: { ...CLINIC, hours: [] } })),
    unreadNotifications: renderToStaticMarkup(createElement(DashboardView, { ...BASE, unreadCount: 3 })),
    noIdNumber: renderToStaticMarkup(createElement(DashboardView, { ...BASE, idNumber: null })),
  }

  const cssPath = 'app/globals.css'
  const result = await postcss([tailwind()]).process(readFileSync(cssPath, 'utf8'), { from: cssPath })
  process.stdout.write(JSON.stringify({ states, css: result.css }))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
