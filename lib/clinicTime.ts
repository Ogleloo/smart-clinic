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

/**
 * "4 min ago" is a duration (now minus created_at), so it reads the
 * same regardless of which zone it's computed in — only the absolute
 * fallback past a week needs an explicit timezone, and that one uses
 * CLINIC_TIMEZONE for the same ADR-020 reason as everywhere else.
 */
export function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000))

  if (seconds < 60) return 'Just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`

  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: CLINIC_TIMEZONE,
  })
}
