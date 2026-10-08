import { redirect } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowRight,
  Bell,
  Building2,
  Calendar,
  Clock,
  FileText,
  KeyRound,
  MapPin,
  Pencil,
  Phone,
  User,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getActiveQueueEntries } from '@/lib/patientQueue'
import { getPatientClinic } from '@/lib/patientClinic'
import { LinkButton } from '@/components/ui/LinkButton'
import { QueueSummaryCard } from '@/components/ui/QueueSummaryCard'
import { PatientStatusChip } from '@/components/patient/PatientStatusChip'
import { PAGE_CLASS, TYPE } from '@/components/patient/PageHeader'
import { formatOpeningHours, todayHoursLine } from '@/lib/clinicHours'
import {
  CLINIC_TIMEZONE,
  formatClinicDate,
  formatClinicTime,
  formatTodayLong,
  greetingForNow,
  todayInClinicTimezone,
} from '@/lib/clinicTime'

function isAppointmentToday(iso: string): boolean {
  const appointmentDate = new Intl.DateTimeFormat('en-CA', { timeZone: CLINIC_TIMEZONE }).format(
    new Date(iso)
  )
  return appointmentDate === todayInClinicTimezone()
}

const ACTION_CARDS: { href: string; title: string; body: string; icon: LucideIcon; bg: string }[] = [
  { href: '/book', title: 'Book Appointment', body: 'Choose a service, day and time.', icon: Calendar, bg: 'bg-card-mint' },
  { href: '/queue', title: 'View My Queue', body: 'Your token, position and estimated wait.', icon: Users, bg: 'bg-card-blue' },
  { href: '/appointments', title: 'My Appointments', body: 'Upcoming and previous visits.', icon: FileText, bg: 'bg-card-purple' },
]

const QUICK_ACTIONS: { href: string; label: string; icon: LucideIcon; showsUnread?: boolean }[] = [
  { href: '/notifications', label: 'Notifications', icon: Bell, showsUnread: true },
  { href: '/profile', label: 'My profile', icon: User },
  { href: '/profile/settings', label: 'Update my details', icon: Pencil },
  { href: '/profile/settings#password', label: 'Change password', icon: KeyRound },
]

const CARD = 'flex flex-col gap-4 rounded-lg border border-border bg-surface p-6'

