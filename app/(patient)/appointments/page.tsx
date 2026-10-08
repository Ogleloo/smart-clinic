import { redirect } from 'next/navigation'
import Link from 'next/link'
import { CalendarCheck, CalendarDays, Clock, ListOrdered } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { EmptyState } from '@/components/ui/EmptyState'
import { LinkButton } from '@/components/ui/LinkButton'
import { StatusChip } from '@/components/ui/StatusChip'
import { appointmentStatusToChip } from '@/components/ui/AppointmentCard'
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
  service: { name: string } | null
}

const SELECT = 'id, scheduled_time, scheduled_date, status, reference, service:services(name)'

function AppointmentRow({ appointment, cancellable }: { appointment: Row; cancellable: boolean }) {
  const chip = appointmentStatusToChip(appointment.status)
  return (
    <article className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary-50 text-primary-700">
          <CalendarDays size={20} aria-hidden />
        </span>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-display text-base font-semibold text-ink">{appointment.service?.name ?? 'Appointment'}</p>
            <StatusChip status={chip.variant} label={chip.label} />
          </div>
          <p className="mt-0.5 text-sm text-muted">
            {formatClinicDate(appointment.scheduled_time)} · {formatClinicTime(appointment.scheduled_time)}
          </p>
          {appointment.reference && (
            <p className="mt-1 font-mono text-xs text-muted">
              Ref <span className="font-semibold text-ink">{appointment.reference}</span>
            </p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        <LinkButton href={`/appointments/${appointment.id}`} variant="secondary">
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
        <div className="flex flex-col gap-3 rounded-lg border border-primary-100 bg-primary-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-3 text-sm text-primary-900">
            <CalendarCheck size={20} className="mt-0.5 shrink-0 text-primary-700" aria-hidden />
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
        <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning-bg p-4 text-sm text-ink">
          <Clock size={20} className="mt-0.5 shrink-0 text-warning" aria-hidden />
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
              className={`-mb-px flex min-h-11 items-center gap-2 border-b-2 px-4 text-sm font-semibold transition-colors ${
                active ? 'border-primary-700 text-primary-700' : 'border-transparent text-muted hover:text-ink'
              }`}
            >
              {label}
              <span
                className={`rounded-full px-2 py-0.5 text-xs tabular ${active ? 'bg-primary-50 text-primary-700' : 'bg-subtle text-muted'}`}
              >
                {count}
              </span>
            </Link>
          )
        })}
      </div>

      {error ? (
        <p className="text-sm text-danger">Couldn&rsquo;t load your appointments. Try refreshing.</p>
      ) : rows.length > 0 ? (
        <div role="tabpanel" className="flex flex-col gap-3">
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
