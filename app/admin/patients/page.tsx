import { createClient } from '@/lib/supabase/server'
import { PatientSearch } from '@/components/admin/PatientSearch'
import { DuplicatePatients } from '@/components/admin/DuplicatePatients'

export default async function AdminPatientsPage() {
  const supabase = await createClient()
  const { data: pairs, error } = await supabase.rpc('find_duplicate_patients')

  return (
    <div className="flex flex-col gap-5">
      <h2 className="font-display text-lg font-semibold text-ink">Patients</h2>

      <PatientSearch />

      <section className="flex flex-col gap-3">
        <p className="text-xs font-semibold tracking-wide text-muted">LIKELY DUPLICATES</p>
        {error ? (
          <p className="text-sm text-danger">Couldn&rsquo;t check for duplicates. Try refreshing.</p>
        ) : (
          <DuplicatePatients initialPairs={pairs ?? []} />
        )}
      </section>
    </div>
  )
}
