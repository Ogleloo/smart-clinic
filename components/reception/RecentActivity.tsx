import { formatRelativeTime } from '@/lib/clinicTime'
import { EmptyState } from '@/components/ui/EmptyState'
import type { ActivityEvent } from '@/lib/receptionDashboard'

/** Read-only glance-back at the last ~10 real events today — visit history, not admin analytics moved onto this screen. */
export function RecentActivity({ events }: { events: ActivityEvent[] }) {
  if (events.length === 0) {
    return <EmptyState headline="No activity yet today" fullWidth />
  }

  return (
    <ul className="flex flex-col gap-3">
      {events.map((event) => (
        <li key={event.id} className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm text-ink">
              <span className="font-mono font-semibold tabular-nums">{event.token}</span> {event.event}
            </span>
            <span className="text-xs text-muted">{event.patientName}</span>
          </div>
          <span className="shrink-0 text-xs text-muted">{formatRelativeTime(event.at)}</span>
        </li>
      ))}
    </ul>
  )
}
