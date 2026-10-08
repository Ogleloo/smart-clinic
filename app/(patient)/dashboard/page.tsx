import { redirect } from 'next/navigation'
import Link from 'next/link'
import {
  Bell,
  CalendarDays,
  CalendarPlus,
  ChevronRight,
  Clock,
  KeyRound,
  ListOrdered,
  MapPin,
  Pencil,
  Phone,
  User,
  type LucideIcon,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getActiveQueueEntries } from '@/lib/patientQueue'
import { getPatientClinic } from '@/lib/patientClinic'
import { LinkButton } from '@/components/ui/LinkButton'
import { AppointmentCard } from '@/components/ui/AppointmentCard'
import { EmptyState } from '@/components/ui/EmptyState'
import { QueueSummaryCard } from '@/components/ui/QueueSummaryCard'
import { PAGE_CLASS } from '@/components/patient/PageHeader'
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

const ACTION_CARDS: { href: string; title: string; body: string; icon: LucideIcon }[] = [
  { href: '/book', title: 'Book Appointment', body: 'Choose a service, day and time.', icon: CalendarPlus },
  { href: '/appointments', title: 'My Appointments', body: 'Upcoming and previous visits.', icon: CalendarDays },
  { href: '/queue', title: 'My Queue', body: 'Your token, position and wait.', icon: ListOrdered },
]

const QUICK_ACTIONS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: '/notifications', label: 'Notifications', icon: Bell },
  { href: '/profile', label: 'My profile', icon: User },
  { href: '/profile/settings', label: 'Update my details', icon: Pencil },
  { href: '/profile/settings#password', label: 'Change password', icon: KeyRound },
]

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-semibold tracking-wide text-muted">{children}</p>
}

/**
 * Patient dashboard — V3.
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

  const [{ data: nextAppointment, error: appointmentError }, activeEntries, clinic] = await Promise.all([
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
  ])

  const hoursLines = clinic && clinic.hours.length > 0 ? formatOpeningHours(clinic.hours).split(' · ') : []
  const todayLine = clinic ? todayHoursLine(clinic.hours, todayInClinicTimezone()) : null
  const clinicAddress = clinic ? [clinic.address, clinic.city].filter(Boolean).join(', ') : ''

  return (
    <main className={PAGE_CLASS}>
      <div>
        <h1 className="font-display text-[26px] font-bold text-ink md:text-[30px]">
          {greetingForNow()}, {firstName}
        </h1>
        <p className="mt-1 text-sm text-muted">{formatTodayLong()}</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {ACTION_CARDS.map(({ href, title, body, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="group flex items-center gap-3 rounded-lg border border-border bg-surface p-4 transition-colors hover:border-primary-700 sm:flex-col sm:items-start"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary-50 text-primary-700">
              <Icon size={20} aria-hidden />
            </span>
            <span className="flex-1">
              <span className="block font-display text-base font-semibold text-ink">{title}</span>
              <span className="block text-sm text-muted">{body}</span>
            </span>
            <ChevronRight size={18} className="text-muted sm:hidden" aria-hidden />
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
          <div className="flex items-center justify-between">
            <SectionLabel>NEXT APPOINTMENT</SectionLabel>
            <Link href="/appointments" className="text-xs font-semibold text-primary-700">
              View all appointments
            </Link>
          </div>
          {appointmentError ? (
            <p className="text-sm text-danger">Couldn&rsquo;t load your appointment. Try refreshing.</p>
          ) : nextAppointment ? (
            <AppointmentCard
              serviceName={nextAppointment.service?.name ?? 'Appointment'}
              scheduledAt={nextAppointment.scheduled_time}
              status={nextAppointment.status}
              reference={nextAppointment.reference}
              href={`/appointments/${nextAppointment.id}`}
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

        <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
          <div className="flex items-center justify-between">
            <SectionLabel>CURRENT QUEUE</SectionLabel>
            <Link href="/queue" className="text-xs font-semibold text-primary-700">
              Open my queue
            </Link>
          </div>
          {activeEntries.length > 0 ? (
            <QueueSummaryCard
              estimate={(activeEntries.find((e) => e.estimate.status === 'in_progress') ?? activeEntries[0]).estimate}
              otherCount={activeEntries.length - 1}
              fullWidth
            />
          ) : nextAppointment && !appointmentError ? (
            isAppointmentToday(nextAppointment.scheduled_time) ? (
              <EmptyState
                headline={`Your appointment is today at ${formatClinicTime(nextAppointment.scheduled_time)}.`}
                body="Check in at reception when you arrive and your queue token, position and estimated wait will appear here."
                fullWidth
              />
            ) : (
              <EmptyState
                headline={`Your appointment is on ${formatClinicDate(nextAppointment.scheduled_time)} at ${formatClinicTime(nextAppointment.scheduled_time)}.`}
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
        </section>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5 lg:col-span-2">
          <SectionLabel>CLINIC INFORMATION</SectionLabel>
          {clinic ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2 text-sm">
                <p className="font-display text-base font-semibold text-ink">{clinic.name}</p>
                {clinicAddress && (
                  <p className="flex items-start gap-2 text-muted">
                    <MapPin size={16} className="mt-0.5 shrink-0" aria-hidden />
                    {clinicAddress}
                  </p>
                )}
                {clinic.phone && (
                  <a
                    href={`tel:${clinic.phone.replace(/\s/g, '')}`}
                    className="flex items-center gap-2 font-semibold text-primary-700"
                  >
                    <Phone size={16} aria-hidden />
                    {clinic.phone}
                  </a>
                )}
              </div>
              <div className="flex flex-col gap-2 text-sm">
                <p className="flex items-center gap-2 font-semibold text-ink">
                  <Clock size={16} aria-hidden />
                  Opening hours
                </p>
                {todayLine && (
                  <p
                    className={`inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-semibold ${
                      todayLine === 'Closed today' ? 'bg-subtle text-muted' : 'bg-success-bg text-success'
                    }`}
                  >
                    {todayLine}
                  </p>
                )}
                {hoursLines.length > 0 ? (
                  <ul className="flex flex-col gap-0.5 text-muted tabular">
                    {hoursLines.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted">Opening hours aren&rsquo;t available right now.</p>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted">Clinic details aren&rsquo;t available right now.</p>
          )}
        </section>

        <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
          <SectionLabel>QUICK ACTIONS</SectionLabel>
          <div className="flex flex-wrap gap-2">
            {QUICK_ACTIONS.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-surface px-4 text-sm font-semibold text-ink transition-colors hover:border-primary-700 hover:text-primary-700"
              >
                <Icon size={16} aria-hidden />
                {label}
              </Link>
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}
