import { createClient } from '@/lib/supabase/server'
import { EmptyState } from '@/components/ui/EmptyState'
import { CheckInWizard } from '@/components/reception/CheckInWizard'

export default async function CheckInPage({
  searchParams,
}: {
  // Handed off from a prior search elsewhere in reception. patientId is
  // only ever used to re-verify the real patient record (CheckInWizard
  // re-fetches the profile through RLS) — it is never trusted as the
  // patient's actual name or used to skip authorization.
  searchParams: Promise<{ patientId?: string; patientName?: string; newPatientName?: string }>
}) {
  const { patientId, newPatientName } = await searchParams
  const supabase = await createClient()

  const { data: services, error } = await supabase
    .from('services')
    .select('id, name')
    .eq('is_active', true)
    .order('name')

  return (
    <main className="mx-auto flex min-h-dvh max-w-[820px] flex-col gap-5 px-6 py-6">
      <h2 className="font-display text-lg font-semibold text-ink">Check-in Patient</h2>

      {error ? (
        <p className="text-sm text-danger">Couldn&rsquo;t load services. Try refreshing.</p>
      ) : services && services.length > 0 ? (
        <CheckInWizard services={services} initialPatientId={patientId} initialNewPatientName={newPatientName} />
      ) : (
        <EmptyState headline="No services available" fullWidth />
      )}
    </main>
  )
}
