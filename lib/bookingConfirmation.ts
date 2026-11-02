import type { AppointmentStatus } from './types/database.types'

/**
 * A booking confirmation URL (/book/confirmed/[id]) is only ever correct to show once: right after booking,
 * while the appointment is still 'booked'. The same URL stays reachable afterwards (it's just the
 * appointment's id), so revisiting it once the patient has checked in, cancelled, no-showed or completed the
 * visit must never present that now-stale status as a fresh confirmation — the appointment's own, already
 * RLS-authorized details page (/appointments/[id]) is where its current status belongs instead.
 */
export function confirmationDestination(status: AppointmentStatus): 'success' | 'details' {
  return status === 'booked' ? 'success' : 'details'
}
