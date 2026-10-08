import { notFound, redirect } from 'next/navigation'
import { CircleCheck } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { LinkButton } from '@/components/ui/LinkButton'
import { StatusChip } from '@/components/ui/StatusChip'
import { appointmentStatusToChip } from '@/components/ui/AppointmentCard'
import { PAGE_CLASS } from '@/components/patient/PageHeader'
import { formatClinicDate, formatClinicTime } from '@/lib/clinicTime'

/**
 * Booking success. The reference shown here is appointments.reference,
 * written by the trg_appointment_reference trigger on insert — this page
 * only ever reads it back.
 *
 * Same RLS scoping as the details page: someone else's appointment id
 * returns zero rows, handled as notFound().
 */
export default async function BookingConfirmedPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: appointment, error } = await supabase
    .from('appointments')
    .select('id, scheduled_time, status, reference, service:services(name)')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    return (
      <main className={PAGE_CLASS}>
        <p className="text-sm font-semibold text-ink">Your booking went through, but we couldn&rsquo;t load it here.</p>
        <LinkButton href="/appointments" variant="secondary">
          Go to my appointments
        </LinkButton>
      </main>
    )
  }
  if (!appointment) notFound()

  const chip = appointmentStatusToChip(appointment.status)

  return (
    <main className={PAGE_CLASS}>
      <section className="mx-auto flex w-full max-w-lg flex-col items-center gap-5 rounded-lg border border-border bg-surface px-6 py-8 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-success-bg text-success">
          <CircleCheck size={30} aria-hidden />
        </span>
        <div>
          <h1 className="font-display text-[24px] font-bold text-ink">Appointment booked</h1>
          <p className="mt-1 text-sm text-muted">Keep your reference number — reception can find your booking with it.</p>
        </div>

        <div className="w-full rounded-lg bg-primary-50 px-4 py-4">
          <p className="text-xs font-semibold tracking-wide text-primary-700">REFERENCE NUMBER</p>
          <p className="mt-1 font-mono text-2xl font-semibold text-primary-900" data-testid="appointment-reference">
            {appointment.reference ?? '—'}
          </p>
        </div>

        <dl className="grid w-full grid-cols-1 gap-3 text-left text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs font-semibold tracking-wide text-muted">SERVICE</dt>
            <dd className="mt-0.5 font-semibold text-ink">{appointment.service?.name ?? 'Appointment'}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold tracking-wide text-muted">DATE</dt>
            <dd className="mt-0.5 font-semibold text-ink">{formatClinicDate(appointment.scheduled_time)}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold tracking-wide text-muted">TIME</dt>
            <dd className="mt-0.5 font-semibold text-ink tabular">{formatClinicTime(appointment.scheduled_time)}</dd>
          </div>
        </dl>

        <StatusChip status={chip.variant} label={chip.label} />

        <p className="text-sm text-muted">Check in at reception when you arrive to join the queue.</p>

        <div className="flex w-full flex-col gap-2 sm:flex-row">
          <LinkButton href={`/appointments/${appointment.id}`} variant="primary" fullWidth>
            View appointment
          </LinkButton>
          <LinkButton href="/dashboard" variant="secondary" fullWidth>
            Back to home
          </LinkButton>
        </div>
      </section>
    </main>
  )
}
