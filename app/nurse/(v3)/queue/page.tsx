import Link from 'next/link'
import { requireRole } from '@/lib/auth/requireRole'
import { getNurseCurrentState } from '@/app/actions/nurse'
import { loadQueueSnapshot } from '@/lib/nurseQueue'
import { MyQueueView, type MyQueueViewProps } from '@/components/nurse/v3/MyQueueView'
import { NURSE_WORKSPACE_HREF } from '@/components/nurse/v3/navItems'

export const metadata = { title: 'My Queue · Smart Clinic' }

const DEFAULT_UNDO_WINDOW_SECONDS = 60

/**
 * Nurse V3 My Queue (Figma frame 161:170), Phase 2. Loading is read-only; every change goes through the
 * existing nurse Server Actions (next_patient, undo_next_patient, set_emergency_priority, set_duty,
 * end_shift) from the client, exactly as on the working screen at /nurse, which stays available.
 *
 * Like /nurse, the current consultation is read off the nurse's open consultations row on every load — a reload
 * mid-consultation shows it again; nothing is called on mount.
 *
 * requireRole runs outside the try block on purpose: its redirect is thrown, and a catch would swallow it.
 */
export default async function NurseQueuePage() {
  const { supabase, user } = await requireRole('nurse')

  let props: MyQueueViewProps
  try {
    props = await loadMyQueue(supabase, user.id)
  } catch {
    return (
      <main className="mx-auto flex w-full max-w-[1176px] flex-col gap-4 px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
        <h1 className="font-display text-[40px] font-bold leading-[44px] text-ink">My Queue</h1>
        <p role="alert" className="rounded-md border border-border bg-danger-bg p-4 text-sm font-semibold text-[#B42318]">
          We couldn’t load your queue. Reload the page to try again.
        </p>
        <p className="text-sm text-muted">
          The classic screen is still available:{' '}
          <Link href={NURSE_WORKSPACE_HREF} className="font-semibold text-[#037F74] underline underline-offset-2">
            open the classic nurse screen
          </Link>
          .
        </p>
      </main>
    )
  }

  return <MyQueueView {...props} />
}

type ServerClient = Awaited<ReturnType<typeof requireRole>>['supabase']

async function loadMyQueue(supabase: ServerClient, authUserId: string): Promise<MyQueueViewProps> {
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, full_name, is_on_duty, current_service_id, clinic_id')
    .eq('auth_user_id', authUserId)
    .single()
  if (profileError || !profile) throw new Error('Could not load your profile.')

  const clinicId = profile.clinic_id
  const serviceId = profile.current_service_id
  const scoped = !!profile.is_on_duty && !!serviceId

  const [clinicRes, servicesRes, settingsRes, current, snapshot, statsRes] = await Promise.all([
    clinicId ? supabase.from('clinics').select('name').eq('id', clinicId).maybeSingle() : Promise.resolve({ data: null }),
    clinicId
      ? supabase.from('services').select('id, name, is_active').eq('clinic_id', clinicId).order('name')
      : Promise.resolve({ data: [] as { id: string; name: string; is_active: boolean }[] }),
    clinicId
      ? supabase.from('clinic_settings').select('undo_window_seconds').eq('clinic_id', clinicId).maybeSingle()
      : Promise.resolve({ data: null }),
    getNurseCurrentState(),
    loadQueueSnapshot(supabase, { nurseProfileId: profile.id, serviceId: scoped ? serviceId : null }),
    scoped ? supabase.rpc('service_consultation_stats', { p_service_id: serviceId! }).maybeSingle() : Promise.resolve(null),
  ])

  const allServices = servicesRes.data ?? []
  const serviceNames = Object.fromEntries(allServices.map((s) => [s.id, s.name]))
  const activeServices = allServices.filter((s) => s.is_active).map(({ id, name }) => ({ id, name }))

  return {
    nurse: {
      profileId: profile.id,
      fullName: profile.full_name,
      clinicName: clinicRes.data?.name ?? null,
      isOnDuty: !!profile.is_on_duty,
      serviceId,
      serviceName: serviceId ? (serviceNames[serviceId] ?? null) : null,
    },
    services: activeServices,
    serviceNames,
    initialSnapshot: snapshot,
    initialEntry: current.entry,
    currentError: current.error,
    undoWindowSeconds: settingsRes.data?.undo_window_seconds ?? DEFAULT_UNDO_WINDOW_SECONDS,
    serviceAverageMinutes: statsRes && !statsRes.error ? (statsRes.data?.avg_minutes ?? null) : null,
  }
}
