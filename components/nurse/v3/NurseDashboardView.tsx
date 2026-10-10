import type { NurseDashboardData } from '@/lib/nurseDashboard'
import { NurseDashboardHero } from './NurseDashboardHero'
import { NurseStatCards } from './NurseStatCards'
import { TodaysQueuePanel } from './TodaysQueuePanel'
import { RecentActivityPanel } from './RecentActivityPanel'

/**
 * Presentational only: everything it shows comes in as `data`, which is what lets each duty and failure
 * state be rendered and checked without touching the shared database.
 *
 * Geometry follows Figma frame 161:3 at 1440: content column 1176px, 24px side padding, four 270px cards
 * 16px apart, then a flexible queue panel (730px) beside a 380px activity panel 18px apart. Below xl (1280)
 * the cards go 2-up and the panels stack, so nothing needs horizontal scrolling.
 */
export function NurseDashboardView({ data }: { data: NurseDashboardData }) {
  return (
    <main className="mx-auto flex w-full max-w-[1176px] flex-col gap-6 px-4 py-6 sm:px-6">
      <NurseDashboardHero
        fullName={data.nurse.fullName}
        clinicName={data.nurse.clinicName}
        isOnDuty={data.nurse.isOnDuty}
        serviceName={data.nurse.serviceName}
      />
      <NurseStatCards data={data} />
      <div className="flex flex-col gap-[18px] xl:flex-row xl:items-stretch">
        <div className="min-w-0 xl:flex-1">
          <TodaysQueuePanel data={data} />
        </div>
        <div className="xl:w-[380px] xl:shrink-0">
          <RecentActivityPanel events={data.activity} error={data.errors.activity} />
        </div>
      </div>
    </main>
  )
}
