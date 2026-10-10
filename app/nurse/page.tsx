import { requireRole } from '@/lib/auth/requireRole'
import { getNurseCurrentState } from '@/app/actions/nurse'
import { getSeenTodayStats } from '@/lib/nurseStats'
import { NurseHeader } from '@/components/nurse/NurseHeader'
import { EndSessionControl } from '@/components/nurse/EndSessionControl'
import { CoverageWarning } from '@/components/nurse/CoverageWarning'
import { CurrentPatientPanel } from '@/components/nurse/CurrentPatientPanel'
import { WaitingList } from '@/components/nurse/WaitingList'
import { LogoutButton } from '@/components/ui/LogoutButton'
import { IdleTimeoutMonitor } from '@/components/auth/IdleTimeoutMonitor'
import type { Database } from '@/lib/types/database.types'

type QueueRow = Database['public']['Functions']['get_service_queue']['Returns'][number]

const DEFAULT_UNDO_WINDOW_SECONDS = 60

/**
 * Nurse working screen.
 *
 * The single-action workflow (next_patient/undo_next_patient/end_shift,
 * migrations 0028-0031) replaced the old call/start/end three-button
 * flow. "Current patient" is read directly off an open consultations
 * row for this nurse — never inferred from queue_entries.status alone
 * (which no longer distinguishes "called" from "consultation running":
 * next_patient sets both atomically) and never by calling next_patient
 * on mount. A crash mid-shift (browser closed, page reloaded) just
 * means this same read finds the still-open consultation and displays
 * it — no auto-advance.
 */
export default async function NursePage() {
  const { supabase, user, staffIdleTimeoutMinutes } = await requireRole('nurse')

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, full_name, is_on_duty, current_service_id, clinic_id')
    .eq('auth_user_id', user.id)
    .single()

  const { data: services } = await supabase
    .from('services')
    .select('id, name')
    .eq('is_active', true)
    .order('name')

  const [{ entry: currentEntry, error: currentError }, { data: settings }] = await Promise.all([
    getNurseCurrentState(),
    profile?.clinic_id
      ? supabase
          .from('clinic_settings')
          .select('undo_window_seconds')
          .eq('clinic_id', profile.clinic_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  let initialQueue: QueueRow[] = []
  let serviceAverageMinutes: number | null = null
  let seenToday: { count: number; avgMinutes: number | null } = { count: 0, avgMinutes: null }
  const onDuty = profile?.is_on_duty && profile.current_service_id
  if (onDuty) {
    const serviceId = profile.current_service_id as string
    const [{ data: queueRows }, { data: stats }, seen] = await Promise.all([
      supabase.rpc('get_service_queue', { p_service_id: serviceId }),
      supabase.rpc('service_consultation_stats', { p_service_id: serviceId }).maybeSingle(),
      getSeenTodayStats(supabase, profile!.id),
    ])
    initialQueue = queueRows ?? []
    serviceAverageMinutes = stats?.avg_minutes ?? null
    seenToday = seen
  }

  const initialNextToken = initialQueue.find((r) => r.status === 'waiting')?.token ?? null
  const currentServiceName = services?.find((s) => s.id === profile?.current_service_id)?.name ?? null

  return (
    <main className="mx-auto flex min-h-dvh max-w-[1000px] flex-col gap-6 px-6 py-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-ink">
          Nurse{profile?.full_name ? ` — ${profile.full_name}` : ''}
        </h1>
        <LogoutButton />
      </div>

      <NurseHeader
        services={services ?? []}
        isOnDuty={profile?.is_on_duty ?? false}
        currentServiceId={profile?.current_service_id ?? null}
        currentServiceName={currentServiceName}
        // Mounted unconditionally (not inside the onDuty branch below) so
        // its "Session ended" report survives is_on_duty flipping to
        // false — see EndSessionControl's own docs for why.
        endSession={
          <EndSessionControl
            isOnDuty={profile?.is_on_duty ?? false}
            currentServiceId={profile?.current_service_id ?? null}
          />
        }
      />

      {onDuty ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[3fr_2fr]">
          <div className="flex flex-col gap-4">
            <CoverageWarning serviceId={profile.current_service_id as string} />
            <CurrentPatientPanel
              initialEntry={currentEntry}
              serviceId={profile.current_service_id as string}
              undoWindowSeconds={settings?.undo_window_seconds ?? DEFAULT_UNDO_WINDOW_SECONDS}
              serviceAverageMinutes={serviceAverageMinutes}
              initialNextToken={initialNextToken}
              // A failed read must not look like "no patient": the panel starts with Next patient paused.
              initialStateError={currentError ?? null}
            />
          </div>
          <WaitingList
            serviceId={profile.current_service_id as string}
            initialQueue={initialQueue}
            seenToday={seenToday}
          />
        </div>
      ) : (
        <p className="text-sm text-muted">Go on duty to see your current patient and the waiting list.</p>
      )}

      <IdleTimeoutMonitor timeoutMinutes={staffIdleTimeoutMinutes ?? 30} />
    </main>
  )
}
