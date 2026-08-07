import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { AppointmentCard } from '@/components/ui/AppointmentCard'
import { CancelAppointmentButton } from '@/components/booking/CancelAppointmentButton'
import { LinkButton } from '@/components/ui/LinkButton'

/**
 * Appointment details (Slice 3).
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
    .select('id, scheduled_time, status, service:services(name)')
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

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 px-4 py-6">
      <h1 className="font-display text-[22px] font-bold text-ink">Appointment details</h1>

      <AppointmentCard
        serviceName={appointment.service?.name ?? 'Appointment'}
        scheduledAt={appointment.scheduled_time}
        status={appointment.status}
        fullWidth
      />

      {appointment.status === 'booked' && (
        <CancelAppointmentButton appointmentId={appointment.id} />
      )}

      <LinkButton href="/dashboard" variant="tertiary" fullWidth>
        Back to dashboard
      </LinkButton>
    </main>
  )
}
