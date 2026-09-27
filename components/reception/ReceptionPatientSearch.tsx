'use client'

import { useRouter } from 'next/navigation'
import { PatientSearchBox, type PatientSearchResult } from '@/components/reception/PatientSearchBox'

/**
 * Search on the reception landing page — the most common reception
 * action, previously only reachable inside the walk-in wizard. Finding a
 * patient here hands off straight into check-in (the walk-in wizard),
 * which is what a receptionist is searching for someone to do next
 * anyway, without making them search a second time.
 */
export function ReceptionPatientSearch() {
  const router = useRouter()

  function handleSelect(patient: PatientSearchResult) {
    router.push(
      `/reception/walk-in?patientId=${encodeURIComponent(patient.id)}&patientName=${encodeURIComponent(patient.full_name)}`
    )
  }

  function handleAddNew(query: string) {
    router.push(`/reception/walk-in?newPatientName=${encodeURIComponent(query)}`)
  }

  return <PatientSearchBox onSelect={handleSelect} onAddNew={handleAddNew} />
}
