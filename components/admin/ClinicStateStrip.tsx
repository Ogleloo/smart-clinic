import { Users, UserCheck, ShieldCheck, Clock3 } from 'lucide-react'
import type { ClinicStateStats } from '@/lib/adminDashboard'

/** "What is happening now" — the first question this screen answers. Four live figures, mobile-first (2-up, wrapping to 4-up on wider screens). */
export function ClinicStateStrip({ stats }: { stats: ClinicStateStats }) {
  const servicesAmber = stats.servicesTotal > 0 && stats.servicesCovered < stats.servicesTotal

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Tile icon={Users} label="Waiting now" value={stats.waitingNow} />
      <Tile
        icon={UserCheck}
        label="Nurses on duty"
        value={`${stats.nursesOnDuty} of ${stats.nursesTotal}`}
      />
      <Tile
        icon={ShieldCheck}
        label="Services covered"
        value={`${stats.servicesCovered} of ${stats.servicesTotal}`}
        amber={servicesAmber}
      />
      <Tile
        icon={Clock3}
        label="Avg wait today"
        value={stats.avgWaitTodayMinutes === null ? '—' : `${stats.avgWaitTodayMinutes} min`}
      />
    </div>
  )
}

function Tile({
  icon: Icon,
  label,
  value,
  amber = false,
}: {
  icon: typeof Users
  label: string
  value: string | number
  amber?: boolean
}) {
  return (
    <div
      className={`rounded-lg border p-4 ${amber ? 'border-warning bg-warning-bg' : 'border-border bg-surface'}`}
    >
      <Icon size={18} className={amber ? 'text-warning' : 'text-primary-700'} aria-hidden />
      <p className={`mt-2 text-xs font-semibold tracking-wide ${amber ? 'text-warning' : 'text-muted'}`}>
        {label.toUpperCase()}
      </p>
      <p className={`mt-1 font-mono text-2xl font-semibold tabular-nums ${amber ? 'text-warning' : 'text-ink'}`}>
        {value}
      </p>
    </div>
  )
}
