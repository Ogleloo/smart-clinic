import { requireRole } from '@/lib/auth/requireRole'
import { getAdminDashboardData } from '@/lib/adminDashboard'
import { AdminDashboardView } from '@/components/admin/v3/AdminDashboardView'

export const metadata = { title: 'Admin Dashboard · Smart Clinic' }

/**
 * Admin V3 dashboard (Figma frame 168:3) — control and observability, in the order a question actually gets
 * asked: what is happening now (the cards), where is the problem (needs-attention, then the queue overview),
 * what just happened (activity), can I trust the estimates (prediction quality). Strictly read-only: staff,
 * services and settings stay behind their own pages, unchanged.
 *
 * The role is re-checked here, not only in the layout. A failed load throws to app/admin/error.tsx.
 */
export default async function AdminOverviewPage() {
  const { supabase, user } = await requireRole('admin')

  const [data, { data: profile }] = await Promise.all([
    getAdminDashboardData(supabase),
    // Explicit auth_user_id filter: RLS lets an admin see many profile rows, so an unfiltered .single() would throw.
    supabase.from('profiles').select('full_name, clinic_id').eq('auth_user_id', user.id).single(),
  ])

  let clinicName: string | null = null
  if (profile?.clinic_id) {
    const { data: clinic } = await supabase.from('clinics').select('name').eq('id', profile.clinic_id).maybeSingle()
    clinicName = clinic?.name ?? null
  }

  return <AdminDashboardView data={data} identity={{ fullName: profile?.full_name ?? 'Administrator', clinicName }} />
}
