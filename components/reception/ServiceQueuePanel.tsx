'use client'

import { useCallback, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useQueueBroadcast } from '@/lib/hooks/useQueueBroadcast'
import { StatusChip, unexpectedStatusChip, type StatusChipVariant } from '@/components/ui/StatusChip'
import { OfflineBanner } from '@/components/ui/OfflineBanner'
import { QueueToken } from '@/components/ui/QueueToken'
import type { QueueEntryStatus } from '@/lib/types/database.types'

interface QueueRow {
  queue_entry_id: string
  queue_position: number
  token: string
  patient_name: string
  priority: number
  status: QueueEntryStatus
  checked_in_at: string
  waiting_minutes: number
}

// queue_entry_status has more states than StatusChip's spec'd variant
// set — same approach as AppointmentCard: map the extras onto the
// closest visual meaning rather than growing StatusChip for one caller.
// A previous version of this map used a plain Record and mapped no_show
// onto the same 'cancelled' variant as skipped — a patient who never
// showed up is not the same as one staff actively skipped. This switch
// form keeps the same compile-time exhaustiveness a Record gave, but
// degrades to the raw value (see unexpectedStatusChip) instead of a
// silently-wrong label for a status that isn't one of these.
function queueEntryStatusToChip(status: QueueEntryStatus): { variant: StatusChipVariant; label?: string } {
  switch (status) {
    case 'waiting':
      return { variant: 'waiting' }
    case 'in_progress':
      return { variant: 'in-progress' }
    case 'done':
      return { variant: 'done' }
    case 'skipped':
      return { variant: 'cancelled' }
    case 'no_show':
      // Distinct from skipped/cancelled — this patient never showed up.
      return { variant: 'no-show' }
    default:
      return unexpectedStatusChip(status)
  }
}

interface ServiceQueuePanelProps {
  serviceId: string
  serviceName: string
  initialQueue: QueueRow[]
}

/** Reuses useQueueBroadcast (Slice 2) — same subscribe/debounce/reconnect mechanics, different RPC (get_service_queue instead of get_wait_estimate). */
export function ServiceQueuePanel({ serviceId, serviceName, initialQueue }: ServiceQueuePanelProps) {
  const [supabase] = useState(() => createClient())
  const [queue, setQueue] = useState<QueueRow[]>(initialQueue)

  const refresh = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_service_queue', { p_service_id: serviceId })
    if (!error && data) setQueue(data)
  }, [supabase, serviceId])

  const { online } = useQueueBroadcast(serviceId, refresh)

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-base font-semibold text-ink">{serviceName}</h3>
        <span className="text-xs text-muted">{queue.length} in queue</span>
      </div>

      {!online && <OfflineBanner fullWidth />}

      {queue.length === 0 ? (
        <p className="text-sm text-muted">No one in the queue for this service.</p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs font-semibold tracking-wide text-muted">
              <th className="py-2 font-semibold">#</th>
              <th className="py-2 font-semibold">Token</th>
              <th className="py-2 font-semibold">Patient</th>
              <th className="py-2 font-semibold">Waiting</th>
              <th className="py-2 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {queue.map((row) => {
              const chip = queueEntryStatusToChip(row.status)
              return (
                <tr key={row.queue_entry_id} className="border-b border-border">
                  <td className="py-2 font-mono tabular-nums text-ink">{row.queue_position}</td>
                  <td className="py-2">
                    <QueueToken token={row.token} size="sm" />
                  </td>
                  <td className="py-2 text-ink">{row.patient_name}</td>
                  <td className="py-2 font-mono tabular-nums text-ink">{row.waiting_minutes} min</td>
                  <td className="py-2">
                    <div className="flex items-center gap-1.5">
                      <StatusChip status={chip.variant} label={chip.label} />
                      {row.priority > 0 && <StatusChip status="emergency" />}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </section>
  )
}
