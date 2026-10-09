'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useQueueBroadcast } from '@/lib/hooks/useQueueBroadcast'
import type { QueueEntryStatus } from '@/lib/types/database.types'

export interface QueueRow {
  queue_entry_id: string
  token: string
  patient_name: string
  priority: number
  status: QueueEntryStatus
  checked_in_at: string
  /** Minutes since check-in (get_service_queue) — elapsed time, never a remaining-wait prediction. */
  waiting_minutes: number
  serviceId: string
  serviceName: string
}

interface ServiceQueueSyncProps {
  serviceId: string
  serviceName: string
  initialQueue: Omit<QueueRow, 'serviceId' | 'serviceName'>[]
  onUpdate: (serviceId: string, rows: QueueRow[], error: string | null) => void
  onOnlineChange: (serviceId: string, online: boolean) => void
}

/**
 * One `useQueueBroadcast` subscription per service, kept running regardless
 * of which filter pill is selected — switching filters is a pure client-side
 * slice of already-live data, not a resubscribe (Phase 3 requirement:
 * "changing filters displays correct current data", "no duplicate
 * subscriptions"). Renders nothing; it only lifts rows up to the parent.
 *
 * On a failed refresh, the parent is told about the error but the existing
 * rows are NOT cleared to empty — a query failure must not read as "nobody
 * is waiting" (Phase 3 requirement).
 */
export function ServiceQueueSync({ serviceId, serviceName, initialQueue, onUpdate, onOnlineChange }: ServiceQueueSyncProps) {
  const [supabase] = useState(() => createClient())

  const refresh = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_service_queue', { p_service_id: serviceId })
    if (error || !data) {
      onUpdate(serviceId, [], error?.message ?? 'Could not load this service’s queue.')
      return
    }
    onUpdate(
      serviceId,
      data.map((row) => ({ ...row, serviceId, serviceName })),
      null
    )
  }, [supabase, serviceId, serviceName, onUpdate])

  const { online } = useQueueBroadcast(serviceId, refresh)

  useEffect(() => {
    onUpdate(
      serviceId,
      initialQueue.map((row) => ({ ...row, serviceId, serviceName })),
      null
    )
    // Seed once from server-rendered data; `refresh` (via useQueueBroadcast) takes over after the first realtime subscribe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    onOnlineChange(serviceId, online)
  }, [serviceId, online, onOnlineChange])

  return null
}
