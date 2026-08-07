import type { WaitEstimate } from '@/lib/types/database.types'
import { QueueToken } from '@/components/ui/QueueToken'
import { ConfidenceChip, toConfidenceLevel } from '@/components/ui/ConfidenceChip'

function ordinal(n: number): string {
  const last = n % 10
  const lastTwo = n % 100
  if (last === 1 && lastTwo !== 11) return `${n}st`
  if (last === 2 && lastTwo !== 12) return `${n}nd`
  if (last === 3 && lastTwo !== 13) return `${n}rd`
  return `${n}th`
}

/**
 * Composes the shared QueueToken/ConfidenceChip primitives into the full
 * queue-status card. Pure rendering of a wait estimate — no queue logic
 * here. Position, wait minutes and confidence all come straight from
 * get_wait_estimate() (ADR-009).
 */
export function QueueStatusCard({ estimate }: { estimate: WaitEstimate }) {
  const { status, queue_position, estimated_wait_minutes, confidence, token, service_name } =
    estimate

  const isInProgress = status === 'in_progress'
  const isNotBeingServed = status === 'not_being_served'
  const isNext = status === 'waiting' && queue_position === 1

  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-surface p-6 text-center">
      <p className="text-xs font-semibold tracking-wide text-muted">{service_name}</p>
      <QueueToken token={token} size="lg" />

      {isInProgress ? (
        <p className="text-lg font-bold text-primary-700">Please proceed</p>
      ) : isNext ? (
        <p className="text-lg font-bold text-primary-700">You&rsquo;re next</p>
      ) : status === 'waiting' ? (
        <p className="text-base font-semibold text-ink">
          You are {ordinal(queue_position)} in line
        </p>
      ) : null}

      {isInProgress ? null : isNotBeingServed ? (
        <p className="text-sm text-muted">Not currently being served</p>
      ) : (
        estimated_wait_minutes !== null && (
          <div className="flex items-center gap-2">
            <span className="font-mono text-2xl font-semibold tabular-nums text-ink">
              ~{estimated_wait_minutes} min
            </span>
            {confidence && <ConfidenceChip level={toConfidenceLevel(confidence)} />}
          </div>
        )
      )}
    </div>
  )
}
