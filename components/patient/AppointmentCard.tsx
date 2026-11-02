import { Calendar, Clock, MapPin, Stethoscope } from 'lucide-react'
import { CancelAppointmentButton } from '@/components/booking/CancelAppointmentButton'
import { LinkButton } from '@/components/ui/LinkButton'
import { PatientStatusChip } from '@/components/patient/PatientStatusChip'
import { TYPE } from '@/components/patient/PageHeader'
import { formatClinicDate, formatClinicTime } from '@/lib/clinicTime'
import type { AppointmentStatus } from '@/lib/types/database.types'

export interface AppointmentCardAppointment {
  id: string
  scheduled_time: string
  status: AppointmentStatus
  reference: string | null
  service: {
    name: string
    description: string | null
    clinic: { name: string; city: string | null } | null
  } | null
}

const ICON_BADGE = 'flex h-[50px] w-[50px] shrink-0 items-center justify-center rounded-full bg-card-mint text-primary-700'
const COLUMN_LABEL = 'text-xs uppercase tracking-wide text-muted'

/**
 * One row of My Appointments (Figma 71:85's "Appointment-Row"). An <article> with an
 * a[href="/appointments/{id}"] link inside is a fixed contract — e2e/patient-v3.spec.ts and
 * e2e/appointment-cancel.spec.ts both locate a row by exactly that shape.
 *
 * Figma also shows a "Reschedule" button here. There is no rescheduling RPC or approved workflow yet (see
 * the same note on AppointmentDetailsView) — cancel-and-rebook is not a substitute, since a failed second
 * booking would destroy the original with nothing to show for it. That button is left out entirely rather
 * than shipped as dead or disabled UI with no approved behaviour behind it.
 */
export function AppointmentCard({ appointment, cancellable }: { appointment: AppointmentCardAppointment; cancellable: boolean }) {
  const clinic = appointment.service?.clinic
  const location = clinic ? [clinic.name, clinic.city].filter(Boolean).join(', ') : null

  return (
    <article className="flex flex-col gap-4 rounded-[16px] border border-border bg-surface p-5 shadow-[0_12px_16px_rgba(5,48,46,0.08)]">
      <PatientStatusChip status={appointment.status} />

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className={ICON_BADGE}>
            <Stethoscope size={22} aria-hidden />
          </span>
          <span className="flex min-w-0 flex-col gap-1">
            <span className={COLUMN_LABEL}>Service</span>
            <span className="text-base text-ink">{appointment.service?.name ?? 'Appointment'}</span>
            {appointment.service?.description && <span className="text-sm text-muted">{appointment.service.description}</span>}
          </span>
        </div>

        <div className="flex min-w-0 items-start gap-3">
          <span className={ICON_BADGE}>
            <Calendar size={22} aria-hidden />
          </span>
          <span className="flex min-w-0 flex-col gap-1">
            <span className={COLUMN_LABEL}>Date</span>
            <span className="text-base text-ink">{formatClinicDate(appointment.scheduled_time, { weekday: 'short' })}</span>
          </span>
        </div>

        <div className="flex min-w-0 items-start gap-3">
          <span className={ICON_BADGE}>
            <Clock size={22} aria-hidden />
          </span>
          <span className="flex min-w-0 flex-col gap-1">
            <span className={COLUMN_LABEL}>Time</span>
            <span className="text-base text-ink tabular">{formatClinicTime(appointment.scheduled_time)}</span>
          </span>
        </div>

        {location && (
          <div className="flex min-w-0 items-start gap-3">
            <span className={ICON_BADGE}>
              <MapPin size={22} aria-hidden />
            </span>
            <span className="flex min-w-0 flex-col gap-1">
              <span className={COLUMN_LABEL}>Location</span>
              <span className="text-base text-ink">{location}</span>
            </span>
          </div>
        )}
      </div>

      {appointment.reference && (
        <p className={TYPE.small}>
          Ref <span className="font-mono text-ink">{appointment.reference}</span>
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3 sm:justify-end">
        <LinkButton href={`/appointments/${appointment.id}`} variant="primary">
          View details
        </LinkButton>
        {cancellable && <CancelAppointmentButton appointmentId={appointment.id} status={appointment.status} compact />}
      </div>
    </article>
  )
}
