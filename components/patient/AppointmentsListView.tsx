import Link from 'next/link'
import { CalendarCheck, Clock, Info, ListOrdered } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'
import { LinkButton } from '@/components/ui/LinkButton'
import { PatientHeaderBanner } from '@/components/patient/PatientHeaderBanner'
import { AppointmentCard, type AppointmentCardAppointment } from '@/components/patient/AppointmentCard'
import { formatClinicTime } from '@/lib/clinicTime'

export type Tab = 'upcoming' | 'previous'

export interface TodayBannerAppointment {
  service: { name: string } | null
  scheduled_time: string
  reference: string | null
}

export interface AppointmentsListViewProps {
  fullName: string
  tab: Tab
  upcomingCount: number
  previousCount: number
  rows: AppointmentCardAppointment[]
  error: boolean
  checkedInToday: TodayBannerAppointment | null
  bookedToday: TodayBannerAppointment | null
}

const TABS: { key: Tab; label: string }[] = [
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'previous', label: 'Previous' },
]

/**
 * My Appointments — V3 (Figma 71:85), presentational. Everything comes from props; the server component
 * (app/(patient)/appointments/page.tsx) does all the fetching, following the same split as the dashboard
 * (PR #47) and the booking screens (PR #48).
 */
export function AppointmentsListView({
  fullName,
  tab,
  upcomingCount,
  previousCount,
  rows,
  error,
  checkedInToday,
  bookedToday,
}: AppointmentsListViewProps) {
  return (
    <div className="flex flex-col gap-6">
      <PatientHeaderBanner
        title="My appointments"
        subtitle="View and manage your upcoming and previous clinic appointments."
        fullName={fullName}
      />

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div role="tablist" aria-label="Appointments" className="flex gap-1 border-b border-border">
          {TABS.map(({ key, label }) => {
            const active = key === tab
            const count = key === 'upcoming' ? upcomingCount : previousCount
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
                <span className={`rounded-full px-2 py-1 text-xs tabular ${active ? 'bg-card-mint text-primary-700' : 'bg-subtle text-muted'}`}>
                  {count}
                </span>
              </Link>
            )
          })}
        </div>
        <LinkButton href="/book" variant="primary">
          + Book appointment
        </LinkButton>
      </div>

      {checkedInToday ? (
        <div className="flex flex-col gap-4 rounded-lg bg-card-mint p-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-3 text-base text-ink">
            <CalendarCheck size={20} className="shrink-0 text-primary-700" aria-hidden />
            <span>
              <span className="font-semibold">You&rsquo;re checked in</span> for {checkedInToday.service?.name ?? 'your appointment'}.
              Follow your place in the queue.
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

      <section className="flex flex-col gap-4 rounded-[16px] border border-border bg-surface p-6 shadow-[0_12px_32px_rgba(5,48,46,0.08)]">
        <h2 className="font-display text-[22px] font-semibold text-ink">
          {tab === 'upcoming' ? 'Upcoming appointments' : 'Previous appointments'}
        </h2>

        {error ? (
          <p className="text-base text-danger">Couldn&rsquo;t load your appointments. Try refreshing.</p>
        ) : rows.length > 0 ? (
          <div role="tabpanel" className="flex flex-col gap-4">
            {rows.map((appointment) => (
              <AppointmentCard key={appointment.id} appointment={appointment} cancellable={tab === 'upcoming' && appointment.status === 'booked'} />
            ))}
          </div>
        ) : tab === 'upcoming' ? (
          <EmptyState
            headline="No upcoming appointments"
            // Booking a slot does not skip the walk-in queue — a booked patient still checks in and is
            // issued a queue token at reception (see the check-in note below, and BEFORE_VISIT_CHECKLIST).
            // It only reserves a time, so the copy here must not imply otherwise.
            body="Reserve a time — you'll still check in and queue when you arrive."
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
      </section>

      <div className="flex items-center gap-5 rounded-[16px] border border-border bg-card-mint p-6">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-surface text-primary-700">
          <Info size={22} aria-hidden />
        </span>
        <div className="flex flex-col gap-1">
          <p className="text-base text-ink">Appointment check-in</p>
          <p className="text-sm text-muted">
            When you arrive at the clinic, check in at reception. Your queue token and estimated wait appear after check-in.
          </p>
        </div>
      </div>
    </div>
  )
}
