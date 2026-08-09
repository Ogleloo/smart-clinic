import Link from 'next/link'
import { QueueToken } from './QueueToken'

interface QueueSummaryCardProps {
  token: string
  otherCount?: number
  href?: string
  fullWidth?: boolean
}

/**
 * Design System: dashboard card linking to the patient's active queue
 * entry. Hugs its content by default — pass fullWidth to fill the parent.
 *
 * A patient can hold more than one active entry (consultation, then
 * pharmacy) — this surfaces the single most urgent token (in_progress,
 * if any) and just indicates there are others, rather than inventing a
 * combined position across separate queues. The full breakdown lives on
 * /queue, which is exactly what this card links to.
 */
export function QueueSummaryCard({ token, otherCount = 0, href = '/queue', fullWidth = false }: QueueSummaryCardProps) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-5 ${fullWidth ? 'w-full' : ''}`}
    >
      <div>
        <p className="text-xs font-semibold tracking-wide text-muted">YOUR QUEUE TOKEN</p>
        <div className="mt-1">
          <QueueToken token={token} size="sm" />
        </div>
        {otherCount > 0 && (
          <p className="mt-1 text-xs text-muted">
            +{otherCount} more {otherCount === 1 ? 'queue' : 'queues'} today
          </p>
        )}
      </div>
      <span className="text-sm font-semibold text-primary-700">View status →</span>
    </Link>
  )
}
