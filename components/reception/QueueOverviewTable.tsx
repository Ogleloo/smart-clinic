import { Users } from 'lucide-react'
import { LinkButton } from '@/components/ui/LinkButton'
import { EmptyState } from '@/components/ui/EmptyState'
import type { PublicQueueDisplay } from '@/lib/types/database.types'

interface QueueOverviewTableProps {
  coverage: PublicQueueDisplay[]
  servingCounts: Record<string, number>
  waitingCounts: Record<string, number>
}

/**
 * Figma frame 111:2 "Queue-Overview". A table, unlike the card-based
 * ServiceCoverageCard the public landing page and V2 dashboard share —
 * that component stays untouched (still used elsewhere) and this reads
 * the same `coverage` rows directly instead of wrapping it.
 *
 * Avg. wait time only renders when the service is actively being served —
 * same rule ServiceCoverageCard already follows: no nurse on duty means no
 * estimate, never a fallback or a guess.
 */
export function QueueOverviewTable({ coverage, servingCounts, waitingCounts }: QueueOverviewTableProps) {
  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-50 text-primary-700">
            <Users size={18} aria-hidden />
          </span>
          <div>
            <h2 className="font-display text-base font-semibold text-ink">Queue Overview</h2>
            <p className="text-xs text-muted">Live view of patients across services.</p>
          </div>
        </div>
        <LinkButton href="/reception/queue" variant="tertiary">
          View queue →
        </LinkButton>
      </div>

      {coverage.length === 0 ? (
        <EmptyState headline="No active services" fullWidth />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] border-collapse text-left">
            <thead>
              <tr className="border-b border-border text-xs font-semibold text-muted">
                <th className="py-2 pr-3 font-semibold">Service</th>
                <th className="py-2 px-3 font-semibold">Waiting</th>
                <th className="py-2 px-3 font-semibold">In Consultation</th>
                <th className="py-2 pl-3 font-semibold">Avg. wait time</th>
              </tr>
            </thead>
            <tbody>
              {coverage.map((row) => {
                const waiting = waitingCounts[row.service_id] ?? row.waiting_count
                const serving = servingCounts[row.service_id] ?? 0
                return (
                  <tr key={row.service_id} className="border-b border-border last:border-0">
                    <td className="py-3 pr-3 text-sm font-medium text-ink">{row.service_name}</td>
                    <td className="py-3 px-3 text-sm font-semibold tabular-nums text-danger">{waiting}</td>
                    <td className="py-3 px-3 text-sm tabular-nums text-ink">{serving}</td>
                    <td className="py-3 pl-3 text-sm tabular-nums text-ink">
                      {row.is_being_served ? `~ ${row.estimated_wait_minutes} min` : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
