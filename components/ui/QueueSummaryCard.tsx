import Link from 'next/link'
import type { WaitEstimate } from '@/lib/types/database.types'
import { QueueToken } from './QueueToken'
import { ConfidenceChip, toConfidenceLevel } from './ConfidenceChip'

interface QueueSummaryCardProps {
  estimate: WaitEstimate
  otherCount?: number
  href?: string
  fullWidth?: boolean
}

/**
 * Design System: dashboard card linking to the patient's active queue
 * entry. Hugs its content by default — pass fullWidth to fill the parent.
 *
 * A patient can hold more than one active entry (consultation, then
 * pharmacy) — this surfaces the single most urgent estimate (in_progress,
 * if any) and just indicates there are others, rather than inventing a
 * combined position across separate queues. The full breakdown lives on
 * /queue, which is exactly what this card links to.
 *
 * Same status flags QueueStatusCard uses (get_wait_estimate is the one
 * source of truth for all of position/estimate/confidence/status —
 * ADR-009), fed by the same getActiveQueueEntries() call /queue uses —
 * this is what regressed once already when the two drifted apart.
 */
export function QueueSummaryCard({ estimate, otherCount = 0, href = '/queue', fullWidth = false }: QueueSummaryCardProps) {
  const { token, status, queue_position, estimated_wait_minutes, confidence } = estimate

  const isInProgress = status === 'in_progress'
  const isNotBeingServed = status === 'not_being_served'
  const isNext = status === 'waiting' && queue_position === 1
  const hasEstimate = status === 'waiting' && estimated_wait_minutes !== null && estimated_wait_minutes > 0

  return (
    <Link
      href={href}
      className={`inline-flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-5 ${fullWidth ? 'w-full' : ''}`}
    >
      <div>
        <p className="text-xs font-semibold tracking-wide text-muted">YOUR QUEUE TOKEN</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <QueueToken token={token} size="sm" />
          {isInProgress ? (
            <span className="text-sm font-semibold text-primary-700">Now being served</span>
          ) : isNext ? (
            <span className="text-sm font-semibold text-primary-700">You&rsquo;re next</span>
          ) : isNotBeingServed ? (
            <span className="text-sm text-muted">
              Position {queue_position} · Not currently being served
            </span>
          ) : hasEstimate ? (
            <>
              <span className="text-sm text-ink">
                Position {queue_position} · About {estimated_wait_minutes} min
              </span>
              {confidence && <ConfidenceChip level={toConfidenceLevel(confidence)} />}
            </>
          ) : status === 'waiting' ? (
            <span className="text-sm text-ink">Position {queue_position}</span>
          ) : null}
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
