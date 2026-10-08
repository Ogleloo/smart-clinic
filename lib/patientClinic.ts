import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import type { ClinicHours } from '@/lib/types/database.types'

export type PatientClinic = {
  id: string
  name: string
  phone: string | null
  address: string | null
  city: string | null
  hours: ClinicHours[]
}

/**
 * The clinic a patient sees in the sidebar ("Need help?") and on the
 * dashboard's clinic card. Patients have no profiles.clinic_id (only
 * staff belong to a clinic — see the booking page), so this reads the
 * active clinic directly; clinics_read and hours_read are both open to
 * any authenticated caller.
 *
 * clinic_hours is filtered to that clinic explicitly rather than relying
 * on there being only one clinic's rows visible.
 *
 * cache() dedupes this within one request — the patient layout and the
 * dashboard page both call it on the same render.
 */
export const getPatientClinic = cache(async (): Promise<PatientClinic | null> => {
  const supabase = await createClient()
  const { data: clinic, error } = await supabase
    .from('clinics')
    .select('id, name, phone, address, city')
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error || !clinic) return null

  const { data: hours } = await supabase
    .from('clinic_hours')
    .select('*')
    .eq('clinic_id', clinic.id)
    .order('day_of_week')

  return { ...clinic, hours: hours ?? [] }
})
