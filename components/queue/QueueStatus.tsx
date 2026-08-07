'use client'

import { useCallback, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { WaitEstimate } from '@/lib/types/database.types'
import { useQueueBroadcast } from '@/lib/hooks/useQueueBroadcast'
import { QueueStatusCard } from './QueueStatusCard'
import { OfflineBanner } from '@/components/ui/OfflineBanner'
import { EmptyState } from '@/components/ui/EmptyState'

interface QueueStatusProps {
  entryId: string
  serviceId: string
  initialEstimate: WaitEstimate
}

/**
 * Live wrapper around QueueStatusCard. The estimate is computed, not
 * stored, so realtime can't broadcast it directly (ADR-009) — every
 * broadcast ping causes a re-call of get_wait_estimate(), which is
 * RLS/role-checked for this patient. See useQueueBroadcast for the
 * shared subscribe/debounce/reconnect mechanics (also used by
 * reception's queue view in Slice 4).
 */
export function QueueStatus({ entryId, serviceId, initialEstimate }: QueueStatusProps) {
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
        {/* Static placeholder — notifications land in Slice 6. */}
        <EmptyState
          headline="No updates yet"
          body="Notifications aren't live yet — coming in a later slice."
          fullWidth
        />
      </section>
    </div>
  )
}
