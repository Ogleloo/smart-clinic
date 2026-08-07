'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export type ActionState = { error?: string; success?: string }

/**
 * The slot grid can go stale between load and click — that staleness is
 * exactly what BR-4 guards against. This deliberately does not re-check
 * availability first; it attempts the booking and surfaces whatever the
 * database decides. The RPC already returns human-readable messages for
 * BR-4 (slot taken), BR-6 (duplicate same-day booking) and the 15-minute
 * boundary rule, so error.message is shown as-is rather than translated.
 */
export async function bookAppointment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const serviceId = String(formData.get('service_id') ?? '')
  const slot = String(formData.get('slot') ?? '')
  if (!serviceId || !slot) return { error: 'Pick a service and a time slot first.' }

  const supabase = await createClient()

  // p_patient_id omitted: patients book for themselves, resolved server-side
  // from the caller's own session (RLS/RPC-enforced, not a client claim).
  const { data, error } = await supabase.rpc('book_appointment', {
    p_service_id: serviceId,
    p_slot: slot,
  })

  if (error) return { error: error.message }

  redirect(`/appointments/${data.id}`)
}

export async function cancelAppointment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const appointmentId = String(formData.get('appointment_id') ?? '')
  if (!appointmentId) return { error: 'Missing appointment.' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('cancel_appointment', { p_appointment_id: appointmentId })
  if (error) return { error: error.message }

  // The unique index that enforces one active booking per slot ignores
  // cancelled rows, so the slot is free again the moment this commits —
  // no separate "release the slot" step needed here.
  revalidatePath(`/appointments/${appointmentId}`)
  revalidatePath('/dashboard')
  return { success: 'Appointment cancelled.' }
}
