import { createClient } from '@/lib/supabase/server'
import { EmptyState } from '@/components/ui/EmptyState'
import { WalkInWizard } from '@/components/reception/WalkInWizard'

export default async function WalkInPage({
  searchParams,
}: {
  // Handed off from the patient search on /reception itself — see
  // components/reception/ReceptionPatientSearch.
  searchParams: Promise<{ patientId?: string; patientName?: string; newPatientName?: string }>
}) {
  const { patientId, patientName, newPatientName } = await searchParams
  const supabase = await createClient()

  const { data: services, error } = await supabase
    .from('services')
    .select('id, name')
    .eq('is_active', true)
    .order('name')

  return (
    <main className="mx-auto flex min-h-dvh max-w-[820px] flex-col gap-5 px-6 py-6">
      <h2 className="font-display text-lg font-semibold text-ink">Register walk-in</h2>

      {error ? (
        <p className="text-sm text-danger">Couldn&rsquo;t load services. Try refreshing.</p>
      ) : services && services.length > 0 ? (
        <WalkInWizard
          services={services}
          initialSelectedPatient={patientId && patientName ? { id: patientId, full_name: patientName } : undefined}
          initialNewPatientName={newPatientName}
        />
      ) : (
        <EmptyState headline="No services available" fullWidth />
      )}
    </main>
  )
}
