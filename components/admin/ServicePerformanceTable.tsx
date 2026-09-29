import { ConfidenceChip } from '@/components/ui/ConfidenceChip'
import type { ServicePerformanceRow } from '@/lib/adminDashboard'

/** "Where is the problem", in detail — one row per active service. Uncovered rows are amber with "No estimate", never a number (never state a wait the system can't justify). */
export function ServicePerformanceTable({ rows }: { rows: ServicePerformanceRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted">No active services.</p>
  }

  return (
    <div className="flex flex-col gap-2">
      {rows.map((row) => (
        <div
          key={row.serviceId}
          className={`flex flex-col gap-2 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between ${
            row.isBeingServed ? 'border-border bg-surface' : 'border-warning bg-warning-bg'
          }`}
        >
          <div>
            <p className="font-semibold text-ink">{row.serviceName}</p>
            <p className="text-sm text-muted">
              {row.waitingCount} waiting · {row.nursesOnDuty} {row.nursesOnDuty === 1 ? 'nurse' : 'nurses'}
            </p>
          </div>

          <div className="flex items-center gap-4">
            {row.isBeingServed ? (
              <>
                <p className="font-mono text-lg font-semibold tabular-nums text-ink">
                  {row.estimatedWaitMinutes === null ? 'No wait' : `~${row.estimatedWaitMinutes} min`}
                </p>
                <p className="text-xs text-muted">
                  {row.sampleCount} sample{row.sampleCount === 1 ? '' : 's'}
                </p>
                <ConfidenceChip level={row.confidence} sampleCount={row.sampleCount} />
              </>
            ) : (
              <p className="text-sm font-semibold text-warning">No estimate</p>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
