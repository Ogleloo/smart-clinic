/**
 * Renders the real AppointmentDetailsView to static HTML for a range of fixture states, and compiles the
 * app's real Tailwind CSS, then prints { states: { name: html }, css } as JSON. Run by
 * e2e/appointment-details-render.spec.ts through `tsx`. No network, no database, no Supabase client — every
 * prop is a plain, synthetic fixture: this patient, appointment and reference are make-believe, never
 * Figma's sample patient/reference/address and never a real record.
 */
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import { AppointmentDetailsView, type AppointmentDetailsViewProps, type DetailsAppointment } from '../../components/patient/AppointmentDetailsView'

const APPOINTMENT: DetailsAppointment = {
  id: 'appt-1',
  scheduled_time: '2026-11-04T08:00:00+02:00',
  status: 'booked',
  reference: 'AP-20261104-0012',
  service: { name: 'General Consultation', description: 'Quality care for common illnesses and health concerns.', clinic: { name: 'Riverside Clinic', city: 'Example City' } },
}

const BASE: AppointmentDetailsViewProps = {
  fullName: 'Sipho Dlamini',
  appointment: APPOINTMENT,
  typical: { kind: 'known', minutes: 14, sampleCount: 40, confidence: 'high' },
}

async function main() {
  const states: Record<string, string> = {
    bookedKnownTime: renderToStaticMarkup(createElement(AppointmentDetailsView, BASE)),
    checkedIn: renderToStaticMarkup(createElement(AppointmentDetailsView, { ...BASE, appointment: { ...APPOINTMENT, status: 'checked_in' } })),
    cancelled: renderToStaticMarkup(createElement(AppointmentDetailsView, { ...BASE, appointment: { ...APPOINTMENT, status: 'cancelled' } })),
    completed: renderToStaticMarkup(createElement(AppointmentDetailsView, { ...BASE, appointment: { ...APPOINTMENT, status: 'completed' } })),
    noShow: renderToStaticMarkup(createElement(AppointmentDetailsView, { ...BASE, appointment: { ...APPOINTMENT, status: 'no_show' } })),
    typicalNoData: renderToStaticMarkup(createElement(AppointmentDetailsView, { ...BASE, typical: { kind: 'no_data' } })),
    typicalUnavailable: renderToStaticMarkup(createElement(AppointmentDetailsView, { ...BASE, typical: { kind: 'unavailable' } })),
    noReference: renderToStaticMarkup(createElement(AppointmentDetailsView, { ...BASE, appointment: { ...APPOINTMENT, reference: null } })),
    noClinic: renderToStaticMarkup(
      createElement(AppointmentDetailsView, { ...BASE, appointment: { ...APPOINTMENT, service: { name: 'Pharmacy', description: null, clinic: null } } })
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
