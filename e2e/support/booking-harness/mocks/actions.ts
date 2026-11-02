/**
 * Stand-in for app/actions/appointments.ts — only bookAppointment() is used by BookingWizard. The real action
 * calls Next's redirect() on success, which only works inside a real Next request; the harness has no real
 * request to redirect, so a configured "success" response here just resolves to {} (the same as never
 * returning, from useActionState's point of view) rather than throwing redirect's internal signal. What the
 * harness tests is what reaches this function — the exact service_id/slot sent, how many times it's called —
 * not Next's own, already-covered redirect mechanics.
 */
import { respond } from './state'
import type { ActionState } from '../../../../app/actions/appointments'

export async function bookAppointment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const service_id = String(formData.get('service_id') ?? '')
  const slot = String(formData.get('slot') ?? '')
  const result = (await respond('bookAppointment', [{ service_id, slot }])) as ActionState | undefined
  return result ?? {}
}
