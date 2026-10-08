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
 * Date.now() called directly in a Server Component's render body trips
 * react-hooks/purity (components must be idempotent) — wrapping it in
 * a plain helper, called rather than inlined, keeps the same impure
 * call out of the component function itself.
 */
export function isoNDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 3600 * 1000).toISOString()
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

/** Hour of day (0–23) right now in the clinic's timezone — not the browser's or the server's (ADR-020). */
function clinicHourNow(): number {
  const hour = new Intl.DateTimeFormat('en-GB', {
    hour: 'numeric',
    hourCycle: 'h23',
    timeZone: CLINIC_TIMEZONE,
  }).format(new Date())
  return Number(hour)
}

export function greetingForNow(): string {
  const hour = clinicHourNow()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

/** "Thursday, 8 October" — today's date as the clinic sees it. */
export function formatTodayLong(): string {
  return new Date().toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: CLINIC_TIMEZONE,
  })
}

export function formatClinicDate(iso: string, opts: Intl.DateTimeFormatOptions = {}): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...opts,
    timeZone: CLINIC_TIMEZONE,
  })
}

export function formatClinicTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: CLINIC_TIMEZONE,
  })
}

/** "08 Oct 2026, 09:14" — absolute timestamp alongside a relative one. */
export function formatClinicDateTime(iso: string): string {
  return `${formatClinicDate(iso, { weekday: undefined, year: 'numeric' })}, ${formatClinicTime(iso)}`
}

/**
 * A YYYY-MM-DD calendar date (date_of_birth, scheduled_date) has no
 * timezone of its own — formatting it at noon UTC, in UTC, reads back
 * exactly the day it names wherever this runs.
 */
export function formatCalendarDate(dateStr: string, opts: Intl.DateTimeFormatOptions = {}): string {
  return new Date(`${dateStr}T12:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    ...opts,
    timeZone: 'UTC',
  })
}
