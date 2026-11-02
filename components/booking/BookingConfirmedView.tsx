import Link from 'next/link'
import { Calendar, CircleCheck, Clock, Hash, Info, MapPin, Stethoscope } from 'lucide-react'
import type { AppointmentStatus } from '@/lib/types/database.types'
import type { PatientClinic } from '@/lib/patientClinic'
import { PatientStatusChip } from '@/components/patient/PatientStatusChip'
import { LinkButton } from '@/components/ui/LinkButton'
import { TYPE } from '@/components/patient/PageHeader'
import { formatClinicDate, formatClinicTime } from '@/lib/clinicTime'
import { BEFORE_VISIT_CHECKLIST } from '@/lib/beforeVisitChecklist'

export interface ConfirmedAppointment {
  id: string
  scheduled_time: string
  status: AppointmentStatus
  reference: string | null
  service: { name: string } | null
}

export interface BookingConfirmedViewProps {
  appointment: ConfirmedAppointment
  clinic: PatientClinic | null
}

const ICON_BADGE = 'flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full bg-surface text-primary-700'

/**
 * Booking success (Figma 68:77), presentational. The reference is appointments.reference, written by the
 * trg_appointment_reference trigger on insert — this only ever reads it back; nothing here invents a
 * reference, a date or a notification promise. Figma repeats "Appointment confirmed" as both a page-band
 * title and this card's own heading; rather than ship two headings with the identical accessible name (the
 * same link/heading-collision risk already documented on the dashboard, PR #47), this page keeps the one
 * heading Figma's card itself shows and skips the decorative top band the booking wizard steps use.
 */
export function BookingConfirmedView({ appointment, clinic }: BookingConfirmedViewProps) {
  const clinicAddress = clinic ? [clinic.address, clinic.city].filter(Boolean).join(', ') : null
  const checklist = [
    ...BEFORE_VISIT_CHECKLIST,
    ...(appointment.reference ? [`Quote your reference ${appointment.reference} at reception.`] : []),
  ]

  return (
    <section className="mx-auto flex w-full max-w-2xl flex-col items-center gap-7 rounded-lg border border-border bg-surface p-6 text-center shadow-[0_12px_32px_rgba(5,48,46,0.08)] sm:p-10">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-card-mint text-primary-700">
        <CircleCheck size={32} aria-hidden />
      </span>
      <div className="flex flex-col gap-2">
        <h1 className={TYPE.pageTitle}>Appointment confirmed</h1>
        <p className="text-base text-muted">Your appointment has been successfully booked. We look forward to seeing you at the clinic.</p>
      </div>

      <PatientStatusChip status={appointment.status} />

      <div className="flex w-full flex-col divide-y divide-border rounded-md border border-border bg-card-mint text-left">
        <div className="flex items-center gap-4 px-5 py-4">
          <span className={ICON_BADGE}>
            <Hash size={20} aria-hidden />
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-xs text-muted">Reference number</span>
            <span className="font-mono text-base font-semibold text-ink" data-testid="appointment-reference">
              {appointment.reference ?? '—'}
            </span>
          </span>
        </div>

        <div className="flex items-center gap-4 px-5 py-4">
          <span className={ICON_BADGE}>
            <Stethoscope size={20} aria-hidden />
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-xs text-muted">Service</span>
            <span className="text-base font-semibold text-ink">{appointment.service?.name ?? 'Appointment'}</span>
          </span>
        </div>

        <div className="flex items-center gap-4 px-5 py-4">
          <span className={ICON_BADGE}>
            <Calendar size={20} aria-hidden />
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-xs text-muted">Date</span>
            <span className="text-base font-semibold text-ink">{formatClinicDate(appointment.scheduled_time, { weekday: 'long' })}</span>
          </span>
        </div>

        <div className="flex items-center gap-4 px-5 py-4">
          <span className={ICON_BADGE}>
            <Clock size={20} aria-hidden />
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-xs text-muted">Time</span>
            <span className="text-base font-semibold text-ink tabular">{formatClinicTime(appointment.scheduled_time)}</span>
          </span>
        </div>

        {clinic && (
          <div className="flex items-center gap-4 px-5 py-4">
            <span className={ICON_BADGE}>
              <MapPin size={20} aria-hidden />
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-xs text-muted">Location</span>
              <span className="text-base font-semibold text-ink">{clinic.name}</span>
              {clinicAddress && <span className="text-xs text-muted">{clinicAddress}</span>}
            </span>
          </div>
        )}
      </div>

      <div className="flex w-full flex-col gap-3 sm:flex-row">
        <LinkButton href={`/appointments/${appointment.id}`} variant="primary" fullWidth>
          View appointment
        </LinkButton>
        <LinkButton href="/dashboard" variant="secondary" fullWidth>
          Back to home
        </LinkButton>
      </div>

      <div className="flex w-full flex-col gap-3 rounded-md border border-border bg-paper p-5 text-left">
        <p className="flex items-center gap-2 text-base font-semibold text-ink">
          <Info size={18} className="text-muted" aria-hidden />
          What&rsquo;s next?
        </p>
        <ul className="flex flex-col gap-2">
          {checklist.map((item) => (
            <li key={item} className="flex items-start gap-3 text-sm text-muted">
              <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary-700" aria-hidden />
              {item}
            </li>
          ))}
        </ul>
      </div>

      <Link href="/appointments" className="text-sm font-semibold text-primary-700">
        View all my appointments
      </Link>
    </section>
  )
}
