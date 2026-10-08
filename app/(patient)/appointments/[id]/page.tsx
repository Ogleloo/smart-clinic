import type { ReactNode } from 'react'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  Calendar,
  Check,
  CircleCheck,
  Clock,
  Hash,
  ListOrdered,
  MapPin,
  Stethoscope,
  Timer,
  type LucideIcon,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { PatientStatusChip } from '@/components/patient/PatientStatusChip'
import { ConfidenceChip } from '@/components/ui/ConfidenceChip'
import { CancelAppointmentButton } from '@/components/booking/CancelAppointmentButton'
import { LinkButton } from '@/components/ui/LinkButton'
import { PAGE_CLASS, PageHeader, TYPE } from '@/components/patient/PageHeader'
import { toConfidenceLevel } from '@/lib/confidence'
import { formatClinicDate, formatClinicTime } from '@/lib/clinicTime'

const CHECKLIST = [
  'Bring your ID document or passport.',
  'Bring any medication you are currently taking, or a list of it.',
  'Bring your clinic card, referral letter or test results if you have them.',
  'Check in at reception when you arrive — your queue token is issued then.',
]

type TypicalTime =
  | { kind: 'known'; minutes: number; sampleCount: number; confidence: string }
  | { kind: 'no_data' }
  | { kind: 'unavailable' }

/**
 * service_consultation_stats() is the same history the wait estimate is
 * built on — completed, plausible-length consultations for this service.
 * With no completed visits there is nothing to state, so nothing is
 * stated: no default, no fallback to services.default_consultation_minutes.
 * The confidence label also comes from the database (confidence_label),
 * so a thin sample is flagged the same way it is on the queue screen.
 */
async function getTypicalTime(
  supabase: Awaited<ReturnType<typeof createClient>>,
  serviceId: string
): Promise<TypicalTime> {
  const { data: stats, error } = await supabase
    .rpc('service_consultation_stats', { p_service_id: serviceId })
    .maybeSingle()
  if (error) return { kind: 'unavailable' }
  if (!stats || stats.sample_count === 0 || stats.avg_minutes === null) return { kind: 'no_data' }

  const { data: confidence } = await supabase.rpc('confidence_label', {
    p_service_id: serviceId,
    p_count: stats.sample_count,
    p_stddev: stats.stddev_minutes,
  })

  return {
    kind: 'known',
    minutes: Math.max(1, Math.round(stats.avg_minutes)),
    sampleCount: stats.sample_count,
    confidence: confidence ?? 'low',
  }
}

/**
 * Appointment details — V3.
 *
 * RLS scopes appointments to the caller (ADR-010): if this id belongs to
 * someone else, the query returns 0 rows — not an authorization error —
 * so it's handled the same as "doesn't exist" via notFound().
 */
export default async function AppointmentDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: appointment, error } = await supabase
    .from('appointments')
    .select(
      'id, scheduled_time, status, reference, service_id, service:services(name, description, clinic:clinics(name, city))'
    )
    .eq('id', id)
    .maybeSingle()

  if (error) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-base font-semibold text-ink">Couldn&rsquo;t load this appointment</p>
        <p className="text-base text-muted">Please refresh the page.</p>
      </main>
    )
  }
  if (!appointment) notFound()

  const typical = await getTypicalTime(supabase, appointment.service_id)
  const isActive = appointment.status === 'booked' || appointment.status === 'checked_in'

  const clinic = appointment.service?.clinic
  const location = clinic ? [clinic.name, clinic.city].filter(Boolean).join(', ') : null

  const fields: { label: string; icon: LucideIcon; value: ReactNode }[] = [
    {
      label: 'Reference number',
      icon: Hash,
      value: <span className="font-mono">{appointment.reference ?? '—'}</span>,
    },
    { label: 'Service', icon: Stethoscope, value: appointment.service?.name ?? 'Appointment' },
    {
      label: 'Date',
      icon: Calendar,
      value: formatClinicDate(appointment.scheduled_time, { weekday: 'long', month: 'long' }),
    },
    { label: 'Time', icon: Clock, value: <span className="tabular">{formatClinicTime(appointment.scheduled_time)}</span> },
    ...(location ? [{ label: 'Location', icon: MapPin, value: location }] : []),
    { label: 'Status', icon: CircleCheck, value: <PatientStatusChip status={appointment.status} /> },
    {
      label: 'Typical consultation time',
      icon: Timer,
      value:
        typical.kind === 'known' ? (
          <span className="flex flex-wrap items-center gap-2">
            About {typical.minutes} min with the nurse
            <ConfidenceChip level={toConfidenceLevel(typical.confidence)} sampleCount={typical.sampleCount} />
          </span>
        ) : typical.kind === 'no_data' ? (
          <span className="font-normal text-muted">
            Not enough completed visits for this service yet to say how long it usually takes.
          </span>
        ) : (
          <span className="font-normal text-muted">Couldn&rsquo;t load this right now.</span>
        ),
    },
  ]

  return (
    <main className={PAGE_CLASS}>
      <Link href="/appointments" className="inline-flex w-fit items-center gap-2 text-sm font-semibold text-primary-700">
        <ArrowLeft size={20} aria-hidden />
        Back to appointments
      </Link>

      <div className="flex w-full max-w-2xl flex-col gap-6">
        <PageHeader title="Appointment details" />

        <section className="flex flex-col gap-5 rounded-lg border border-border bg-surface p-6">
          {appointment.service?.description && (
            <p className="text-base text-muted">{appointment.service.description}</p>
          )}
          <dl className="flex flex-col gap-5">
            {fields.map(({ label, icon: Icon, value }) => (
              <div key={label} className="flex items-start gap-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-card-mint text-primary-700">
                  <Icon size={20} aria-hidden />
                </span>
                <div className="flex min-w-0 flex-col gap-1">
                  <dt className="text-xs text-muted">{label}</dt>
                  <dd className="text-base font-semibold text-ink">{value}</dd>
                </div>
              </div>
            ))}
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
          <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-6" aria-labelledby="before-visit">
            <h2 id="before-visit" className={TYPE.section}>
              Before your visit
            </h2>
            <ul className="flex flex-col gap-3">
              {[
                ...CHECKLIST,
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
    </main>
  )
}
