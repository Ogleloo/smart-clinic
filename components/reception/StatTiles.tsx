import { CalendarCheck, Users, Stethoscope, CalendarClock, type LucideIcon } from 'lucide-react'

export interface DashboardStats {
  todaysCheckIns: number
  currentlyWaiting: number
  inConsultation: number
  scheduledToday: number
}

/**
 * Figma frame 111:2 "Stats-Row" shows a trend line under the first card
 * ("+12% from yesterday") — there's no yesterday comparison in the data
 * this reuses, so that line is left out rather than shown with a made-up
 * number (no number this system can't justify, CLAUDE.md). The other
 * three cards' captions are static labels, not figures, so those are
 * reproduced as-is.
 */
const TILES: { key: keyof DashboardStats; label: string; icon: LucideIcon; caption?: string }[] = [
  { key: 'todaysCheckIns', label: "Today's Check-ins", icon: CalendarCheck },
  { key: 'currentlyWaiting', label: 'Currently Waiting', icon: Users, caption: 'Across all services' },
  { key: 'inConsultation', label: 'In Consultation', icon: Stethoscope, caption: 'Patients in consultation' },
  { key: 'scheduledToday', label: 'Scheduled Today', icon: CalendarClock, caption: 'Appointments' },
]

export function StatTiles({ stats }: { stats: DashboardStats }) {
  return (
    <div className="grid grid-cols-2 gap-5 lg:grid-cols-4">
      {TILES.map(({ key, label, icon: Icon, caption }) => (
        <div
          key={key}
          className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-5 shadow-[0_12px_32px_rgba(5,48,46,0.08)]"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-50 text-primary-700">
            <Icon size={22} aria-hidden />
          </span>
          <p className="text-base text-ink">{label}</p>
          <p className="font-display text-[40px] font-bold leading-[44px] tabular-nums text-ink">{stats[key]}</p>
          {caption && <p className="text-base text-muted">{caption}</p>}
        </div>
      ))}
    </div>
  )
}
