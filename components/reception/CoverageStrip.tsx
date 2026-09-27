import { ServiceCoverageCard } from '@/components/ui/ServiceCoverageCard'
import type { PublicQueueDisplay } from '@/lib/types/database.types'

interface CoverageStripProps {
  coverage: PublicQueueDisplay[]
  servingCounts: Record<string, number>
  waitingCounts: Record<string, number>
}

/**
 * Same three states, same component, as the public landing page —
 * reception sees exactly the truth a patient would see, not a
 * differently-worded version of it.
 */
export function CoverageStrip({ coverage, servingCounts, waitingCounts }: CoverageStripProps) {
  if (coverage.length === 0) {
    return <p className="text-sm text-muted">No active services.</p>
  }

  return (
    <div className="flex flex-col gap-2">
      {coverage.map((row) => (
        <ServiceCoverageCard
          key={row.service_id}
          row={row}
          servingCount={servingCounts[row.service_id] ?? 0}
          waitingCount={waitingCounts[row.service_id] ?? 0}
        />
      ))}
    </div>
  )
}
