import { requireRole } from '@/lib/auth/requireRole'
import { getPatientClinic } from '@/lib/patientClinic'
import { PatientNav } from '@/components/patient/PatientNav'

/**
 * Shared shell for every patient screen.
 *
 * Until now this only checked "is there a user at all" — the same
 * (weaker) check every page under here duplicated individually — never
 * the role, unlike reception/nurse/admin, which each gate their whole
 * area on requireRole() in their layout. A logged-in staff account is a
 * valid user, so it sailed straight through every page's own check and
 * into queries whose "exactly one row" invariant assumed a patient
 * caller (see the dashboard profile query: RLS lets staff read many
 * profile rows relationally, so .single() threw for them, never for an
 * actual patient). requireRole('patient') here closes that off for the
 * whole area at once, the same way the other three areas already work.
 *
 * V3: persistent sidebar from md up, the existing bottom nav below md.
 * Each page renders its own <main>; this shell deliberately doesn't, so
 * there is exactly one <main> per screen.
 */
export default async function PatientLayout({ children }: { children: React.ReactNode }) {
  const { supabase } = await requireRole('patient')

  const [{ count }, clinic] = await Promise.all([
    supabase.from('notifications').select('*', { count: 'exact', head: true }).is('read_at', null),
    getPatientClinic(),
  ])

  return (
    <div className="min-h-dvh md:flex">
      <PatientNav
        initialUnreadCount={count ?? 0}
        clinicName={clinic?.name ?? null}
        clinicPhone={clinic?.phone ?? null}
      />
      <div className="min-w-0 flex-1 pb-20 md:pb-0">{children}</div>
    </div>
  )
}
