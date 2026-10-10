import { requireRole } from '@/lib/auth/requireRole'
import { NurseSidebar } from '@/components/nurse/v3/NurseSidebar'
import { NurseMobileNav } from '@/components/nurse/v3/NurseMobileNav'
import { IdleTimeoutMonitor } from '@/components/auth/IdleTimeoutMonitor'

/**
 * Shell for the Nurse V3 screens (Figma page "05 · Nurse V3"), scoped by the (v3) route group: it wraps
 * /nurse/dashboard and later V3 routes, and deliberately NOT /nurse itself, whose own working screen
 * (app/nurse/page.tsx) keeps its own full-page layout untouched.
 *
 * The role is also re-checked in each page — a layout alone is not an authorization boundary.
 * Each page renders its own <main>, so there is exactly one per screen.
 */
export default async function NurseV3Layout({ children }: { children: React.ReactNode }) {
  const { supabase, user, staffIdleTimeoutMinutes } = await requireRole('nurse')

  const { data: profile } = await supabase
    .from('profiles')
    .select('clinic_id')
    .eq('auth_user_id', user.id)
    .single()

  let clinicName: string | null = null
  let clinicPhone: string | null = null
  if (profile?.clinic_id) {
    const { data: clinic } = await supabase.from('clinics').select('name, phone').eq('id', profile.clinic_id).maybeSingle()
    clinicName = clinic?.name ?? null
    clinicPhone = clinic?.phone ?? null
  }

  return (
    <div className="theme-nurse min-h-dvh md:flex">
      <NurseSidebar clinicName={clinicName} clinicPhone={clinicPhone} />
      <div className="min-w-0 flex-1">
        <NurseMobileNav />
        {children}
      </div>
      <IdleTimeoutMonitor timeoutMinutes={staffIdleTimeoutMinutes ?? 30} />
    </div>
  )
}
