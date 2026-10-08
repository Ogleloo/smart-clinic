import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Calendar, CalendarCheck, Clock, ListOrdered, MapPin, Stethoscope } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { EmptyState } from '@/components/ui/EmptyState'
import { LinkButton } from '@/components/ui/LinkButton'
import { PatientStatusChip } from '@/components/patient/PatientStatusChip'
import { CancelAppointmentButton } from '@/components/booking/CancelAppointmentButton'
import { PAGE_CLASS, PageHeader } from '@/components/patient/PageHeader'
import { formatClinicDate, formatClinicTime, todayInClinicTimezone } from '@/lib/clinicTime'
import type { AppointmentStatus } from '@/lib/types/database.types'

type Tab = 'upcoming' | 'previous'

type Row = {
  id: string
  scheduled_time: string
  scheduled_date: string
  status: AppointmentStatus
  reference: string | null
  service: {
    name: string
    description: string | null
    clinic: { name: string; city: string | null } | null
  } | null
}

const SELECT =
  'id, scheduled_time, scheduled_date, status, reference, service:services(name, description, clinic:clinics(name, city))'

function AppointmentRow({ appointment, cancellable }: { appointment: Row; cancellable: boolean }) {
  const clinic = appointment.service?.clinic
  const location = clinic ? [clinic.name, clinic.city].filter(Boolean).join(', ') : null
  return (
    <article className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-6 md:flex-row md:items-center md:justify-between">
      <div className="flex items-start gap-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary-700 text-white">
          <Stethoscope size={20} aria-hidden />
        </span>
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-base font-semibold text-ink">{appointment.service?.name ?? 'Appointment'}</p>
            <PatientStatusChip status={appointment.status} />
          </div>
          {appointment.service?.description && (
            <p className="text-xs text-muted">{appointment.service.description}</p>
          )}
          <div className="flex flex-wrap items-center gap-4 text-xs text-muted">
            <span className="flex items-center gap-1">
              <Calendar size={14} aria-hidden />
              {formatClinicDate(appointment.scheduled_time)}
            </span>
            <span className="flex items-center gap-1">
              <Clock size={14} aria-hidden />
              {formatClinicTime(appointment.scheduled_time)}
            </span>
            {location && (
              <span className="flex items-center gap-1">
                <MapPin size={14} aria-hidden />
                {location}
              </span>
            )}
          </div>
          {appointment.reference && (
            <p className="text-xs text-muted">
              Ref <span className="font-mono text-ink">{appointment.reference}</span>
            </p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 md:justify-end">
        <LinkButton href={`/appointments/${appointment.id}`} variant="primary">
          View details
        </LinkButton>
        {cancellable && <CancelAppointmentButton appointmentId={appointment.id} status={appointment.status} compact />}
      </div>
    </article>
  )
}

/**
 * My Appointments — V3, Upcoming / Previous tabs.
 *
 * Upcoming: still-active bookings (booked or checked in) from today on.
 * Previous: everything else — any earlier date, or anything already
 * finished with (completed, cancelled, missed) — so a cancelled future
 * slot doesn't keep sitting among the visits the patient still has.
 *
 * "Today" is the clinic's date (ADR-020), compared against
 * scheduled_date, which the backend derives in the same timezone. A
 * booking from earlier today that hasn't been marked a no-show yet stays
 * under Upcoming until mark_overdue_no_shows says otherwise.
 *
 * The tab lives in the URL (?tab=previous) so it's server-rendered,
 * linkable, and survives a refresh.
 */
export default async function AppointmentsListPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>
}) {
  const { tab: rawTab } = await searchParams
  const tab: Tab = rawTab === 'previous' ? 'previous' : 'upcoming'

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const today = todayInClinicTimezone()

  const [{ data: upcoming, error: upcomingError }, { data: previous, error: previousError }] = await Promise.all([
    supabase
      .from('appointments')
      .select(SELECT)
      .in('status', ['booked', 'checked_in'])
      .gte('scheduled_date', today)
      .order('scheduled_time', { ascending: true }),
    supabase
      .from('appointments')
      .select(SELECT)
      .or(`status.in.(cancelled,no_show,completed),scheduled_date.lt.${today}`)
      .order('scheduled_time', { ascending: false }),
  ])

  const error = upcomingError || previousError
  const todays = (upcoming ?? []).filter((a) => a.scheduled_date === today)
  const checkedInToday = todays.find((a) => a.status === 'checked_in')
  const bookedToday = todays.find((a) => a.status === 'booked')
  const rows = (tab === 'upcoming' ? upcoming : previous) ?? []

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'upcoming', label: 'Upcoming', count: upcoming?.length ?? 0 },
    { key: 'previous', label: 'Previous', count: previous?.length ?? 0 },
  ]

  return (
    <main className={PAGE_CLASS}>
      <PageHeader
        title="My Appointments"
        action={
          <LinkButton href="/book" variant="primary">
            Book appointment
          </LinkButton>
        }
      />

      {checkedInToday ? (
        <div className="flex flex-col gap-4 rounded-lg bg-card-mint p-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-3 text-base text-ink">
            <CalendarCheck size={20} className="shrink-0 text-primary-700" aria-hidden />
            <span>
              <span className="font-semibold">You&rsquo;re checked in</span> for{' '}
              {checkedInToday.service?.name ?? 'your appointment'}. Follow your place in the queue.
            </span>
          </p>
          <LinkButton href="/queue" variant="primary">
            <ListOrdered size={16} className="mr-2" aria-hidden />
            My queue
          </LinkButton>
        </div>
      ) : bookedToday ? (
        <div className="flex items-start gap-3 rounded-lg bg-card-blue p-5 text-base text-ink">
          <Clock size={20} className="shrink-0 text-primary-700" aria-hidden />
          <p>
            <span className="font-semibold">
              Your {bookedToday.service?.name ?? ''} appointment is today at {formatClinicTime(bookedToday.scheduled_time)}.
            </span>{' '}
            Check in at reception when you arrive
            {bookedToday.reference ? (
              <>
                {' '}
                and quote reference <span className="font-mono font-semibold">{bookedToday.reference}</span>
              </>
            ) : null}
            .
          </p>
        </div>
      ) : null}

      <div role="tablist" aria-label="Appointments" className="flex gap-1 border-b border-border">
        {tabs.map(({ key, label, count }) => {
          const active = key === tab
          return (
            <Link
              key={key}
              role="tab"
              aria-selected={active}
              href={key === 'upcoming' ? '/appointments' : '/appointments?tab=previous'}
              className={`-mb-px flex min-h-12 items-center gap-2 border-b-2 px-4 text-sm font-semibold transition-colors ${
                active ? 'border-primary-700 text-primary-700' : 'border-transparent text-muted hover:text-ink'
              }`}
            >
              {label}
              <span
                className={`rounded-full px-2 py-1 text-xs tabular ${active ? 'bg-card-mint text-primary-700' : 'bg-subtle text-muted'}`}
              >
                {count}
              </span>
            </Link>
          )
        })}
      </div>

      {error ? (
        <p className="text-base text-danger">Couldn&rsquo;t load your appointments. Try refreshing.</p>
      ) : rows.length > 0 ? (
        <div role="tabpanel" className="flex flex-col gap-4">
          {rows.map((appointment) => (
            <AppointmentRow
              key={appointment.id}
              appointment={appointment}
              cancellable={tab === 'upcoming' && appointment.status === 'booked'}
            />
          ))}
        </div>
      ) : tab === 'upcoming' ? (
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
      ) : (
        <EmptyState headline="No previous appointments" body="Past, cancelled and missed visits will show here." fullWidth />
      )}
    </main>
  )
}
