'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { parsePhone, parseStaffName } from '@/lib/profileValidation'

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
  patient?: { id: string; full_name: string; phone: string | null }
}

export async function createWalkinPatient(
  _prev: CreatePatientState,
  formData: FormData
): Promise<CreatePatientState> {
  /**
   * The same name and phone rules the patient's own registration and profile forms use — this action creates a
   * real profile row, and it was previously the one path into that table that checked nothing but "not empty".
   * A walk-in created here is indistinguishable from a self-registered patient afterwards, so it cannot be the
   * loose door: anything refused on /register has to be refused here too, or the rule only applies to patients
   * who type their own details.
   *
   * Phone is optional (a walk-in may not give one) but, when given, is normalised to the one stored format so
   * the number on the record can actually be dialled and can be matched against an existing patient.
   */
  const name = parseStaffName(String(formData.get('full_name') ?? ''))
  if (name.error) return { error: name.error === 'Enter your full name.' ? 'Enter the patient’s full name.' : name.error }

  const phone = parsePhone(String(formData.get('phone') ?? ''))
  if (phone.error) return { error: phone.error }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('create_walkin_patient', {
    p_full_name: name.value as string,
    p_phone: phone.value ?? undefined,
  })
  if (error) return { error: error.message }

  return { patient: { id: data.id, full_name: data.full_name, phone: data.phone } }
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

export type SkipState = { error?: string; skippedToken?: string }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Runs as the caller's own session; skip_patient() enforces clinic
 * isolation and the receptionist waiting-only rule in the database, so its
 * message is shown verbatim. No p_no_show — receptionists can't set it.
 */
export async function skipQueueEntry(_prev: SkipState, formData: FormData): Promise<SkipState> {
  const queueEntryId = String(formData.get('queue_entry_id') ?? '')
  if (!UUID_RE.test(queueEntryId)) return { error: 'Missing or invalid queue entry.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('skip_patient', { p_queue_entry_id: queueEntryId })
  if (error) return { error: error.message }

  revalidatePath('/reception/queue')
  revalidatePath('/reception')
  return { skippedToken: data.token }
}
