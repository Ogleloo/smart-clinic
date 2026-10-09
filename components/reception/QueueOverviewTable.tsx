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
 * `table-fixed` with explicit column widths (instead of the previous
 * `min-w-[480px]` + horizontal scroll) is what actually fixes the desktop
 * overflow: at the Figma reference width the four columns now fit inside
 * the card without clipping or a scrollbar. Below `sm`, the table gives
 * way to a stacked card list so the same four figures stay readable on a
 * narrow screen instead of forcing a cramped, scrollable table.
 *
 * Avg. wait time only renders when the service is actively being served —
 * same rule ServiceCoverageCard already follows: no nurse on duty means no
 * estimate, never a fallback or a guess.
 */
export function QueueOverviewTable({ coverage, servingCounts, waitingCounts }: QueueOverviewTableProps) {
  return (
    <section className="flex h-full flex-col gap-4 rounded-xl border border-border bg-surface p-5 shadow-[0_8px_18px_rgba(0,31,33,0.05)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary-50 text-primary-700">
            <Users size={22} aria-hidden />
          </span>
          <div>
            <h2 className="font-display text-[22px] font-semibold text-ink">Queue Overview</h2>
            <p className="text-base text-muted">Live view of patients across services.</p>
          </div>
        </div>
        <LinkButton href="/reception/queue" variant="secondary">
          View queue →
        </LinkButton>
      </div>

      {coverage.length === 0 ? (
        <EmptyState headline="No active services" fullWidth />
      ) : (
        <>
          {/* Desktop/tablet: the Figma table, columns fixed so nothing overflows or gets clipped. */}
          <table className="hidden w-full table-fixed border-collapse text-left sm:table">
            <colgroup>
              <col className="w-[42%]" />
              <col className="w-[16%]" />
              <col className="w-[20%]" />
              <col className="w-[22%]" />
            </colgroup>
            <thead>
              <tr className="h-11 bg-subtle text-xs font-semibold text-ink">
                <th className="pl-3 font-semibold">Service</th>
                <th className="px-3 font-semibold">Waiting</th>
                <th className="px-3 font-semibold">In Consultation</th>
                <th className="pr-3 font-semibold">Avg. wait time</th>
              </tr>
            </thead>
            <tbody>
              {coverage.map((row) => {
                const waiting = waitingCounts[row.service_id] ?? row.waiting_count
                const serving = servingCounts[row.service_id] ?? 0
                return (
                  <tr key={row.service_id} className="h-[70px] border-b border-border align-middle last:border-0">
                    <td className="truncate pl-3 pr-2 text-[13px] font-medium text-ink">{row.service_name}</td>
                    <td className="px-3 text-[13px] font-semibold tabular-nums text-danger">{waiting}</td>
                    <td className="px-3 text-[13px] tabular-nums text-ink">{serving}</td>
                    <td className="pl-3 pr-3 text-[13px] tabular-nums text-ink">
                      {row.is_being_served ? `~ ${row.estimated_wait_minutes} min` : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {/* Mobile: a 4-column table doesn't fit at 390px without clipping a column, so this is a stacked
              equivalent carrying the same figures, not a cut-down version of them. */}
          <ul className="flex flex-col gap-3 sm:hidden">
            {coverage.map((row) => {
              const waiting = waitingCounts[row.service_id] ?? row.waiting_count
              const serving = servingCounts[row.service_id] ?? 0
              return (
                <li key={row.service_id} className="rounded-lg border border-border p-3">
                  <p className="text-sm font-semibold text-ink">{row.service_name}</p>
                  <dl className="mt-2 grid grid-cols-3 gap-2 text-xs text-muted">
                    <div>
                      <dt>Waiting</dt>
                      <dd className="text-sm font-semibold tabular-nums text-danger">{waiting}</dd>
                    </div>
                    <div>
                      <dt>In Consultation</dt>
                      <dd className="text-sm tabular-nums text-ink">{serving}</dd>
                    </div>
                    <div>
                      <dt>Avg. wait</dt>
                      <dd className="text-sm tabular-nums text-ink">
                        {row.is_being_served ? `~ ${row.estimated_wait_minutes} min` : '—'}
                      </dd>
                    </div>
                  </dl>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </section>
  )
}
