import Link from 'next/link'
import { QueueToken } from './QueueToken'

interface QueueSummaryCardProps {
  token: string
  href?: string
  fullWidth?: boolean
}

/** Design System: dashboard card linking to the patient's active queue entry. Hugs its content by default — pass fullWidth to fill the parent. */
export function QueueSummaryCard({ token, href = '/queue', fullWidth = false }: QueueSummaryCardProps) {
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
      </div>
      <span className="text-sm font-semibold text-primary-700">View status →</span>
    </Link>
  )
}
