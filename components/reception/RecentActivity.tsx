import { formatRelativeTime } from '@/lib/clinicTime'
import { EmptyState } from '@/components/ui/EmptyState'
import type { ActivityEvent } from '@/lib/receptionDashboard'

/**
 * Read-only glance-back at the last ~10 real events today — visit history,
 * not admin analytics moved onto this screen. Figma frame 111:2 "Timeline"
 * alternates the marker colour per row purely for visual rhythm (not a
 * status code) — reproduced the same way here, not derived from event data.
 */
export function RecentActivity({ events }: { events: ActivityEvent[] }) {
  if (events.length === 0) {
    return <EmptyState headline="No activity yet today" fullWidth />
  }

  return (
    <ul className="flex flex-col">
      {events.map((event, i) => (
        <li key={event.id} className="flex items-stretch gap-3 py-2 first:pt-0 last:pb-0">
          <div aria-hidden className="relative flex w-4 shrink-0 flex-col items-center">
            <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${i % 2 === 0 ? 'bg-primary-500' : 'bg-primary-700'}`} />
            {i < events.length - 1 && <span className="mt-1 w-px flex-1 bg-border" />}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5 pb-2">
            <div className="flex items-start justify-between gap-3">
              <span className="text-base text-ink">
                <span className="font-mono font-semibold tabular-nums">{event.token}</span> {event.event}
              </span>
              <span className="shrink-0 text-xs text-muted">{formatRelativeTime(event.at)}</span>
            </div>
            <span className="text-xs text-muted">{event.patientName}</span>
          </div>
        </li>
      ))}
    </ul>
  )
}
