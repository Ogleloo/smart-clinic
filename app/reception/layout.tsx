import { requireRole } from '@/lib/auth/requireRole'
import { ReceptionSidebar } from '@/components/reception/ReceptionSidebar'
import { ReceptionMobileNav } from '@/components/reception/ReceptionMobileNav'
import { IdleTimeoutMonitor } from '@/components/auth/IdleTimeoutMonitor'

/**
 * Shared shell for every reception V3 screen (Figma page "04 · Reception
 * V3"). Desktop-first (1440 reference) — persistent sidebar from md up,
 * same role/idle-timeout guarantees the V2 layout had.
 *
 * Each page renders its own <main>, same convention as (patient)/layout.tsx —
 * this shell deliberately doesn't, so there's exactly one <main> per screen.
 */
export default async function ReceptionLayout({ children }: { children: React.ReactNode }) {
  const { supabase, user, staffIdleTimeoutMinutes } = await requireRole('receptionist')

  const { data: profile } = await supabase
    .from('profiles')
    .select('clinic_id')
    .eq('auth_user_id', user.id)
    .single()

  let clinicName: string | null = null
  let clinicPhone: string | null = null
  if (profile?.clinic_id) {
    const { data: clinic } = await supabase
      .from('clinics')
      .select('name, phone')
      .eq('id', profile.clinic_id)
      .maybeSingle()
    clinicName = clinic?.name ?? null
    clinicPhone = clinic?.phone ?? null
  }

  return (
    // theme-reception switches every token below to the V3 Figma palette (globals.css).
    <div className="theme-reception min-h-dvh md:flex">
      <ReceptionSidebar clinicName={clinicName} clinicPhone={clinicPhone} />
      <div className="min-w-0 flex-1">
        <ReceptionMobileNav />
        {children}
      </div>
      <IdleTimeoutMonitor timeoutMinutes={staffIdleTimeoutMinutes ?? 30} />
    </div>
  )
}
