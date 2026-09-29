import { AlertTriangle } from 'lucide-react'
import { LinkButton } from '@/components/ui/LinkButton'
import type { AttentionAlert } from '@/lib/adminDashboard'

/**
 * "Where is the problem" — the second question, and the only section
 * that can disappear entirely. Only the urgent subset of uncovered
 * services belongs here (people actually waiting, not merely a quiet
 * service with nobody on duty) — see getAdminDashboardData for why.
 */
export function NeedsAttentionPanel({ alerts }: { alerts: AttentionAlert[] }) {
  if (alerts.length === 0) return null

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-warning bg-warning-bg p-4">
      <div className="flex items-center gap-2">
        <AlertTriangle size={18} className="text-warning" aria-hidden />
        <p className="text-sm font-semibold tracking-wide text-warning">NEEDS ATTENTION</p>
      </div>

      <ul className="flex flex-col gap-3">
        {alerts.map((alert) => {
          const isSingular = alert.waitingCount === 1
          return (
            <li key={alert.serviceId} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-ink">
                  {alert.serviceName} has {alert.waitingCount} {isSingular ? 'patient' : 'patients'} waiting and
                  no nurse on duty.
                </p>
                <p className="text-sm text-muted">
                  {isSingular ? 'That patient is' : 'Those patients are'} shown &ldquo;Not currently being
                  served&rdquo; &mdash; no wait estimate is given.
                </p>
              </div>
              <LinkButton href="/admin/staff" variant="secondary" className="shrink-0">
                Assign a nurse
              </LinkButton>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
