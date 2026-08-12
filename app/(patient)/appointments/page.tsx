import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { AppointmentCard } from '@/components/ui/AppointmentCard'
import { EmptyState } from '@/components/ui/EmptyState'
import { LinkButton } from '@/components/ui/LinkButton'

/**
 * Full appointments list (upcoming + past) — previously the only way to
 * reach an appointment other than the next one was the dashboard's single
 * "next appointment" card, which meant no route back to a past or
 * already-viewed appointment, and no way to cancel one that wasn't the
 * very next.
 *
 * 'now' (not a JS-computed timestamp) lets Postgres resolve the boundary
 * against its own clock — the same trick the dashboard's next-appointment
 * query already uses, so the two can't disagree about what's "upcoming".
 */
export default async function AppointmentsListPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [
    { data: upcoming, error: upcomingError },
    { data: past, error: pastError },
  ] = await Promise.all([
    supabase
      .from('appointments')
      .select('id, scheduled_time, status, service:services(name)')
      .gte('scheduled_time', 'now')
      .order('scheduled_time', { ascending: true }),
    supabase
      .from('appointments')
      .select('id, scheduled_time, status, service:services(name)')
      .lt('scheduled_time', 'now')
      .order('scheduled_time', { ascending: false }),
  ])

  const error = upcomingError || pastError

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-4 py-6">
      <h1 className="font-display text-[22px] font-bold text-ink">Appointments</h1>

      {error ? (
        <p className="text-sm text-danger">Couldn&rsquo;t load your appointments. Try refreshing.</p>
      ) : (
        <>
          <section className="flex flex-col gap-3">
            <p className="text-xs font-semibold tracking-wide text-muted">UPCOMING</p>
            {upcoming && upcoming.length > 0 ? (
              <div className="flex flex-col gap-3">
                {upcoming.map((appointment) => (
                  <AppointmentCard
                    key={appointment.id}
                    serviceName={appointment.service?.name ?? 'Appointment'}
                    scheduledAt={appointment.scheduled_time}
                    status={appointment.status}
                    href={`/appointments/${appointment.id}`}
                    fullWidth
                  />
                ))}
              </div>
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

          <section className="flex flex-col gap-3">
            <p className="text-xs font-semibold tracking-wide text-muted">PAST</p>
            {past && past.length > 0 ? (
              <div className="flex flex-col gap-3">
                {past.map((appointment) => (
                  <AppointmentCard
                    key={appointment.id}
                    serviceName={appointment.service?.name ?? 'Appointment'}
                    scheduledAt={appointment.scheduled_time}
                    status={appointment.status}
                    href={`/appointments/${appointment.id}`}
                    fullWidth
                  />
                ))}
              </div>
            ) : (
              <EmptyState headline="No past appointments" fullWidth />
            )}
          </section>
        </>
      )}
    </main>
  )
}
