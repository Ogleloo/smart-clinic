import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { QueueHeader } from '@/components/reception/QueueHeader'
import { QueueManagementView } from '@/components/reception/QueueManagementView'
import { EmptyState } from '@/components/ui/EmptyState'

/**
 * Reception V3 Phase 3 — Queue Management (Figma frame 114:736). Initial
 * data is fetched here, per service, same as the V2 page did; each service
 * then subscribes client-side for live updates (QueueManagementView /
 * ServiceQueueSync), same mechanism the V2 panels already used.
 */
export default async function ReceptionQueuePage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: profile }, { data: services, error: servicesError }] = await Promise.all([
    supabase.from('profiles').select('full_name, clinic_id').eq('auth_user_id', user.id).single(),
    supabase.from('services').select('id, name').eq('is_active', true).order('name'),
  ])

  const clinicName = profile?.clinic_id
    ? (await supabase.from('clinics').select('name').eq('id', profile.clinic_id).maybeSingle()).data?.name ?? null
    : null

  const mainClass = 'mx-auto flex w-full max-w-[1176px] flex-col gap-5 px-4 py-6 md:px-8 md:py-7'

  if (servicesError) {
    return (
      <main className={mainClass}>
        <p className="text-sm text-danger">Couldn&rsquo;t load services. Try refreshing.</p>
      </main>
    )
  }

  if (!services || services.length === 0) {
    return (
      <main className={mainClass}>
        <QueueHeader fullName={profile?.full_name ?? 'Receptionist'} clinicName={clinicName} />
        <EmptyState headline="No active services" fullWidth />
      </main>
    )
  }

  const initialQueues = Object.fromEntries(
    await Promise.all(
      services.map(async (service) => {
        const { data } = await supabase.rpc('get_service_queue', { p_service_id: service.id })
        return [service.id, data ?? []] as const
      })
    )
  )

  return (
    <main className={mainClass}>
      <QueueHeader fullName={profile?.full_name ?? 'Receptionist'} clinicName={clinicName} />
      <QueueManagementView services={services} initialQueues={initialQueues} />
    </main>
  )
}
