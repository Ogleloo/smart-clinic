import Image from 'next/image'
import { CalendarDays, Stethoscope, UserPlus, Users, type LucideIcon } from 'lucide-react'
import { initials } from '@/lib/initials'
import { formatClinicTime } from '@/lib/clinicTime'
import type { AdminActivityEvent, AdminActivityKind, AdminDashboardData } from '@/lib/adminDashboard'
import { NeedsAttentionPanel } from '@/components/admin/NeedsAttentionPanel'
import { PredictionQualityPanel } from '@/components/admin/PredictionQualityPanel'
import { AdminQueueOverview } from './AdminQueueOverview'

export interface AdminIdentity {
  fullName: string
  clinicName: string | null
}

interface Card {
  key: string
  label: string
  icon: LucideIcon
  value: string
  caption: string
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/**
 * The four Figma cards (Today's Check-ins / Currently Waiting / In Consultation / Scheduled Today), each mapped
 * to what the database can justify. Figma's trend lines ("+6 from yesterday", "+8% from yesterday",
 * "+3 from earlier") are example text: nothing here compares with yesterday or "earlier", so none is shown;
 * the captions say what the number is made of instead. A figure that could not be read shows "—" and says so.
 */
export function buildAdminStatCards(data: AdminDashboardData): Card[] {
  const { today, clinicState, errors } = data
  const queueFailed = errors.queue
  return [
    {
      key: 'checkins',
      label: 'Today’s Check-ins',
      icon: UserPlus,
      value: queueFailed ? '—' : String(today.checkIns),
      caption: queueFailed ? 'Couldn’t load' : `${plural(today.walkIns, 'walk-in', 'walk-ins')} · ${today.fromAppointments} from appointments`,
    },
    {
      key: 'waiting',
      label: 'Currently Waiting',
      icon: Users,
      value: queueFailed ? '—' : String(clinicState.waitingNow),
      caption: queueFailed
        ? 'Couldn’t load'
        : clinicState.servicesTotal === 0
          ? 'No active services'
          : `${clinicState.servicesCovered} of ${clinicState.servicesTotal} services have a nurse on duty`,
    },
    {
      key: 'consultation',
      label: 'In Consultation',
      icon: Stethoscope,
      value: queueFailed ? '—' : String(today.inConsultation),
      caption: queueFailed
        ? 'Couldn’t load'
        : clinicState.nursesTotal === 0
          ? 'No nurse accounts'
          : `${clinicState.nursesOnDuty} of ${clinicState.nursesTotal} nurses on duty`,
    },
    {
      key: 'scheduled',
      label: 'Scheduled Today',
      icon: CalendarDays,
      value: today.scheduled === null ? '—' : String(today.scheduled),
      caption: errors.appointments || today.scheduled === null ? 'Couldn’t load' : 'Appointments dated today, not cancelled',
    },
  ]
}

const ACTIVITY_TEXT: Record<AdminActivityKind, string> = {
  checked_in: 'checked in',
  called: 'called to consultation',
  completed: 'consultation completed',
  skipped: 'skipped',
  no_show: 'marked no-show',
}

const ACTIVITY_DOT: Record<AdminActivityKind, string> = {
  checked_in: 'bg-primary-500',
  called: 'bg-[#2F6FE4]',
  completed: 'bg-[#1F7A4D]',
  skipped: 'bg-[#9A6700]',
  no_show: 'bg-[#9A6700]',
}

export function activityTitle(e: AdminActivityEvent): string {
  return `${e.token} ${ACTIVITY_TEXT[e.kind]}`
}

function ActivityPanel({ events, failed }: { events: AdminActivityEvent[]; failed: boolean }) {
  return (
    <section aria-labelledby="admin-activity" className="flex h-full flex-col gap-4 rounded-lg border border-border bg-surface p-6 shadow-[0_12px_32px_rgba(5,48,46,0.08)]">
      <div className="flex flex-col gap-1">
        <h2 id="admin-activity" className="font-display text-[22px] font-semibold text-ink">
          Today’s Activity
        </h2>
        <p className="text-base text-muted">Recent queue events today.</p>
      </div>

      {failed ? (
        <p role="alert" className="rounded-md bg-danger-bg p-3 text-sm font-semibold text-[#B42318]">
          We couldn’t load today’s activity. Reload the page to try again.
        </p>
      ) : events.length === 0 ? (
        <p className="rounded-md bg-primary-50 p-4 text-sm text-ink">No queue activity yet today. Check-ins and consultations will appear here as they happen.</p>
      ) : (
        <ol className="flex flex-col gap-4">
          {events.map((e) => (
            <li key={e.id} className="flex gap-3">
              <span aria-hidden className={`mt-2 size-2.5 shrink-0 rounded-full ${ACTIVITY_DOT[e.kind]}`} />
              <div className="flex min-w-0 flex-col">
                <time dateTime={e.at} className="text-xs text-muted">
                  {formatClinicTime(e.at)}
                </time>
                <p className="break-words text-base text-ink">{activityTitle(e)}</p>
                <p className="text-xs text-muted">{e.serviceName}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

/**
 * Presentational only — everything it shows arrives as props, so every state can be rendered and checked without
 * touching the database. Geometry follows Figma frame 168:3: content column 1176px, four cards, then the queue
 * panel beside a 380px activity panel from xl (1280px); below that everything stacks.
 */
export function AdminDashboardView({ data, identity }: { data: AdminDashboardData; identity: AdminIdentity }) {
  const cards = buildAdminStatCards(data)
  return (
    <div className="mx-auto flex w-full max-w-[1176px] flex-col gap-6 px-4 py-6 sm:px-6">
      <section aria-label="Welcome" className="flex flex-col gap-6 xl:grid xl:grid-cols-[minmax(0,1fr)_580px] xl:items-start xl:pr-4">
        <div className="flex flex-col pt-1 xl:pl-2 xl:pt-3">
          <h1 className="font-display text-[40px] font-bold leading-[44px] text-ink">
            Welcome back,
            <span className="block break-words text-[#039486]">{identity.fullName}</span>
          </h1>
          <p className="mt-2 max-w-[460px] text-base text-muted">
            Monitor clinic operations, staff coverage and queue performance.
          </p>
        </div>

        <div className="relative h-[196px] overflow-hidden rounded-lg bg-subtle">
          <Image
            src="/images/clinic/riverside-reception.webp"
            alt=""
            fill
            sizes="(min-width: 1280px) 580px, 100vw"
            className="object-cover"
            priority
          />
          <div aria-hidden className="absolute inset-0 bg-[rgba(242,251,249,0.1)]" />
          <div
            role="group"
            aria-label="Signed in as"
            className="absolute right-4 top-4 flex h-[60px] w-[320px] max-w-[calc(100%-2rem)] items-center gap-2 rounded-[24px] bg-surface pl-2 pr-4 shadow-[0_4px_12px_rgba(5,48,46,0.08)] xl:right-[46px] xl:top-[14px]"
          >
            <span aria-hidden className="flex size-[46px] shrink-0 items-center justify-center rounded-full bg-[#037F74] text-base text-white">
              {initials(identity.fullName) || '–'}
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-base leading-6 text-ink">{identity.fullName}</span>
              <span className="truncate text-xs leading-[18px] text-muted">
                Administrator{identity.clinicName ? ` • ${identity.clinicName}` : ''}
              </span>
            </span>
          </div>
        </div>
      </section>

      <NeedsAttentionPanel alerts={data.attentionAlerts} />

      <ul aria-label="Today at a glance" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(({ key, label, icon: Icon, value, caption }) => (
          <li
            key={key}
            data-stat={key}
            className="flex min-h-[180px] flex-col rounded-lg border border-border bg-surface px-[18px] pb-3 pt-[17px] shadow-[0_12px_32px_rgba(5,48,46,0.08)]"
          >
            <span className="flex size-12 items-center justify-center rounded-full bg-primary-50 text-[#037F74]">
              <Icon size={22} aria-hidden />
            </span>
            <p className="mt-3.5 text-base leading-6 text-ink">{label}</p>
            <p className="font-display text-[40px] font-bold leading-[44px] tabular-nums text-ink" data-stat-value>
              {value}
            </p>
            <p className="mt-auto pt-2 text-xs leading-[18px] text-muted">{caption}</p>
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-[18px] xl:flex-row xl:items-stretch">
        <div className="min-w-0 xl:flex-1">
          <AdminQueueOverview data={data} />
        </div>
        <div className="xl:w-[380px] xl:shrink-0">
          <ActivityPanel events={data.activity} failed={data.errors.queue} />
        </div>
      </div>

      <PredictionQualityPanel stats={data.predictionQuality} />
    </div>
  )
}