/**
 * Patient dashboard — V3 (Figma).
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
        <p className="text-base font-semibold text-ink">Couldn&rsquo;t load your account</p>
        <p className="text-base text-muted">
          Please refresh the page. If this keeps happening, contact the clinic.
        </p>
      </main>
    )
  }

  const firstName = profile.full_name.split(' ')[0]

  const [{ data: nextAppointment, error: appointmentError }, activeEntries, clinic, { count: unreadCount }] =
    await Promise.all([
      supabase
        .from('appointments')
        .select('id, scheduled_time, status, reference, service:services(name)')
        .eq('status', 'booked')
        .gte('scheduled_time', 'now')
        .order('scheduled_time', { ascending: true })
        .limit(1)
        .maybeSingle(),
      getActiveQueueEntries(supabase),
      getPatientClinic(),
      supabase.from('notifications').select('*', { count: 'exact', head: true }).is('read_at', null),
    ])

  const hoursLines = clinic && clinic.hours.length > 0 ? formatOpeningHours(clinic.hours).split(' · ') : []
  const todayLine = clinic ? todayHoursLine(clinic.hours, todayInClinicTimezone()) : null
  const clinicAddress = clinic ? [clinic.address, clinic.city].filter(Boolean).join(', ') : ''

  return (
    <main className={PAGE_CLASS}>
      <div className="flex flex-col gap-1">
        <h1 className={TYPE.pageTitle}>
          {greetingForNow()}, {firstName}
        </h1>
        <p className="text-base text-muted">{formatTodayLong()}</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {ACTION_CARDS.map(({ href, title, body, icon: Icon, bg }) => (
          <Link
            key={href}
            href={href}
            className={`flex min-h-[200px] flex-col justify-between gap-4 rounded-lg p-6 transition-opacity hover:opacity-90 ${bg}`}
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface text-primary-700">
              <Icon size={24} aria-hidden />
            </span>
            <span className="flex items-end justify-between gap-4">
              <span className="flex flex-col gap-1">
                <span className={TYPE.section}>{title}</span>
                <span className={TYPE.small}>{body}</span>
              </span>
              <ArrowRight size={24} className="shrink-0 text-primary-700" aria-hidden />
            </span>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className={CARD} aria-labelledby="next-appointment">
          <div className="flex items-center justify-between gap-4">
            <h2 id="next-appointment" className={TYPE.section}>
              Next Appointment
            </h2>
            <Link href="/appointments" className="text-sm font-semibold text-primary-700">
              View all appointments
            </Link>
          </div>
          {appointmentError ? (
            <p className="text-base text-danger">Couldn&rsquo;t load your appointment. Try refreshing.</p>
          ) : nextAppointment ? (
            <Link
              href={`/appointments/${nextAppointment.id}`}
              className="flex flex-1 items-center justify-between gap-4 rounded-md border border-border p-4 hover:border-primary-700"
            >
              <span className="flex flex-col gap-2">
                <span className="text-base font-semibold text-ink">{nextAppointment.service?.name ?? 'Appointment'}</span>
                <span className="flex flex-wrap items-center gap-4 text-xs text-muted">
                  <span className="flex items-center gap-1">
                    <Calendar size={14} aria-hidden />
                    {formatClinicDate(nextAppointment.scheduled_time)}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock size={14} aria-hidden />
                    {formatClinicTime(nextAppointment.scheduled_time)}
                  </span>
                </span>
                {nextAppointment.reference && (
                  <span className="text-xs text-muted">
                    Ref <span className="font-mono text-ink">{nextAppointment.reference}</span>
                  </span>
                )}
                <PatientStatusChip status={nextAppointment.status} />
              </span>
              <ArrowRight size={20} className="shrink-0 text-primary-700" aria-hidden />
            </Link>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-md bg-paper p-6 text-center">
              <p className="text-base font-semibold text-ink">No upcoming appointments</p>
              <p className="text-xs text-muted">Book one to skip the walk-in queue.</p>
              <LinkButton href="/book" variant="secondary">
                Book appointment
              </LinkButton>
            </div>
          )}
        </section>

        <section className={CARD} aria-labelledby="current-queue">
          <div className="flex items-center justify-between gap-4">
            <h2 id="current-queue" className={TYPE.section}>
              Current Queue
            </h2>
            <Link href="/queue" className="text-sm font-semibold text-primary-700">
              Open my queue
            </Link>
          </div>
          {activeEntries.length > 0 ? (
            <QueueSummaryCard
              estimate={(activeEntries.find((e) => e.estimate.status === 'in_progress') ?? activeEntries[0]).estimate}
              otherCount={activeEntries.length - 1}
              fullWidth
            />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-md bg-paper p-6 text-center">
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-subtle text-muted" aria-hidden>
                <Users size={32} />
              </span>
              {nextAppointment && !appointmentError ? (
                isAppointmentToday(nextAppointment.scheduled_time) ? (
                  <>
                    <p className="text-base font-semibold text-ink">
                      Your appointment is today at {formatClinicTime(nextAppointment.scheduled_time)}.
                    </p>
                    <p className="text-xs text-muted">
                      Check in at reception when you arrive and your queue token, position and estimated wait will
                      appear here.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-base font-semibold text-ink">
                      Your appointment is on {formatClinicDate(nextAppointment.scheduled_time)} at{' '}
                      {formatClinicTime(nextAppointment.scheduled_time)}.
                    </p>
                    <p className="text-xs text-muted">Check in at reception when you arrive to join the queue.</p>
                  </>
                )
              ) : (
                <>
                  <p className="text-base font-semibold text-ink">You are not currently in a queue</p>
                  <p className="text-xs text-muted">
                    Book an appointment, or visit the clinic and reception will add you to the walk-in queue.
                  </p>
                </>
              )}
            </div>
          )}
        </section>
      </div>

      <section className={CARD} aria-labelledby="clinic-information">
        <h2 id="clinic-information" className={TYPE.section}>
          Clinic Information
        </h2>
        {clinic ? (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <div
              className="flex min-h-36 items-center justify-center rounded-md bg-subtle text-muted"
              role="img"
              aria-label="Clinic photo placeholder"
            >
              <Building2 size={40} aria-hidden />
            </div>
            <div className="flex flex-col gap-2">
              <p className="text-base font-semibold text-ink">{clinic.name}</p>
              {clinicAddress && (
                <p className="flex items-start gap-2 text-base text-muted">
                  <MapPin size={20} className="shrink-0" aria-hidden />
                  {clinicAddress}
                </p>
              )}
              {clinic.phone && (
                <a
                  href={`tel:${clinic.phone.replace(/\s/g, '')}`}
                  className="flex items-center gap-2 text-base text-primary-700"
                >
                  <Phone size={20} aria-hidden />
                  {clinic.phone}
                </a>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <p className="flex items-center gap-2 text-base font-semibold text-ink">
                <Clock size={20} aria-hidden />
                Opening hours
              </p>
              {todayLine && (
                <span
                  className={`inline-flex w-fit rounded-full px-3 py-1 text-sm font-semibold ${
                    todayLine === 'Closed today' ? 'bg-subtle text-muted' : 'bg-card-mint text-primary-700'
                  }`}
                >
                  {todayLine}
                </span>
              )}
              {hoursLines.length > 0 ? (
                <ul className="flex flex-col gap-1 text-base text-muted tabular">
                  {hoursLines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-base text-muted">Opening hours aren&rsquo;t available right now.</p>
              )}
            </div>
          </div>
        ) : (
          <p className="text-base text-muted">Clinic details aren&rsquo;t available right now.</p>
        )}
      </section>

      <section className="flex flex-col gap-4" aria-labelledby="quick-actions">
        <h2 id="quick-actions" className={TYPE.section}>
          Quick Actions
        </h2>
        <div className="flex flex-wrap gap-3">
          {QUICK_ACTIONS.map(({ href, label, icon: Icon, showsUnread }) => (
            <Link
              key={href}
              href={href}
              className="relative inline-flex min-h-11 items-center gap-2 rounded-md border border-border bg-surface px-4 text-sm font-semibold text-ink transition-colors hover:border-primary-700 hover:text-primary-700"
            >
              <Icon size={20} aria-hidden />
              {label}
              {showsUnread && (unreadCount ?? 0) > 0 && (
                <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-danger" aria-label="Unread notifications" />
              )}
            </Link>
          ))}
        </div>
      </section>
    </main>
  )
}
