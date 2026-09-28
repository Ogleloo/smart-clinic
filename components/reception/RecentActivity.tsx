import { formatRelativeTime } from '@/lib/clinicTime'
import { EmptyState } from '@/components/ui/EmptyState'
import type { ActivityEvent } from '@/lib/receptionDashboard'

/** Read-only glance-back at the last ~10 real events today — visit history, not admin analytics moved onto this screen. */
export function RecentActivity({ events }: { events: ActivityEvent[] }) {
  if (events.length === 0) {
    return <EmptyState headline="No activity yet today" fullWidth />
  }

  return (
    <ul className="flex flex-col gap-2">
      {events.map((event) => (
        <li
          key={event.id}
          className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-2.5"
        >
          <div className="flex items-center gap-2.5">
            <span className="font-mono text-sm font-semibold tabular-nums text-ink">{event.token}</span>
            <span className="text-sm text-ink">{event.event}</span>
          </div>
          <span className="shrink-0 text-xs text-muted">{formatRelativeTime(event.at)}</span>
        </li>
      ))}
    </ul>
  )
}
