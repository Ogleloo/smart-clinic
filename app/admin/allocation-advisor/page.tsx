import { requireRole } from '@/lib/auth/requireRole'
import { getAdminDashboardData } from '@/lib/adminDashboard'
import { AllocationAdvisorView } from '@/components/admin/v3/AllocationAdvisorView'

export const metadata = { title: 'Allocation Advisor · Smart Clinic' }

/**
 * Read-only research page. The Admin layout guard is rechecked here.
 * Reuses exactly the existing Admin aggregate loader; no patient names,
 * raw queue rows, identity information or individual nurse profiles are
 * sent to the client. The simulation uses synthetic scenarios only.
 */
export default async function AllocationAdvisorPage() {
  const { supabase } = await requireRole('admin')
  const data = await getAdminDashboardData(supabase)
  return (
    <AllocationAdvisorView
      liveServices={data.services.map((row) => ({
        serviceId: row.serviceId,
        serviceName: row.serviceName,
        waitingCount: row.waitingCount,
        nursesOnDuty: row.nursesOnDuty,
        estimatedWaitMinutes: row.estimatedWaitMinutes,
        isBeingServed: row.isBeingServed,
      }))}
      errors={{ services: data.errors.services, coverage: data.errors.coverage, perService: data.errors.perService }}
    />
  )
}
