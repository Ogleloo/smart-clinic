import { notFound, redirect } from 'next/navigation'
import { CircleCheck } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { LinkButton } from '@/components/ui/LinkButton'
import { PatientStatusChip } from '@/components/patient/PatientStatusChip'
import { PAGE_CLASS, TYPE } from '@/components/patient/PageHeader'
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
        <p className="text-base font-semibold text-ink">Your booking went through, but we couldn&rsquo;t load it here.</p>
        <LinkButton href="/appointments" variant="secondary">
          Go to my appointments
        </LinkButton>
      </main>
    )
  }
  if (!appointment) notFound()

  return (
    <main className={PAGE_CLASS}>
      <section className="mx-auto flex w-full max-w-xl flex-col items-center gap-6 rounded-lg border border-border bg-surface p-9 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-card-mint text-primary-700">
          <CircleCheck size={32} aria-hidden />
        </span>
        <div className="flex flex-col gap-2">
          <h1 className={TYPE.pageTitle}>Appointment booked</h1>
          <p className="text-base text-muted">Keep your reference number — reception can find your booking with it.</p>
        </div>

        <div className="flex w-full flex-col gap-1 rounded-md bg-card-mint p-5">
          <p className="text-xs text-muted">Reference number</p>
          <p className="font-mono text-2xl font-semibold text-ink" data-testid="appointment-reference">
            {appointment.reference ?? '—'}
          </p>
        </div>

        <dl className="grid w-full grid-cols-1 gap-4 text-left sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted">Service</dt>
            <dd className="mt-1 text-base font-semibold text-ink">{appointment.service?.name ?? 'Appointment'}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Date</dt>
            <dd className="mt-1 text-base font-semibold text-ink">{formatClinicDate(appointment.scheduled_time)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Time</dt>
            <dd className="mt-1 text-base font-semibold text-ink tabular">{formatClinicTime(appointment.scheduled_time)}</dd>
          </div>
        </dl>

        <PatientStatusChip status={appointment.status} />

        <p className="text-base text-muted">Check in at reception when you arrive to join the queue.</p>

        <div className="flex w-full flex-col gap-3 sm:flex-row">
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
