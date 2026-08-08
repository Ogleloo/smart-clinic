import { createClient } from '@/lib/supabase/server'
import { NewServiceForm } from '@/components/admin/NewServiceForm'
import { ServiceRow } from '@/components/admin/ServiceRow'

/**
 * Deactivate, never delete: services are referenced by historical
 * queue_entries and consultations. Deleting one would orphan that
 * history (and break every report on this clinic's past). is_active
 * just hides it from booking and walk-in going forward.
 */
export default async function AdminServicesPage() {
  const supabase = await createClient()
  const { data: services, error } = await supabase.from('services').select('*').order('name')

  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-display text-lg font-semibold text-ink">Services</h2>

      {error ? (
        <p className="text-sm text-danger">Couldn&rsquo;t load services. Try refreshing.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {(services ?? []).map((service) => (
            <ServiceRow key={service.id} service={service} />
          ))}
        </div>
      )}

      <NewServiceForm />
    </div>
  )
}
