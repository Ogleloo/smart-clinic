import { Clock, Stethoscope, CheckCircle2, UserPlus } from 'lucide-react'
import type { ReceptionSummary } from '@/lib/receptionDashboard'

const TILES: { key: keyof ReceptionSummary; label: string; icon: typeof Clock }[] = [
  { key: 'waitingNow', label: 'Waiting now', icon: Clock },
  { key: 'inConsultation', label: 'In consultation', icon: Stethoscope },
  { key: 'completedToday', label: 'Completed today', icon: CheckCircle2 },
  { key: 'walkInsToday', label: 'Walk-ins today', icon: UserPlus },
]

/**
 * Four live figures, each counted once from today's queue_entries — not
 * a re-labelling of the coverage strip's own per-service "waiting"
 * counts. "Waiting now" here is the same word for the same underlying
 * concept (just summed across every service instead of broken out per
 * service), not a second count under a different name.
 */
export function ActivitySummary({ summary }: { summary: ReceptionSummary }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {TILES.map(({ key, label, icon: Icon }) => (
        <div key={key} className="rounded-lg border border-border bg-surface p-4">
          <Icon size={18} className="text-primary-700" aria-hidden />
          <p className="mt-2 text-xs font-semibold tracking-wide text-muted">{label.toUpperCase()}</p>
          <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-ink">{summary[key]}</p>
        </div>
      ))}
    </div>
  )
}
