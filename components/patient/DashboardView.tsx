import Link from 'next/link'
import Image from 'next/image'
import {
  ArrowRight,
  Bell,
  Calendar,
  ChevronDown,
  Clock,
  FileText,
  Info,
  KeyRound,
  MapPin,
  Pencil,
  Phone,
  Stethoscope,
  User,
  Users,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import type { AppointmentStatus } from '@/lib/types/database.types'
import type { ActiveQueueEntry } from '@/lib/patientQueue'
import type { PatientClinic } from '@/lib/patientClinic'
import { QueueSummaryCard } from '@/components/ui/QueueSummaryCard'
import { LinkButton } from '@/components/ui/LinkButton'
import { PatientStatusChip } from '@/components/patient/PatientStatusChip'
import { TYPE } from '@/components/patient/PageHeader'
import { initials } from '@/lib/initials'
import { formatOpeningHours, todayHoursLine } from '@/lib/clinicHours'
import { CLINIC_TIMEZONE, formatClinicDate, formatClinicTime, greetingForNow } from '@/lib/clinicTime'

export interface NextAppointmentSummary {
  id: string
  scheduled_time: string
  status: AppointmentStatus
  reference: string | null
  service: { name: string } | null
}

export interface DashboardViewProps {
  fullName: string
  nextAppointment: NextAppointmentSummary | null
  appointmentError: boolean
  activeEntries: ActiveQueueEntry[]
  clinic: PatientClinic | null
  unreadCount: number
  today: string
}

function isAppointmentToday(iso: string, today: string): boolean {
  const appointmentDate = new Intl.DateTimeFormat('en-CA', { timeZone: CLINIC_TIMEZONE }).format(new Date(iso))
  return appointmentDate === today
}

const ACTION_CARDS: { href: string; title: string; icon: LucideIcon; bg: string; body: (clinicName: string | null) => string }[] = [
  {
    href: '/book',
    title: 'Book Appointment',
    icon: Calendar,
    bg: 'bg-card-mint',
    body: (clinicName) => (clinicName ? `Schedule a new appointment at ${clinicName}.` : 'Choose a service, day and time.'),
  },
  {
    href: '/queue',
    title: 'View My Queue',
    icon: Users,
    bg: 'bg-card-blue',
    body: () => 'Check your real-time queue position.',
  },
  {
    href: '/appointments',
    title: 'My Appointments',
    icon: FileText,
    bg: 'bg-card-purple',
    body: () => 'View and manage your upcoming and previous visits.',
  },
]

const QUICK_ACTIONS: { href: string; label: string; icon: LucideIcon; bg: string; showsUnread?: boolean }[] = [
  { href: '/notifications', label: 'Notifications', icon: Bell, bg: 'bg-[#FFF0E6]', showsUnread: true },
  { href: '/profile', label: 'My profile', icon: User, bg: 'bg-card-mint' },
  { href: '/profile/settings', label: 'Update my details', icon: Pencil, bg: 'bg-card-blue' },
  { href: '/profile/settings?panel=password', label: 'Change password', icon: KeyRound, bg: 'bg-card-purple' },
]

const CARD = 'flex flex-col gap-5 rounded-lg border border-border bg-surface p-6 shadow-[0_12px_16px_rgba(5,48,46,0.08)]'
const SECTION_HEADING = 'flex items-center gap-2 text-ink'
const ARROW_CHIP =
  'inline-flex h-10 w-9 shrink-0 items-center justify-center rounded-md bg-card-mint text-primary-700 transition-opacity group-hover:opacity-80'

/**
 * Patient dashboard — V3 (Figma 40:58), presentational. Everything here comes from props; the server component
 * (app/(patient)/dashboard/page.tsx) does all the fetching, so this can be rendered with isolated fixtures for
 * visual testing (e2e/support/render-dashboard.tsx) without a database, a session or a network call.
 *
 * Quick Actions keeps a deliberate difference from Figma, documented at the array above: Figma's four tiles
 * duplicate the three Action Cards already at the top of the page (Book Appointment, View My Queue, My
 * Appointments) plus Notifications — reusing those three link names a second time here would collide with the
 * Action Cards' own links (two links named "Book Appointment" breaks any test or assistive-tech lookup that
 * expects exactly one). The real app's own Quick Actions — profile and password-management shortcuts found
 * nowhere else on this page — are kept exactly as they were (patient-v3.spec.ts asserts these four by name:
 * Notifications, My profile, Update my details, Change password); only the tile-grid STYLE is Figma's.
 *
 * The account chip shows name and role only — never the ID/passport number. Figma's static reference happens
 * to show one, but that's a design mockup's sample data, not a license to put a national ID on screen every
 * time this page loads; the full identity record stays behind the existing profile/settings workflows, where
 * it belongs. The dashboard page no longer even fetches id_number (see app/(patient)/dashboard/page.tsx).
 */
export function DashboardView({ fullName, nextAppointment, appointmentError, activeEntries, clinic, unreadCount, today }: DashboardViewProps) {
  const firstName = fullName.split(' ')[0]!
  const hoursLines = clinic && clinic.hours.length > 0 ? formatOpeningHours(clinic.hours).split(' · ') : []
  const todayLine = clinic ? todayHoursLine(clinic.hours, today) : null
  const clinicAddressLines = clinic ? [clinic.address, clinic.city].filter(Boolean) : []

  return (
    <div className="flex flex-col gap-6">
      {/* Header band (Figma 40:104). The decorative photo banner and translucent shapes are a flourish Figma
          adds for desktop only; kept here as a plain <img> (not next/image — this is a fixed local asset shown
          purely for atmosphere, not an optimised content image) and hidden below lg so phone/tablet widths keep
          the full-width greeting instead of squeezing a sliver of photo in beside it. */}
      <div className="relative flex min-h-[160px] flex-col gap-4 overflow-hidden rounded-[24px] bg-card-mint p-6 sm:flex-row sm:flex-wrap sm:items-center sm:gap-6 sm:p-8">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1 className={`${TYPE.pageTitle} break-words`}>
            {greetingForNow()}, <span className="text-primary-700">{firstName}</span>
          </h1>
          <p className="text-base text-muted">Manage your appointments and stay updated with your queue.</p>
        </div>

        <Link
          href="/profile"
          className="relative z-10 flex w-full min-w-0 items-center gap-3 rounded-[24px] bg-surface py-2 pl-3 pr-4 shadow-[0_12px_16px_rgba(5,48,46,0.08)] hover:opacity-90 sm:w-fit sm:max-w-[280px] sm:shrink-0"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-700 text-sm font-semibold text-white" aria-hidden>
            {initials(fullName) || '–'}
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-base leading-6 text-ink">{fullName}</span>
            <span className="text-xs leading-[18px] text-muted">Patient</span>
          </span>
          <ChevronDown size={14} className="shrink-0 text-muted" aria-hidden />
        </Link>

        <div aria-hidden className="absolute inset-y-0 right-0 hidden w-[42%] lg:block">
          {/* eslint-disable-next-line @next/next/no-img-element -- decorative atmosphere image, not optimised content */}
          <img src="/images/clinic/riverside-reception.webp" alt="" className="h-full w-full object-cover opacity-90" />
          <div className="absolute inset-0 bg-gradient-to-r from-card-mint via-card-mint/40 to-transparent" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {ACTION_CARDS.map(({ href, title, body, icon: Icon, bg }) => (
          <Link
            key={href}
            href={href}
            className={`group flex min-h-[200px] flex-col justify-between gap-4 rounded-[16px] p-6 shadow-[0_12px_16px_rgba(5,48,46,0.08)] transition-opacity hover:opacity-90 ${bg}`}
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface text-primary-700">
              <Icon size={24} aria-hidden />
            </span>
            <span className="flex flex-col gap-2">
              <span className={TYPE.section}>{title}</span>
              <span className={TYPE.small}>{body(clinic?.name ?? null)}</span>
            </span>
            <span className="flex justify-end">
              <span className={ARROW_CHIP}>
                <ArrowRight size={18} aria-hidden />
              </span>
            </span>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className={CARD} aria-labelledby="next-appointment">
          <div className="flex items-center justify-between gap-4">
            <h2 id="next-appointment" className={SECTION_HEADING}>
              <Calendar size={18} className="text-muted" aria-hidden />
              <span className={TYPE.section}>Next Appointment</span>
            </h2>
            <Link href="/appointments" className="text-sm font-semibold text-primary-700">
              View all
            </Link>
          </div>
          {appointmentError ? (
            <p className="text-base text-danger">Couldn&rsquo;t load your appointment. Try refreshing.</p>
          ) : nextAppointment ? (
            <Link
              href={`/appointments/${nextAppointment.id}`}
              className="group flex flex-1 items-center justify-between gap-4 rounded-[16px] bg-paper p-4 hover:bg-card-mint"
            >
              <span className="flex min-w-0 items-center gap-4">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-card-mint text-primary-700">
                  <Stethoscope size={22} aria-hidden />
                </span>
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="text-base text-ink">{nextAppointment.service?.name ?? 'Appointment'}</span>
                  <span className="flex flex-wrap items-center gap-4 text-xs text-muted">
                    <span className="flex items-center gap-1">
                      <Calendar size={14} aria-hidden />
                      {formatClinicDate(nextAppointment.scheduled_time)}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock size={14} aria-hidden />
                      {formatClinicTime(nextAppointment.scheduled_time)}
                    </span>
                    {clinic && (
                      <span className="flex items-center gap-1">
                        <MapPin size={14} aria-hidden />
                        {clinic.name}
                      </span>
                    )}
                  </span>
                  {nextAppointment.reference && (
                    <span className="text-xs text-muted">
                      Ref <span className="font-mono text-ink">{nextAppointment.reference}</span>
                    </span>
                  )}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-3">
                <PatientStatusChip status={nextAppointment.status} />
                <span className={ARROW_CHIP}>
                  <ArrowRight size={18} aria-hidden />
                </span>
              </span>
            </Link>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-[16px] bg-paper p-6 text-center">
              <p className="text-base text-ink">No upcoming appointments</p>
              <p className="text-xs text-muted">Book one to skip the walk-in queue.</p>
              <LinkButton href="/book" variant="secondary">
                Book appointment
              </LinkButton>
            </div>
          )}
        </section>

        <section className={CARD} aria-labelledby="current-queue">
          <div className="flex items-center justify-between gap-4">
            <h2 id="current-queue" className={SECTION_HEADING}>
              <Users size={18} className="text-muted" aria-hidden />
              <span className={TYPE.section}>Current Queue</span>
            </h2>
            <Link href="/queue" className="text-sm font-semibold text-primary-700">
              Open my queue
            </Link>
          </div>
          {activeEntries.length > 0 ? (
            <QueueSummaryCard
              estimate={(activeEntries.find((e) => e.estimate.status === 'in_progress') ?? activeEntries[0]!).estimate}
              otherCount={activeEntries.length - 1}
              fullWidth
            />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-[16px] bg-paper p-6 text-center">
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-subtle text-muted" aria-hidden>
                <Users size={32} />
              </span>
              {nextAppointment && !appointmentError ? (
                isAppointmentToday(nextAppointment.scheduled_time, today) ? (
                  <>
                    <p className="text-base text-ink">Your appointment is today at {formatClinicTime(nextAppointment.scheduled_time)}.</p>
                    <p className="text-xs text-muted">
                      Check in at reception when you arrive and your queue token, position and estimated wait will appear here.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-base text-ink">
                      Your appointment is on {formatClinicDate(nextAppointment.scheduled_time)} at {formatClinicTime(nextAppointment.scheduled_time)}.
                    </p>
                    <p className="text-xs text-muted">Check in at reception when you arrive to join the queue.</p>
                  </>
                )
              ) : (
                <>
                  <p className="text-base text-ink">You are not currently in a queue</p>
                  <p className="text-xs text-muted">Book an appointment or check in at reception to join a queue.</p>
                </>
              )}
            </div>
          )}
        </section>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className={CARD} aria-labelledby="clinic-information">
          <h2 id="clinic-information" className={SECTION_HEADING}>
            <Info size={18} className="text-muted" aria-hidden />
            <span className={TYPE.section}>Clinic Information</span>
          </h2>
          {clinic ? (
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
              <div className="flex min-w-0 flex-1 flex-col gap-4">
                <p className="flex items-start gap-3 text-base">
                  <MapPin size={16} className="mt-1 shrink-0 text-muted" aria-hidden />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-ink">{clinic.name}</span>
                    {clinicAddressLines.map((line) => (
                      <span key={line} className="text-muted">
                        {line}
                      </span>
                    ))}
                  </span>
                </p>
                <div className="flex items-start gap-3 text-base">
                  <Clock size={16} className="mt-1 shrink-0 text-muted" aria-hidden />
                  <span className="flex flex-col gap-1">
                    <span className="text-ink">Operating hours</span>
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
                      <span className="flex flex-col text-muted tabular">
                        {hoursLines.map((line) => (
                          <span key={line}>{line}</span>
                        ))}
                      </span>
                    ) : (
                      <span className="text-muted">Opening hours aren&rsquo;t available right now.</span>
                    )}
                    {clinic.phone && (
                      <a href={`tel:${clinic.phone.replace(/\s/g, '')}`} className="mt-1 flex items-center gap-2 text-primary-700">
                        <Phone size={16} aria-hidden />
                        {clinic.phone}
                      </a>
                    )}
                  </span>
                </div>
              </div>
              {/*
                Approved illustrative clinic image, not a verified photograph of the actual Riverside Clinic —
                alt text stays generic rather than clinic.name for that reason.
              */}
              <div className="relative h-36 w-full shrink-0 overflow-hidden rounded-[16px] bg-subtle sm:h-36 sm:w-60">
                <Image src="/images/clinic/riverside-exterior.webp" alt="Clinic building exterior" fill sizes="(min-width: 640px) 240px, 100vw" className="object-cover" />
              </div>
            </div>
          ) : (
            <p className="text-base text-muted">Clinic details aren&rsquo;t available right now.</p>
          )}
        </section>

        <section className={CARD} aria-labelledby="quick-actions">
          <h2 id="quick-actions" className={SECTION_HEADING}>
            <Zap size={18} className="text-muted" aria-hidden />
            <span className={TYPE.section}>Quick Actions</span>
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {QUICK_ACTIONS.map(({ href, label, icon: Icon, bg, showsUnread }) => (
              <Link
                key={href}
                href={href}
                className="relative flex min-h-11 items-center gap-3 rounded-[16px] border border-border bg-surface p-3 text-base text-ink transition-colors hover:border-primary-700"
              >
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[16px] ${bg} text-primary-700`}>
                  <Icon size={18} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">{label}</span>
                {showsUnread && unreadCount > 0 && (
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-danger" aria-label="Unread notifications" />
                )}
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
