'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export type DutyState = { error?: string }

export async function setDuty(_prev: DutyState, formData: FormData): Promise<DutyState> {
  const onDuty = formData.get('on_duty') === 'true'
  const serviceId = String(formData.get('service_id') ?? '')
  if (onDuty && !serviceId) return { error: 'Pick a service first.' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('set_duty', {
    p_on_duty: onDuty,
    p_service_id: serviceId || undefined,
  })
  if (error) return { error: error.message }

  revalidatePath('/nurse')
  return {}
}

export type CurrentEntry = { id: string; token: string; patientName: string }
export type CallNextState = { error?: string; none?: boolean; entry?: CurrentEntry }

// call_next_patient() takes no arguments at all — the service is implied
// by the caller's own current_service_id — so both params below exist
// only to satisfy useActionState's (prevState, formData) signature.
/* eslint-disable @typescript-eslint/no-unused-vars */
export async function callNextPatient(
  _prev: CallNextState,
  _formData: FormData
): Promise<CallNextState> {
  /* eslint-enable @typescript-eslint/no-unused-vars */
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('call_next_patient')

  if (error) {
    // Confirmed live: with nobody waiting, this RPC errors (P0001 "No
    // patients waiting") rather than returning null data with no error.
    // That specific message is a normal, expected outcome here, not a
    // failure to surface as a red banner.
    if (error.message.toLowerCase().includes('no patients waiting')) {
      return { none: true }
    }
    return { error: error.message }
  }

  // call_next_patient returns the queue_entries row, which has
  // patient_id but not the patient's name (unlike get_service_queue,
  // which resolves it internally) -- one extra lookup here keeps the
  // client to a single round trip instead of a second effect.
  const { data: patient } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', data.patient_id)
    .single()

  revalidatePath('/nurse')
  return {
    entry: { id: data.id, token: data.token, patientName: patient?.full_name ?? 'Unknown patient' },
  }
}

export type StartState = { error?: string; startedAt?: string }

export async function startConsultation(_prev: StartState, formData: FormData): Promise<StartState> {
  const queueEntryId = String(formData.get('queue_entry_id') ?? '')
  if (!queueEntryId) return { error: 'Missing queue entry.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('start_consultation', {
    p_queue_entry_id: queueEntryId,
  })
  if (error) return { error: error.message }

  revalidatePath('/nurse')
  return { startedAt: data.started_at }
}

export type EndResult = { durationMinutes: number; newServiceAverage: number; newConfidence: string }
export type EndState = { error?: string; result?: EndResult }

/**
 * This is the feedback loop: the recorded duration feeds the running
 * service average end_consultation returns, which is what
 * get_wait_estimate's confidence label is ultimately built from.
 */
export async function endConsultation(_prev: EndState, formData: FormData): Promise<EndState> {
  const queueEntryId = String(formData.get('queue_entry_id') ?? '')
  if (!queueEntryId) return { error: 'Missing queue entry.' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .rpc('end_consultation', { p_queue_entry_id: queueEntryId })
    .single()
  if (error) return { error: error.message }

  revalidatePath('/nurse')
  return {
    result: {
      durationMinutes: data.duration_minutes,
      newServiceAverage: data.new_service_average,
      newConfidence: data.new_confidence,
    },
  }
}

export type SkipState = { error?: string; skipped?: boolean }

export async function skipPatient(_prev: SkipState, formData: FormData): Promise<SkipState> {
  const queueEntryId = String(formData.get('queue_entry_id') ?? '')
  if (!queueEntryId) return { error: 'Missing queue entry.' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('skip_patient', { p_queue_entry_id: queueEntryId })
  if (error) return { error: error.message }

  revalidatePath('/nurse')
  return { skipped: true }
}

export type EmergencyState = { error?: string; success?: boolean }

export async function setEmergencyPriority(
  _prev: EmergencyState,
  formData: FormData
): Promise<EmergencyState> {
  const queueEntryId = String(formData.get('queue_entry_id') ?? '')
  const emergency = formData.get('emergency') === 'true'
  if (!queueEntryId) return { error: 'Missing queue entry.' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('set_emergency_priority', {
    p_queue_entry_id: queueEntryId,
    p_emergency: emergency,
  })
  if (error) return { error: error.message }

  revalidatePath('/nurse')
  return { success: true }
}
