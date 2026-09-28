import type { ClinicHours } from '@/lib/types/database.types'

// day_of_week follows Postgres extract(dow): 0 = Sunday .. 6 = Saturday
// (migration 0052). Display order starts on Monday, matching how a
// clinic actually reads its own hours off the door, not the database's
// internal numbering.
const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const
const DAY_ABBR: Record<number, string> = { 0: 'Sun', 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat' }
const DAY_FULL: Record<number, string> = {
  0: 'Sunday',
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
}

function formatHM(time: string): string {
  return time.slice(0, 5)
}

function sameHours(a: ClinicHours, b: ClinicHours): boolean {
  if (a.is_closed !== b.is_closed) return false
  return a.is_closed ? true : a.opens_at === b.opens_at && a.closes_at === b.closes_at
}

/**
 * "Mon-Fri 07:30-16:30 · Sat 08:00-12:00 · Closed Sunday" — consecutive
 * days (in the Monday-first display order, not day_of_week's own
 * numbering) with identical hours collapse into one range, rather than
 * seven separate lines. A day genuinely missing from the table (never
 * configured) is skipped, not guessed at.
 */
export function formatOpeningHours(hours: ClinicHours[]): string {
  const byDay = new Map(hours.map((h) => [h.day_of_week, h]))
  const ordered = DISPLAY_ORDER.map((d) => byDay.get(d)).filter((h): h is ClinicHours => h !== undefined)
  if (ordered.length === 0) return ''

  const groups: ClinicHours[][] = []
  for (const h of ordered) {
    const currentGroup = groups[groups.length - 1]
    if (currentGroup && sameHours(currentGroup[0], h)) {
      currentGroup.push(h)
    } else {
      groups.push([h])
    }
  }

  return groups
    .map((group) => {
      const first = group[0].day_of_week
      const last = group[group.length - 1].day_of_week
      if (group[0].is_closed) {
        return group.length > 1 ? `Closed ${DAY_FULL[first]}–${DAY_FULL[last]}` : `Closed ${DAY_FULL[first]}`
      }
      const dayLabel = group.length > 1 ? `${DAY_ABBR[first]}–${DAY_ABBR[last]}` : DAY_ABBR[first]
      return `${dayLabel} ${formatHM(group[0].opens_at!)}–${formatHM(group[0].closes_at!)}`
    })
    .join(' · ')
}

/**
 * Purely calendar-based: noon UTC on the given date can never cross
 * into the adjacent day regardless of the caller's local offset, so
 * this reads the same day_of_week the date string actually names no
 * matter where the browser happens to be — not necessarily the
 * clinic's own timezone, but a "YYYY-MM-DD" string has no timezone of
 * its own to begin with, so there's no conversion to get wrong.
 */
export function dayOfWeekForDate(dateStr: string): number {
  return new Date(`${dateStr}T12:00:00Z`).getUTCDay()
}

export function hoursForDate(hours: ClinicHours[], dateStr: string): ClinicHours | undefined {
  const dow = dayOfWeekForDate(dateStr)
  return hours.find((h) => h.day_of_week === dow)
}

export function dayFullName(dayOfWeek: number): string {
  return DAY_FULL[dayOfWeek]
}
