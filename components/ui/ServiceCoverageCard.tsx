import type { PublicQueueDisplay } from '@/lib/types/database.types'
import { coverageVariant, COVERAGE_CARD_STYLES } from '@/lib/queueCoverage'

interface ServiceCoverageCardProps {
  row: PublicQueueDisplay
  /**
   * Reception computes its own serving/waiting counts from the same
   * live queue_entries snapshot the rest of its dashboard reads, so
   * every number on screen agrees exactly — pass both together to
   * override row's own waiting_count. The public landing page has
   * only the RPC's own count and no serving figure, so it omits both.
   */
  servingCount?: number
  waitingCount?: number
}

/** Design System: per-service coverage card. Shared by the public landing page and the reception dashboard (same three states, same tokens) so patients and reception are looking at exactly the same truth. */
export function ServiceCoverageCard({ row, servingCount, waitingCount }: ServiceCoverageCardProps) {
  const variant = coverageVariant(row)
  const waiting = waitingCount ?? row.waiting_count

  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-lg px-4 py-3 ${COVERAGE_CARD_STYLES[variant]}`}
    >
      <div>
        <p className="font-semibold text-ink">{row.service_name}</p>
        <p className="text-sm text-muted">
          {servingCount !== undefined && `${servingCount} serving · `}
          {waiting} waiting
        </p>
      </div>
      {variant === 'active' ? (
        waiting > 0 ? (
          <p className="shrink-0 font-mono text-lg font-semibold tabular-nums text-primary-700">
            ~{row.estimated_wait_minutes} min
          </p>
        ) : (
          <div className="shrink-0 text-right">
            <p className="font-semibold text-primary-700">No wait</p>
            <p className="text-xs text-muted">walk straight in</p>
          </div>
        )
      ) : variant === 'warning' ? (
        <p className="shrink-0 text-sm font-semibold text-warning">Not currently being served</p>
      ) : (
        <p className="shrink-0 text-sm font-semibold text-muted">Closed today</p>
      )}
    </div>
  )
}
