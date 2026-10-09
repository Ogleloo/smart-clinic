import { CalendarCheck, Users, Stethoscope, CalendarClock, type LucideIcon } from 'lucide-react'

export interface DashboardStats {
  todaysCheckIns: number
  currentlyWaiting: number
  inConsultation: number
  scheduledToday: number
}

const TILES: { key: keyof DashboardStats; label: string; icon: LucideIcon }[] = [
  { key: 'todaysCheckIns', label: "Today's Check-ins", icon: CalendarCheck },
  { key: 'currentlyWaiting', label: 'Currently Waiting', icon: Users },
  { key: 'inConsultation', label: 'In Consultation', icon: Stethoscope },
  { key: 'scheduledToday', label: 'Scheduled Today', icon: CalendarClock },
]

/**
 * Figma frame 111:2 "Stats-Row" shows a trend line under each figure
 * ("+12% from yesterday") — there's no yesterday comparison in the data
 * this reuses, so that line is left out rather than shown with a made-up
 * number (no number this system can't justify, CLAUDE.md).
 */
export function StatTiles({ stats }: { stats: DashboardStats }) {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {TILES.map(({ key, label, icon: Icon }) => (
        <div key={key} className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-50 text-primary-700">
            <Icon size={22} aria-hidden />
          </span>
          <div className="flex flex-col gap-1">
            <p className="text-sm text-muted">{label}</p>
            <p className="font-mono text-[32px] font-bold leading-none tabular-nums text-ink">{stats[key]}</p>
          </div>
        </div>
      ))}
    </div>
  )
}
