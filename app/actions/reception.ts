'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export type CheckInState = { error?: string; token?: string }

/**
 * Errors here (already checked in, already in the queue) are shown
 * verbatim from the RPC — same policy as booking (Slice 3): the
 * database is the arbiter, the client doesn't pre-validate.
 */
export async function checkInAppointment(
  _prev: CheckInState,
  formData: FormData
): Promise<CheckInState> {
  const appointmentId = String(formData.get('appointment_id') ?? '')
  if (!appointmentId) return { error: 'Missing appointment.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('check_in_appointment', {
    p_appointment_id: appointmentId,
  })
  if (error) return { error: error.message }

  revalidatePath('/reception/appointments')
  revalidatePath('/reception')
  return { token: data.token }
}

export type CreatePatientState = {
  error?: string
  patient?: { id: string; full_name: string }
}

export async function createWalkinPatient(
  _prev: CreatePatientState,
  formData: FormData
): Promise<CreatePatientState> {
  const fullName = String(formData.get('full_name') ?? '').trim()
  const phone = String(formData.get('phone') ?? '').trim()
  if (!fullName) return { error: 'Enter the patient’s full name.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('create_walkin_patient', {
    p_full_name: fullName,
    p_phone: phone || undefined,
  })
  if (error) return { error: error.message }

  return { patient: { id: data.id, full_name: data.full_name } }
}

export async function checkInPatient(
  _prev: CheckInState,
  formData: FormData
): Promise<CheckInState> {
  const serviceId = String(formData.get('service_id') ?? '')
  const patientId = String(formData.get('patient_id') ?? '')
  if (!serviceId || !patientId) return { error: 'Pick a service and a patient first.' }

  const supabase = await createClient()
  // No p_priority: emergency priority is nurse-only (BR-10) and this
  // screen deliberately doesn't offer it — the RPC would reject a
  // receptionist attempting it anyway.
  const { data, error } = await supabase.rpc('check_in_patient', {
    p_service_id: serviceId,
    p_patient_id: patientId,
  })
  if (error) return { error: error.message }

  revalidatePath('/reception')
  return { token: data.token }
}
