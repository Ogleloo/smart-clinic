/**
 * The clinic's timezone, not the viewer's or the server's (ADR-020) —
 * the backend derives scheduled_date the same way. Shared by every
 * screen that displays or queries by "today": the patient booking
 * wizard (client), reception's dashboard and appointment list
 * (server), and AppointmentCard's formatting.
 */
export const CLINIC_TIMEZONE = 'Africa/Johannesburg'

export function todayInClinicTimezone(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: CLINIC_TIMEZONE }).format(new Date())
}
