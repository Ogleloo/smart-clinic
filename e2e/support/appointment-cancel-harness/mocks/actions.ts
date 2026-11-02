/** Stand-in for app/actions/appointments.ts — only cancelAppointment() is used by CancelAppointmentButton. */
import { respond } from './state'
import type { ActionState } from '../../../../app/actions/appointments'

export async function cancelAppointment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const appointment_id = String(formData.get('appointment_id') ?? '')
  const result = (await respond('cancelAppointment', [{ appointment_id }])) as ActionState | undefined
  return result ?? {}
}
