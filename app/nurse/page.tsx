import { requireRole } from '@/lib/auth/requireRole'
import { todayInClinicTimezone } from '@/lib/clinicTime'
import { DutyControl } from '@/components/nurse/DutyControl'
import { CurrentPatientPanel } from '@/components/nurse/CurrentPatientPanel'
import { WaitingList } from '@/components/nurse/WaitingList'
import { LogoutButton } from '@/components/ui/LogoutButton'
import type { Database } from '@/lib/types/database.types'

type QueueRow = Database['public']['Functions']['get_service_queue']['Returns'][number]

/**
 * Nurse working screen (Slice 5).
 *
 * queue_entries has no nurse_id column — only consultations does. A
 * "called" patient (call_next_patient sets status='in_progress'
 * immediately, before any consultation exists) can't be attributed to a
 * specific nurse until start_consultation creates that row. This app's
 * fixture data and RPC design (call_next_patient takes no service_id;
 * it's implied by the caller's own current_service_id) both assume one
 * active nurse workflow per service at a time, so "the in_progress
 * entry for my current_service_id" is treated as "mine" for recovering
 * state across a page reload. A real multi-nurse-per-service deployment
 * would need the backend to record who called each entry, which is out
 * of scope (backend is frozen this slice).
 */
export default async function NursePage() {
  const { supabase, user } = await requireRole('nurse')

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, is_on_duty, current_service_id')
    .eq('auth_user_id', user.id)
    .single()

  const { data: services } = await supabase
    .from('services')
    .select('id, name')
    .eq('is_active', true)
    .order('name')

  let currentEntry: { id: string; token: string; patientName: string } | null = null
  let currentStartedAt: string | null = null
  let initialQueue: QueueRow[] = []

  const onDuty = profile?.is_on_duty && profile.current_service_id
  if (onDuty) {
    const today = todayInClinicTimezone()
    const serviceId = profile.current_service_id as string

    const { data: inProgress } = await supabase
      .from('queue_entries')
      .select('id, token, patient:profiles!queue_entries_patient_id_fkey(full_name)')
      .eq('service_id', serviceId)
      .eq('status', 'in_progress')
      .eq('queue_date', today)
      .order('called_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (inProgress) {
      currentEntry = {
        id: inProgress.id,
        token: inProgress.token,
        patientName: inProgress.patient?.full_name ?? 'Unknown patient',
      }

      const { data: activeConsultation } = await supabase
        .from('consultations')
        .select('started_at')
        .eq('queue_entry_id', inProgress.id)
        .is('ended_at', null)
        .maybeSingle()

      currentStartedAt = activeConsultation?.started_at ?? null
    }

    const { data: queueRows } = await supabase.rpc('get_service_queue', { p_service_id: serviceId })
    initialQueue = queueRows ?? []
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-[820px] flex-col gap-6 px-6 py-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-ink">
          Nurse{profile?.full_name ? ` — ${profile.full_name}` : ''}
        </h1>
        <LogoutButton />
      </div>

      <DutyControl
        services={services ?? []}
        isOnDuty={profile?.is_on_duty ?? false}
        currentServiceId={profile?.current_service_id ?? null}
      />

      {onDuty ? (
        <>
          <CurrentPatientPanel initialEntry={currentEntry} initialStartedAt={currentStartedAt} />
          <WaitingList serviceId={profile.current_service_id as string} initialQueue={initialQueue} />
        </>
      ) : (
        <p className="text-sm text-muted">Go on duty to see your current patient and the waiting list.</p>
      )}
    </main>
  )
}
