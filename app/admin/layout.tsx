import { requireRole } from '@/lib/auth/requireRole'
import { AdminSidebar } from '@/components/admin/v3/AdminSidebar'
import { AdminMobileNav } from '@/components/admin/v3/AdminMobileNav'
import { AdminContentFrame } from '@/components/admin/v3/AdminContentFrame'
import { IdleTimeoutMonitor } from '@/components/auth/IdleTimeoutMonitor'

/**
 * Admin shell (Figma page "06 · Admin V3"): sidebar from md up, scrolling nav below. The role is also
 * re-checked by the dashboard page — a layout alone is not an authorization boundary. Behaviour of the
 * guard, the idle-timeout monitor and every page inside is unchanged from the V2 shell.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { supabase, user, staffIdleTimeoutMinutes } = await requireRole('admin')

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
    <div className="min-h-dvh md:flex">
      <AdminSidebar clinicName={clinicName} clinicPhone={clinicPhone} />
      <div className="min-w-0 flex-1">
        <AdminMobileNav />
        <AdminContentFrame>{children}</AdminContentFrame>
      </div>
      <IdleTimeoutMonitor timeoutMinutes={staffIdleTimeoutMinutes ?? 30} />
    </div>
  )
}
