import { createClient } from '@/lib/supabase/server'
import { ServiceQueuePanel } from '@/components/reception/ServiceQueuePanel'
import { EmptyState } from '@/components/ui/EmptyState'

export default async function ReceptionQueuePage() {
  const supabase = await createClient()

  const { data: services, error } = await supabase
    .from('services')
    .select('id, name')
    .eq('is_active', true)
    .order('name')

  if (error) {
    return <p className="text-sm text-danger">Couldn&rsquo;t load services. Try refreshing.</p>
  }
  if (!services || services.length === 0) {
    return <EmptyState headline="No active services" fullWidth />
  }

  // Initial data fetched server-side per service so the panels render
  // with real data immediately; each panel then subscribes client-side
  // for live updates (ADR-010: RLS scopes this, no clinic_id filter).
  const panels = await Promise.all(
    services.map(async (service) => {
      const { data } = await supabase.rpc('get_service_queue', { p_service_id: service.id })
      return { service, queue: data ?? [] }
    })
  )

  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-display text-lg font-semibold text-ink">Queue</h2>
      {panels.map(({ service, queue }) => (
        <ServiceQueuePanel
          key={service.id}
          serviceId={service.id}
          serviceName={service.name}
          initialQueue={queue}
        />
      ))}
    </div>
  )
}
