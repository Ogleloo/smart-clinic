'use client'

import { useCallback, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Notification, WaitEstimate } from '@/lib/types/database.types'
import { useQueueBroadcast } from '@/lib/hooks/useQueueBroadcast'
import { QueueStatusCard } from './QueueStatusCard'
import { RecentNotifications } from './RecentNotifications'
import { OfflineBanner } from '@/components/ui/OfflineBanner'

interface QueueStatusProps {
  entryId: string
  serviceId: string
  initialEstimate: WaitEstimate
  initialNotifications: Notification[]
}

/**
 * Live wrapper around QueueStatusCard. The estimate is computed, not
 * stored, so realtime can't broadcast it directly (ADR-009) — every
 * broadcast ping causes a re-call of get_wait_estimate(), which is
 * RLS/role-checked for this patient. See useQueueBroadcast for the
 * shared subscribe/debounce/reconnect mechanics (also used by
 * reception's queue view in Slice 4).
 */
export function QueueStatus({
  entryId,
  serviceId,
  initialEstimate,
  initialNotifications,
}: QueueStatusProps) {
  const [supabase] = useState(() => createClient())
  const [estimate, setEstimate] = useState<WaitEstimate>(initialEstimate)

  const refresh = useCallback(async () => {
    const { data, error } = await supabase
      .rpc('get_wait_estimate', { p_queue_entry_id: entryId })
      .single()
    if (!error && data) setEstimate(data)
  }, [supabase, entryId])

  const { online } = useQueueBroadcast(serviceId, refresh)

  return (
    <div className="flex flex-col gap-4">
      {!online && <OfflineBanner fullWidth />}
      <QueueStatusCard estimate={estimate} />

      <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
        <p className="text-xs font-semibold tracking-wide text-muted">RECENT UPDATES</p>
        <RecentNotifications queueEntryId={entryId} initialNotifications={initialNotifications} />
      </section>
    </div>
  )
}
