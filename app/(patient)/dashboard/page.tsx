import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { logout } from '@/app/actions/auth'
import { Button } from '@/components/ui/Button'
import { LinkButton } from '@/components/ui/LinkButton'
import { AppointmentCard } from '@/components/ui/AppointmentCard'
import { EmptyState } from '@/components/ui/EmptyState'
import { QueueSummaryCard } from '@/components/ui/QueueSummaryCard'

/**
 * Patient dashboard — Milestone 8 Vertical Slice 1.
 *
 * Server Component: profile, next appointment and active queue entry are
 * all fetched server-side under the caller's session. RLS scopes every
 * query to this patient (queue_select_own, appointments_select_own etc.),
 * so none of these queries filter by patient_id client-side (ADR-010).
 */
export default async function DashboardPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('full_name')
    .single()

  if (profileError || !profile) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-sm font-semibold text-ink">Couldn&rsquo;t load your account</p>
        <p className="text-sm text-muted">
          Please refresh the page. If this keeps happening, contact the clinic.
        </p>
      </main>
    )
  }

  const firstName = profile.full_name.split(' ')[0]

  const [{ data: nextAppointment, error: appointmentError }, { data: activeEntries, error: queueError }] =
    await Promise.all([
      supabase
        .from('appointments')
        .select('id, scheduled_time, status, service:services(name)')
        .eq('status', 'booked')
        .gte('scheduled_time', 'now')
        .order('scheduled_time', { ascending: true })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('queue_entries')
        .select('id, token, status')
        .eq('queue_date', 'today')
        .in('status', ['waiting', 'in_progress'])
        .order('checked_in_at', { ascending: true }),
    ])

  return (
    <main className="mx-auto min-h-dvh max-w-md">
      <header className="flex items-center justify-between bg-surface px-5 py-4">
        <span className="font-display text-lg font-semibold text-ink">Riverside Clinic</span>
        <div className="h-8 w-8 rounded-full bg-primary-700" aria-hidden />
      </header>

      <div className="flex flex-col gap-4 px-4 py-5">
        <h1 className="font-display text-[26px] font-bold text-ink">Hello, {firstName}</h1>

        {queueError && (
          <p className="text-sm text-danger">Couldn&rsquo;t check your queue status. Try refreshing.</p>
        )}
        {activeEntries && activeEntries.length > 0 && (
          <QueueSummaryCard
            token={(activeEntries.find((e) => e.status === 'in_progress') ?? activeEntries[0]).token}
            otherCount={activeEntries.length - 1}
            fullWidth
          />
        )}

        <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
          <p className="text-xs font-semibold tracking-wide text-muted">NEXT APPOINTMENT</p>
          {appointmentError ? (
            <p className="text-sm text-danger">Couldn&rsquo;t load your appointment. Try refreshing.</p>
          ) : nextAppointment ? (
            <AppointmentCard
              serviceName={nextAppointment.service?.name ?? 'Appointment'}
              scheduledAt={nextAppointment.scheduled_time}
              status={nextAppointment.status}
              fullWidth
            />
          ) : (
            <EmptyState
              headline="No upcoming appointments"
              body="Book one to skip the walk-in queue."
              action={
                <LinkButton href="/book" variant="secondary">
                  Book appointment
                </LinkButton>
              }
              fullWidth
            />
          )}
        </section>

        {nextAppointment && (
          <LinkButton href="/book" variant="primary" fullWidth>
            Book appointment
          </LinkButton>
        )}

        <form action={logout}>
          <Button type="submit" variant="tertiary" fullWidth>
            Log out
          </Button>
        </form>
      </div>
    </main>
  )
}
