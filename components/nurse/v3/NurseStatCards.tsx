import { CheckCheck, Clock, Stethoscope, Users, type LucideIcon } from 'lucide-react'
import type { NurseDashboardData } from '@/lib/nurseDashboard'

interface Card {
  key: string
  label: string
  icon: LucideIcon
  value: string
  caption: string
}

/**
 * The four Figma cards (My Queue / In Consultation / Completed Today / Avg. Consult Time), each mapped to
 * what the database can actually justify. Figma's trend lines ("+3 from earlier", "+4 from yesterday",
 * "-4 min from yesterday") are invented example text: nothing here compares with yesterday or "earlier",
 * so no trend is shown. A figure that could not be read shows "—" and says so; it is never a made-up zero.
 */
export function buildStatCards(data: NurseDashboardData): Card[] {
  const { nurse, queueScoped, currentEntry, waitingCount, seenToday, serviceAverageMinutes, errors } = data

  const queueCaption = errors.queue
    ? 'Couldn’t load the queue'
    : queueScoped
      ? `Waiting in ${nurse.serviceName ?? 'your service'}`
      : nurse.isOnDuty
        ? 'No service assigned'
        : 'Off duty — no queue'

  // Two independent reads feed this card: the nurse's own figures (errors.stats) and the service-wide average
  // (errors.serviceAverage). One failing never hides the other.
  const serviceAvg = serviceAverageMinutes !== null ? Math.round(serviceAverageMinutes) : null
  const serviceText = errors.serviceAverage ? 'service avg unavailable' : serviceAvg !== null ? `service avg ${serviceAvg} min` : null
  let avgValue = '—'
  let avgCaption: string
  if (errors.stats || !seenToday) {
    avgCaption = serviceText ? `Yours unavailable · ${serviceText}` : 'Couldn’t load'
  } else if (seenToday.avgMinutes !== null) {
    avgValue = `${seenToday.avgMinutes} min`
    avgCaption = serviceText ? `Yours today · ${serviceText}` : 'Yours today'
  } else {
    avgCaption = serviceText ? `None yet · ${serviceText}` : 'No completed consultations yet'
  }

  return [
    {
      key: 'queue',
      label: 'My Queue',
      icon: Users,
      value: errors.queue || waitingCount === null ? '—' : String(waitingCount),
      caption: queueCaption,
    },
    {
      key: 'consultation',
      label: 'In Consultation',
      icon: Stethoscope,
      value: errors.current ? '—' : currentEntry ? '1' : '0',
      caption: errors.current ? 'Couldn’t load' : currentEntry ? `Current patient · ${currentEntry.token}` : 'No active consultation',
    },
    {
      key: 'completed',
      label: 'Completed Today',
      icon: CheckCheck,
      value: errors.stats || !seenToday ? '—' : String(seenToday.count),
      caption: errors.stats ? 'Couldn’t load' : 'Consultations you completed',
    },
    { key: 'avg', label: 'Avg. Consult Time', icon: Clock, value: avgValue, caption: avgCaption },
  ]
}

export function NurseStatCards({ data }: { data: NurseDashboardData }) {
  const cards = buildStatCards(data)
  return (
    <ul aria-label="Your numbers" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map(({ key, label, icon: Icon, value, caption }) => (
        <li
          key={key}
          data-stat={key}
          className="flex min-h-[180px] flex-col rounded-lg border border-border bg-surface px-[18px] pb-3 pt-[17px] shadow-[0_12px_32px_rgba(5,48,46,0.08)]"
        >
          <span className="flex size-12 items-center justify-center rounded-full bg-primary-50 text-[#037F74]">
            <Icon size={22} aria-hidden />
          </span>
          <p className="mt-3.5 text-base leading-6 text-muted">{label}</p>
          <p className="font-display text-[40px] font-bold leading-[44px] tabular-nums text-ink" data-stat-value>
            {value}
          </p>
          <p className="mt-auto pt-2 text-xs leading-[18px] text-muted">{caption}</p>
        </li>
      ))}
    </ul>
  )
}
