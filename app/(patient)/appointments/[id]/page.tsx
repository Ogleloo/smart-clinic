import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, CalendarDays, Check, Clock, ListOrdered, Stethoscope } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { StatusChip } from '@/components/ui/StatusChip'
import { appointmentStatusToChip } from '@/components/ui/AppointmentCard'
import { ConfidenceChip } from '@/components/ui/ConfidenceChip'
import { CancelAppointmentButton } from '@/components/booking/CancelAppointmentButton'
import { LinkButton } from '@/components/ui/LinkButton'
import { PAGE_CLASS, PageHeader } from '@/components/patient/PageHeader'
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
    .select('id, scheduled_time, status, reference, service_id, service:services(name, description)')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-sm font-semibold text-ink">Couldn&rsquo;t load this appointment</p>
        <p className="text-sm text-muted">Please refresh the page.</p>
      </main>
    )
  }
  if (!appointment) notFound()

  const typical = await getTypicalTime(supabase, appointment.service_id)
  const chip = appointmentStatusToChip(appointment.status)
  const isActive = appointment.status === 'booked' || appointment.status === 'checked_in'

  return (
    <main className={PAGE_CLASS}>
      <Link href="/appointments" className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-primary-700">
        <ArrowLeft size={16} aria-hidden />
        Back to appointments
      </Link>

      <PageHeader title="Appointment details" />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="flex flex-col gap-5 lg:col-span-2">
          <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold tracking-wide text-muted">REFERENCE NUMBER</p>
                <p className="mt-1 font-mono text-xl font-semibold text-ink">{appointment.reference ?? '—'}</p>
              </div>
              <StatusChip status={chip.variant} label={chip.label} />
            </div>

            <dl className="grid grid-cols-1 gap-4 border-t border-border pt-4 text-sm sm:grid-cols-3">
              <div className="flex items-start gap-2">
                <Stethoscope size={16} className="mt-0.5 shrink-0 text-muted" aria-hidden />
                <div>
                  <dt className="text-xs font-semibold tracking-wide text-muted">SERVICE</dt>
                  <dd className="mt-0.5 font-semibold text-ink">{appointment.service?.name ?? 'Appointment'}</dd>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <CalendarDays size={16} className="mt-0.5 shrink-0 text-muted" aria-hidden />
                <div>
                  <dt className="text-xs font-semibold tracking-wide text-muted">DATE</dt>
                  <dd className="mt-0.5 font-semibold text-ink">
                    {formatClinicDate(appointment.scheduled_time, { weekday: 'long', month: 'long' })}
                  </dd>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Clock size={16} className="mt-0.5 shrink-0 text-muted" aria-hidden />
                <div>
                  <dt className="text-xs font-semibold tracking-wide text-muted">TIME</dt>
                  <dd className="mt-0.5 font-semibold text-ink tabular">{formatClinicTime(appointment.scheduled_time)}</dd>
                </div>
              </div>
            </dl>

            {appointment.service?.description && (
              <p className="text-sm text-muted">{appointment.service.description}</p>
            )}

            <div className="rounded-lg bg-subtle p-4">
              <p className="text-xs font-semibold tracking-wide text-muted">TYPICAL CONSULTATION TIME</p>
              {typical.kind === 'known' ? (
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-ink">About {typical.minutes} min with the nurse</p>
                  <ConfidenceChip level={toConfidenceLevel(typical.confidence)} sampleCount={typical.sampleCount} />
                </div>
              ) : typical.kind === 'no_data' ? (
                <p className="mt-1 text-sm text-muted">
                  Not enough completed visits for this service yet to say how long it usually takes.
                </p>
              ) : (
                <p className="mt-1 text-sm text-muted">Couldn&rsquo;t load this right now.</p>
              )}
              <p className="mt-1 text-xs text-muted">This is time with the nurse, not your waiting time.</p>
            </div>

            {appointment.status === 'checked_in' && (
              <LinkButton href="/queue" variant="primary" fullWidth>
                <ListOrdered size={16} className="mr-2" aria-hidden />
                Follow my queue
              </LinkButton>
            )}

            <CancelAppointmentButton appointmentId={appointment.id} status={appointment.status} />
          </section>
        </div>

        {isActive && (
          <section className="flex h-fit flex-col gap-3 rounded-lg border border-border bg-surface p-5">
            <p className="text-xs font-semibold tracking-wide text-muted">BEFORE YOUR VISIT</p>
            <ul className="flex flex-col gap-3">
              {CHECKLIST.map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-sm text-ink">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-50 text-primary-700">
                    <Check size={12} aria-hidden />
                  </span>
                  {item}
                </li>
              ))}
              {appointment.reference && (
                <li className="flex items-start gap-2.5 text-sm text-ink">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-50 text-primary-700">
                    <Check size={12} aria-hidden />
                  </span>
                  <span>
                    Quote your reference <span className="font-mono font-semibold">{appointment.reference}</span> at
                    reception.
                  </span>
                </li>
              )}
            </ul>
          </section>
        )}
      </div>
    </main>
  )
}
