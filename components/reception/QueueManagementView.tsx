'use client'

import { useCallback, useMemo, useState } from 'react'
import { StatusChip } from '@/components/ui/StatusChip'
import { OfflineBanner } from '@/components/ui/OfflineBanner'
import { QueueToken } from '@/components/ui/QueueToken'
import { EmptyState } from '@/components/ui/EmptyState'
import { Button } from '@/components/ui/Button'
import { queueEntryStatusToChip } from '@/lib/queueEntryStatus'
import { ServiceQueueSync, type QueueRow } from './ServiceQueueSync'
import { SkipPatientModal } from './SkipPatientModal'

interface Service {
  id: string
  name: string
}

interface QueueManagementViewProps {
  services: Service[]
  initialQueues: Record<string, Omit<QueueRow, 'serviceId' | 'serviceName'>[]>
}

const ALL = 'all'

/**
 * Figma frame 114:736. "#" is recomputed client-side from the same
 * (priority desc, checked_in_at asc) ordering get_service_queue itself
 * uses — get_service_queue only numbers within one service, which would
 * produce duplicate "#1"s once multiple services are combined under "All
 * services", so this view owns the single coherent ordering shown on screen
 * for whatever subset (one service, or all of them) is currently visible.
 *
 * No "Next" action anywhere here — call_next_patient() is nurse-only and
 * this screen never exposes it, forged or otherwise (Phase 3 brief). The
 * only receptionist action is Skip, and SkipPatientModal explains why even
 * that one is currently disabled.
 */
