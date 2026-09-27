import type { WaitEstimate } from '@/lib/types/database.types'
import { QueueToken } from '@/components/ui/QueueToken'
import { StatusChip } from '@/components/ui/StatusChip'
import { ConfidenceChip } from '@/components/ui/ConfidenceChip'
import { toConfidenceLevel } from '@/lib/confidence'
import { WaitBreakdown } from './WaitBreakdown'

interface QueueStatusCardProps {
  estimate: WaitEstimate
  /** get_public_queue_display's now_serving_token for this entry's service — anchors "position 3" to something concrete. */
  nowServingToken: string | null
}

/**
 * V2 patient queue card (Figma "04 · Screens V2" — "Queue Status —
 * Patient V2" / "Explainability — multiple nurses"). Pure rendering of
 * a wait estimate — no queue logic here. Position, wait minutes,
 * confidence and every figure in the breakdown all come straight from
 * get_wait_estimate() (ADR-009); nothing is recomputed in React.
 */
export function QueueStatusCard({ estimate, nowServingToken }: QueueStatusCardProps) {
  const {
    status,
    queue_position,
    estimated_wait_minutes,
    confidence,
    token,
    service_name,
    patients_ahead,
    nurses_serving,
    average_minutes,
    soonest_free_minutes,
    sample_count,
  } = estimate

  const isInProgress = status === 'in_progress'
  const isNotBeingServed = status === 'not_being_served'
  const isWaiting = status === 'waiting'
  const isNext = isWaiting && queue_position === 1

  // > 0, not just !== null: a 0-minute estimate should show no number at
  // all, never "~0 min" — the honesty rule migration 0048 fixed.
  const hasWaitNumber = isWaiting && estimated_wait_minutes !== null && estimated_wait_minutes > 0

  const canShowBreakdown =
    isWaiting &&
    nurses_serving !== null &&
    nurses_serving > 0 &&
    patients_ahead !== null &&
    average_minutes !== null &&
    soonest_free_minutes !== null &&
    estimated_wait_minutes !== null

  if (isNotBeingServed) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl bg-primary-700 p-6 text-center text-white">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary-100">{service_name}</p>
        <QueueToken token={token} size="xl" tone="white" />
        <p className="text-base font-semibold">Not currently being served</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-4 rounded-2xl bg-primary-700 p-6 text-white">
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary-100">{service_name}</p>
          {isWaiting && <StatusChip status="waiting" label="Waiting" />}
          {isInProgress && <StatusChip status="in-progress" label="In progress" />}
        </div>

        <div className="text-center">
          <QueueToken token={token} size="xl" tone="white" />
        </div>

        {isInProgress ? (
          <p className="text-center text-lg font-bold">Please proceed</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-primary-600 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-primary-100">Your position</p>
              {isNext ? (
                <p className="mt-1 font-display text-xl font-bold">You&rsquo;re next</p>
              ) : (
                <>
                  <p className="mt-1 font-mono text-2xl font-bold tabular-nums">{queue_position}</p>
                  {patients_ahead !== null && (
                    <p className="text-xs text-primary-100">
                      {patients_ahead} patient{patients_ahead === 1 ? '' : 's'} ahead
                    </p>
                  )}
                </>
              )}
            </div>
            <div className="rounded-xl bg-primary-600 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-primary-100">Estimated wait</p>
              {hasWaitNumber ? (
                <>
                  <p className="mt-1 font-mono text-2xl font-bold tabular-nums">~{estimated_wait_minutes} min</p>
                  {confidence && (
                    <div className="mt-1">
                      <ConfidenceChip level={toConfidenceLevel(confidence)} sampleCount={sample_count ?? undefined} />
                    </div>
                  )}
                </>
              ) : null}
            </div>
          </div>
        )}
      </div>

      {isWaiting && nowServingToken && (
        <p className="text-sm text-muted">
          Now serving <span className="font-mono font-semibold text-ink">{nowServingToken}</span>
        </p>
      )}

      {canShowBreakdown && (
        <WaitBreakdown
          nursesServing={nurses_serving!}
          patientsAhead={patients_ahead!}
          averageMinutes={average_minutes!}
          soonestFreeMinutes={soonest_free_minutes!}
          estimatedWaitMinutes={estimated_wait_minutes!}
        />
      )}
    </div>
  )
}
