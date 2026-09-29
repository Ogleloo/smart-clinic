import { createClient } from '@/lib/supabase/server'
import { getAdminDashboardData } from '@/lib/adminDashboard'
import { ClinicStateStrip } from '@/components/admin/ClinicStateStrip'
import { NeedsAttentionPanel } from '@/components/admin/NeedsAttentionPanel'
import { ServicePerformanceTable } from '@/components/admin/ServicePerformanceTable'
import { PredictionQualityPanel } from '@/components/admin/PredictionQualityPanel'

/**
 * V2 admin dashboard — control and observability, in the order a
 * question actually gets asked: what is happening now (the state
 * strip), where is the problem (needs-attention, then the per-service
 * table), can I trust the estimates (prediction quality). Staff,
 * services and settings stay behind their own nav links, unchanged —
 * this screen is read-only observability, not another place to edit
 * configuration.
 */
export default async function AdminOverviewPage() {
  const supabase = await createClient()
  const data = await getAdminDashboardData(supabase)

  return (
    <div className="flex flex-col gap-6">
      <ClinicStateStrip stats={data.clinicState} />
      <NeedsAttentionPanel alerts={data.attentionAlerts} />

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-base font-semibold text-ink">Service performance</h2>
        <ServicePerformanceTable rows={data.services} />
      </section>

      <PredictionQualityPanel stats={data.predictionQuality} />
    </div>
  )
}