export function QueueManagementView({ services, initialQueues }: QueueManagementViewProps) {
  const [queueByService, setQueueByService] = useState<Record<string, QueueRow[]>>({})
  const [errorByService, setErrorByService] = useState<Record<string, string | null>>({})
  const [onlineByService, setOnlineByService] = useState<Record<string, boolean>>({})
  const [selected, setSelected] = useState<string>(ALL)
  const [skipTarget, setSkipTarget] = useState<QueueRow | null>(null)

  const onUpdate = useCallback((serviceId: string, rows: QueueRow[], error: string | null) => {
    setErrorByService((prev) => ({ ...prev, [serviceId]: error }))
    if (error) return
    setQueueByService((prev) => ({ ...prev, [serviceId]: rows }))
  }, [])

  const onOnlineChange = useCallback((serviceId: string, online: boolean) => {
    setOnlineByService((prev) => (prev[serviceId] === online ? prev : { ...prev, [serviceId]: online }))
  }, [])

  const rows = useMemo(() => {
    const combined =
      selected === ALL
        ? services.flatMap((s) => queueByService[s.id] ?? [])
        : (queueByService[selected] ?? [])
    const sorted = [...combined].sort((a, b) => {
      if (a.priority !== b.priority) return b.priority - a.priority
      return a.checked_in_at.localeCompare(b.checked_in_at)
    })
    return sorted.map((row, i) => ({ ...row, position: i + 1 }))
  }, [selected, services, queueByService])

  const anyOffline = Object.values(onlineByService).some((online) => online === false)
  const failedServices = services.filter((s) => errorByService[s.id])

  return (
    <div className="flex flex-col gap-5">
      {services.map((s) => (
        <ServiceQueueSync
          key={s.id}
          serviceId={s.id}
          serviceName={s.name}
          initialQueue={initialQueues[s.id] ?? []}
          onUpdate={onUpdate}
          onOnlineChange={onOnlineChange}
        />
      ))}

      {anyOffline && <OfflineBanner fullWidth />}
      {failedServices.length > 0 && (
        <div role="alert" className="rounded-lg bg-danger-bg px-4 py-2 text-sm text-danger">
          Couldn&rsquo;t refresh the queue for {failedServices.map((s) => s.name).join(', ')}. Showing the last known
          data — try refreshing the page.
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setSelected(ALL)}
          className={`rounded-full px-5 py-3 text-base transition-colors ${
            selected === ALL ? 'bg-primary-500 text-white' : 'border border-border bg-surface text-muted hover:bg-paper'
          }`}
        >
          All services
        </button>
        {services.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSelected(s.id)}
            aria-pressed={selected === s.id}
            className={`rounded-full px-5 py-3 text-base transition-colors ${
              selected === s.id ? 'bg-primary-500 text-white' : 'border border-border bg-surface text-muted hover:bg-paper'
            }`}
          >
            {s.name}
          </button>
        ))}
      </div>

      <section className="rounded-xl border border-border bg-surface p-5 shadow-[0_8px_18px_rgba(5,48,46,0.05)]">
        {rows.length === 0 ? (
          <EmptyState headline="No one in the queue" body="Checked-in and waiting patients will appear here." fullWidth />
        ) : (
          <>
            <table className="hidden w-full table-fixed border-collapse text-left md:table">
              <colgroup>
                <col className="w-[5%]" />
                <col className="w-[11%]" />
                <col className="w-[22%]" />
                <col className="w-[22%]" />
                <col className="w-[13%]" />
                <col className="w-[10%]" />
                <col className="w-[17%]" />
              </colgroup>
              <thead>
                <tr className="h-10 rounded-sm bg-primary-50 text-xs font-semibold text-muted">
                  <th className="pl-3 font-semibold">#</th>
                  <th className="px-2 font-semibold">Token</th>
                  <th className="px-2 font-semibold">Patient name</th>
                  <th className="px-2 font-semibold">Service</th>
                  <th className="px-2 font-semibold">Status</th>
                  <th className="px-2 font-semibold">Wait time</th>
                  <th className="pr-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const chip = queueEntryStatusToChip(row.status)
                  const isWaiting = row.status === 'waiting'
                  return (
                    <tr key={row.queue_entry_id} className="h-[82px] border-b border-border align-middle last:border-0">
                      <td className="pl-3 text-[13px] text-muted">{row.position}</td>
                      <td className="px-2">
                        <QueueToken token={row.token} size="sm" />
                      </td>
                      <td className="truncate px-2 text-[13px] text-ink">{row.patient_name}</td>
                      <td className="truncate px-2 text-[13px] text-muted">{row.serviceName}</td>
                      <td className="px-2">
                        <div className="flex items-center gap-1.5">
                          <StatusChip status={chip.variant} label={chip.label} />
                          {row.priority > 0 && <StatusChip status="emergency" />}
                        </div>
                      </td>
                      <td className="px-2 text-[13px] text-ink">{isWaiting ? `${row.waiting_minutes} min` : '—'}</td>
                      <td className="pr-3">
                        {isWaiting ? (
                          <Button variant="danger-outline" onClick={() => setSkipTarget(row)} className="!min-h-9 !px-4 !text-sm">
                            Skip
                          </Button>
                        ) : (
                          <StatusChip status={chip.variant} label={chip.label} />
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            {/* Mobile: a 7-column table doesn't fit at 390px — a stacked card carries the same fields instead. */}
            <ul className="flex flex-col gap-3 md:hidden">
              {rows.map((row) => {
                const chip = queueEntryStatusToChip(row.status)
                const isWaiting = row.status === 'waiting'
                return (
                  <li key={row.queue_entry_id} className="rounded-lg border border-border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-ink">
                          #{row.position} &middot; {row.patient_name}
                        </p>
                        <p className="text-xs text-muted">{row.serviceName}</p>
                      </div>
                      <QueueToken token={row.token} size="sm" />
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-1.5">
                        <StatusChip status={chip.variant} label={chip.label} />
                        {row.priority > 0 && <StatusChip status="emergency" />}
                      </div>
                      <span className="text-xs text-muted">{isWaiting ? `${row.waiting_minutes} min waiting` : '—'}</span>
                    </div>
                    {isWaiting && (
                      <Button
                        variant="danger-outline"
                        fullWidth
                        onClick={() => setSkipTarget(row)}
                        className="mt-3 !min-h-9 !text-sm"
                      >
                        Skip
                      </Button>
                    )}
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </section>

      {skipTarget && <SkipPatientModal entry={skipTarget} onClose={() => setSkipTarget(null)} />}
    </div>
  )
}
