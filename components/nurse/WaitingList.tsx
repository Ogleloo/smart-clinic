'use client'

import { useCallback, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useQueueBroadcast } from '@/lib/hooks/useQueueBroadcast'
import { CLINIC_TIMEZONE } from '@/lib/clinicTime'
import { StatusChip } from '@/components/ui/StatusChip'
import { QueueToken } from '@/components/ui/QueueToken'
import { OfflineBanner } from '@/components/ui/OfflineBanner'
import { EmergencyToggle } from './EmergencyToggle'

interface QueueRow {
  queue_entry_id: string
  queue_position: number
  token: string
  patient_name: string
  priority: number
  status: string
  checked_in_at: string
  waiting_minutes: number
}

interface AuditInfo {
  priority_set_at: string | null
  setterName: string | null
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: CLINIC_TIMEZONE,
  })
}

interface WaitingListProps {
  serviceId: string
  initialQueue: QueueRow[]
}

/**
 * Reuses useQueueBroadcast (Slice 2/4) for the live list. get_service_queue
 * doesn't return priority_set_by/priority_set_at (reception's queue view
 * doesn't need them), so emergency rows get one extra targeted query
 * against queue_entries + the priority_set_by relationship — display-only
 * audit metadata, not queue logic, so this doesn't conflict with
 * get_service_queue owning position/wait-time truth (ADR-009).
 */
export function WaitingList({ serviceId, initialQueue }: WaitingListProps) {
  const [supabase] = useState(() => createClient())
  const [queue, setQueue] = useState<QueueRow[]>(initialQueue)
  const [audit, setAudit] = useState<Record<string, AuditInfo>>({})

  const refresh = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_service_queue', { p_service_id: serviceId })
    if (error || !data) return
    setQueue(data)

    const emergencyIds = data.filter((r) => r.priority > 0).map((r) => r.queue_entry_id)
    if (emergencyIds.length === 0) {
      setAudit({})
      return
    }

    const { data: rows } = await supabase
      .from('queue_entries')
      .select('id, priority_set_at, setter:profiles!queue_entries_priority_set_by_fkey(full_name)')
      .in('id', emergencyIds)

    const next: Record<string, AuditInfo> = {}
    for (const r of rows ?? []) {
      next[r.id] = { priority_set_at: r.priority_set_at, setterName: r.setter?.full_name ?? null }
    }
    setAudit(next)
  }, [supabase, serviceId])

  const { online } = useQueueBroadcast(serviceId, refresh)

  const waiting = queue.filter((r) => r.status === 'waiting')

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold tracking-wide text-muted">WAITING LIST</p>
        <span className="text-xs text-muted">{waiting.length} waiting</span>
      </div>

      {!online && <OfflineBanner fullWidth />}

      {waiting.length === 0 ? (
        <p className="text-sm text-muted">No one waiting.</p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs font-semibold tracking-wide text-muted">
              <th className="py-2 font-semibold">#</th>
              <th className="py-2 font-semibold">Token</th>
              <th className="py-2 font-semibold">Patient</th>
              <th className="py-2 font-semibold">Waiting</th>
              <th className="py-2 font-semibold">Status</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {waiting.map((row) => {
              const isEmergency = row.priority > 0
              const info = audit[row.queue_entry_id]
              return (
                <tr
                  key={row.queue_entry_id}
                  className={`border-b border-border ${isEmergency ? 'bg-danger-bg' : ''}`}
                >
                  <td className="py-2 font-mono tabular-nums text-ink">{row.queue_position}</td>
                  <td className="py-2">
                    <QueueToken token={row.token} size="sm" />
                  </td>
                  <td className="py-2 text-ink">{row.patient_name}</td>
                  <td className="py-2 font-mono tabular-nums text-ink">{row.waiting_minutes} min</td>
                  <td className="py-2">
                    <div className="flex flex-col gap-1">
                      <StatusChip status="waiting" />
                      {isEmergency && (
                        <div>
                          <StatusChip status="emergency" />
                          {info && (
                            <p className="mt-1 text-xs text-muted">
                              by {info.setterName ?? 'unknown'}
                              {info.priority_set_at ? ` at ${formatTime(info.priority_set_at)}` : ''}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="py-2 text-right">
                    <EmergencyToggle queueEntryId={row.queue_entry_id} isEmergency={isEmergency} />
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
