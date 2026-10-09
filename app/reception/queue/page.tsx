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

  const wrapperClass = 'mx-auto flex min-h-dvh max-w-[820px] flex-col gap-4 px-6 py-6'

  if (error) {
    return (
      <main className={wrapperClass}>
        <p className="text-sm text-danger">Couldn&rsquo;t load services. Try refreshing.</p>
      </main>
    )
  }
  if (!services || services.length === 0) {
    return (
      <main className={wrapperClass}>
        <EmptyState headline="No active services" fullWidth />
      </main>
    )
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
    <main className={wrapperClass}>
      <h2 className="font-display text-lg font-semibold text-ink">Queue</h2>
      {panels.map(({ service, queue }) => (
        <ServiceQueuePanel
          key={service.id}
          serviceId={service.id}
          serviceName={service.name}
          initialQueue={queue}
        />
      ))}
    </main>
  )
}
