import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getActiveQueueEntries } from '@/lib/patientQueue'
import { logout } from '@/app/actions/auth'
import { Button } from '@/components/ui/Button'
import { LinkButton } from '@/components/ui/LinkButton'
import { AppointmentCard } from '@/components/ui/AppointmentCard'
import { EmptyState } from '@/components/ui/EmptyState'
import { QueueSummaryCard } from '@/components/ui/QueueSummaryCard'
import { CLINIC_TIMEZONE, todayInClinicTimezone } from '@/lib/clinicTime'

function formatAppointmentTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: CLINIC_TIMEZONE,
  })
}

function formatAppointmentDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: CLINIC_TIMEZONE,
  })
}

function isAppointmentToday(iso: string): boolean {
  const appointmentDate = new Intl.DateTimeFormat('en-CA', { timeZone: CLINIC_TIMEZONE }).format(
    new Date(iso)
  )
  return appointmentDate === todayInClinicTimezone()
}

/**
 * Patient dashboard — Milestone 8 Vertical Slice 1.
 *
 * Server Component: profile, next appointment and active queue entry are
 * all fetched server-side under the caller's session. The appointments/
 * queue_entries queries below don't filter by patient_id — RLS alone
 * scopes those to exactly this patient's own rows (ADR-010).
 *
 * profiles is different: staff can read patient profiles relationally
 * (ADR-021), so RLS returns many rows for a staff caller, not one. The
 * .eq('auth_user_id', ...) filter below isn't redundant with RLS — it's
 * what makes "exactly one row" this query's own invariant regardless of
 * caller role, so .single() fails loudly instead of throwing PGRST116
 * for a staff account that reaches this page. (This was the exact bug:
 * a staff account landing here — see the role-guard fix in this area's
 * layout — hit an unfiltered .single() against 25 visible rows.)
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
    .eq('auth_user_id', user.id)
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

  const [{ data: nextAppointment, error: appointmentError }, activeEntries] = await Promise.all([
    supabase
      .from('appointments')
      .select('id, scheduled_time, status, service:services(name)')
      .eq('status', 'booked')
      .gte('scheduled_time', 'now')
      .order('scheduled_time', { ascending: true })
      .limit(1)
      .maybeSingle(),
    getActiveQueueEntries(supabase),
  ])

  return (
    <main className="mx-auto min-h-dvh max-w-md">
      <header className="flex items-center justify-between bg-surface px-5 py-4">
        <span className="font-display text-lg font-semibold text-ink">Riverside Clinic</span>
        <div className="h-8 w-8 rounded-full bg-primary-700" aria-hidden />
      </header>

      <div className="flex flex-col gap-4 px-4 py-5">
        <h1 className="font-display text-[26px] font-bold text-ink">Hello, {firstName}</h1>

        {activeEntries.length > 0 ? (
          <QueueSummaryCard
            estimate={(activeEntries.find((e) => e.estimate.status === 'in_progress') ?? activeEntries[0]).estimate}
            otherCount={activeEntries.length - 1}
            fullWidth
          />
        ) : nextAppointment && !appointmentError ? (
          isAppointmentToday(nextAppointment.scheduled_time) ? (
            <EmptyState
              headline={`Your appointment is today at ${formatAppointmentTime(nextAppointment.scheduled_time)}.`}
              body="Check in at reception when you arrive and your queue token, position and estimated wait will appear here."
              fullWidth
            />
          ) : (
            <EmptyState
              headline={`Your appointment is on ${formatAppointmentDate(nextAppointment.scheduled_time)} at ${formatAppointmentTime(nextAppointment.scheduled_time)}.`}
              body="Check in at reception when you arrive to join the queue."
              fullWidth
            />
          )
        ) : (
          <EmptyState
            headline="No active queue entry"
            body="Book an appointment, or visit the clinic and reception will add you to the walk-in queue."
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
