import type { ReactNode } from 'react'
import Link from 'next/link'
import { ArrowLeft, Check, ListOrdered, Stethoscope } from 'lucide-react'
import { PatientStatusChip } from '@/components/patient/PatientStatusChip'
import { ConfidenceChip } from '@/components/ui/ConfidenceChip'
import { CancelAppointmentButton } from '@/components/booking/CancelAppointmentButton'
import { LinkButton } from '@/components/ui/LinkButton'
import { PatientHeaderBanner } from '@/components/patient/PatientHeaderBanner'
import { toConfidenceLevel } from '@/lib/confidence'
import { formatClinicDate, formatClinicTime } from '@/lib/clinicTime'
import { BEFORE_VISIT_CHECKLIST } from '@/lib/beforeVisitChecklist'
import type { AppointmentStatus } from '@/lib/types/database.types'

export type TypicalTime =
  | { kind: 'known'; minutes: number; sampleCount: number; confidence: string }
  | { kind: 'no_data' }
  | { kind: 'unavailable' }

export interface DetailsAppointment {
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

export interface AppointmentDetailsViewProps {
  fullName: string
  appointment: DetailsAppointment
  typical: TypicalTime
}

const CARD = 'flex flex-col gap-5 rounded-[16px] border border-border bg-surface p-6 shadow-[0_12px_32px_rgba(5,48,46,0.08)] sm:p-7'

function FieldRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
      <dt className="text-sm text-muted sm:w-[220px] sm:shrink-0">{label}</dt>
      <dd className="text-base font-semibold text-ink">{value}</dd>
    </div>
  )
}

/**
 * Appointment details — V3 (Figma 88:470), presentational. Everything comes from props; the server component
 * (app/(patient)/appointments/[id]/page.tsx) does all the fetching, following the same split as the
 * dashboard (PR #47) and the booking screens (PR #48).
 *
 * Figma shows a "Reschedule appointment" button next to Cancel, and a header subtitle promising the patient
 * can "reschedule". There is no rescheduling RPC, and cancel-then-rebook is not a safe stand-in: the second
 * booking can fail (BR-4/BR-6, the slot going stale, a network error) after the first has already been
 * cancelled, destroying the original appointment with nothing to show for it. Reschedule is left out of the
 * subtitle and out of the action row entirely, rather than shipped as a button that does nothing or lies
 * about what it does.
 *
 * Figma's own Estimated duration field ("~10-20 minutes") is also not shown — it is Figma's invented
 * placeholder, not a number this system computes. "Typical consultation time" below is the real figure
 * (service_consultation_stats(), the same history behind the queue's own wait estimate), with its own
 * confidence label when the sample is thin, and an explicit "no data yet" state rather than a guess.
 */
export function AppointmentDetailsView({ fullName, appointment, typical }: AppointmentDetailsViewProps) {
  const clinic = appointment.service?.clinic
  const location = clinic ? [clinic.name, clinic.city].filter(Boolean).join(', ') : null
  const isActive = appointment.status === 'booked' || appointment.status === 'checked_in'

  return (
    <div className="flex flex-col gap-6">
      <PatientHeaderBanner title="Appointment details" subtitle="View or cancel your appointment." fullName={fullName} />

      <Link href="/appointments" className="inline-flex h-11 w-fit items-center gap-2 text-sm font-semibold text-primary-700">
        <ArrowLeft size={18} aria-hidden />
        Back to appointments
      </Link>

      <div className="flex w-full max-w-2xl flex-col gap-6">
        <section className={CARD}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-card-mint text-primary-700">
                <Stethoscope size={26} aria-hidden />
              </span>
              <div className="flex flex-col gap-1">
                <p className="font-display text-[22px] font-semibold text-ink">{appointment.service?.name ?? 'Appointment'}</p>
                {location && <p className="text-base text-muted">{location}</p>}
                {appointment.service?.description && <p className="text-sm text-muted">{appointment.service.description}</p>}
              </div>
            </div>
            <PatientStatusChip status={appointment.status} />
          </div>

          <div className="h-px bg-border" />

          <dl className="flex flex-col gap-4">
            <FieldRow label="Date" value={formatClinicDate(appointment.scheduled_time, { weekday: 'long', month: 'long' })} />
            <FieldRow label="Time" value={<span className="tabular">{formatClinicTime(appointment.scheduled_time)}</span>} />
            <FieldRow
              label="Typical consultation time"
              value={
                typical.kind === 'known' ? (
                  <span className="flex flex-wrap items-center gap-2">
                    About {typical.minutes} min with the nurse
                    <ConfidenceChip level={toConfidenceLevel(typical.confidence)} sampleCount={typical.sampleCount} />
                  </span>
                ) : typical.kind === 'no_data' ? (
                  <span className="font-normal text-muted">Not enough completed visits for this service yet to say how long it usually takes.</span>
                ) : (
                  <span className="font-normal text-muted">Couldn&rsquo;t load this right now.</span>
                )
              }
            />
            <FieldRow label="Appointment reference" value={<span className="font-mono">{appointment.reference ?? '—'}</span>} />
            <FieldRow label="Status" value={<PatientStatusChip status={appointment.status} />} />
          </dl>

          <p className="text-xs text-muted">Typical consultation time is time with the nurse, not your waiting time.</p>

          {appointment.status === 'checked_in' && (
            <LinkButton href="/queue" variant="primary" fullWidth>
              <ListOrdered size={20} className="mr-2" aria-hidden />
              Follow my queue
            </LinkButton>
          )}

          <CancelAppointmentButton appointmentId={appointment.id} status={appointment.status} />
        </section>

        {isActive && (
          <section className={CARD} aria-labelledby="before-visit">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-card-mint text-primary-700">
                <Check size={20} aria-hidden />
              </span>
              <h2 id="before-visit" className="text-base text-ink">
                Before your visit
              </h2>
            </div>
            <ul className="flex flex-col gap-3">
              {[
                ...BEFORE_VISIT_CHECKLIST,
                ...(appointment.reference ? [`Quote your reference ${appointment.reference} at reception.`] : []),
              ].map((item) => (
                <li key={item} className="flex items-start gap-3 text-base text-ink">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-700 text-white">
                    <Check size={14} aria-hidden />
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}
