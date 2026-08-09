'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { WaitEstimate } from '@/lib/types/database.types'
import { useQueueBroadcast } from '@/lib/hooks/useQueueBroadcast'
import { QueueStatusCard } from './QueueStatusCard'

export interface QueueEntryData {
  entryId: string
  serviceId: string
  initialEstimate: WaitEstimate
}

interface QueueEntryStatusProps extends QueueEntryData {
  onOnlineChange: (entryId: string, online: boolean) => void
}

/**
 * One active queue entry's live card. A patient can hold more than one
 * entry at once (ADR-009 doesn't change — each entry is still its own
 * queue), so this is split out from QueueStatus specifically so each
 * entry gets its own useQueueBroadcast subscription, scoped to its own
 * service. Hooks can't be called a variable number of times in one
 * component, so one entry per component instance is what lets the list
 * grow or shrink between renders without breaking the rules of hooks.
 */
export function QueueEntryStatus({ entryId, serviceId, initialEstimate, onOnlineChange }: QueueEntryStatusProps) {
  const [supabase] = useState(() => createClient())
  const [estimate, setEstimate] = useState<WaitEstimate>(initialEstimate)

  const refresh = useCallback(async () => {
    const { data, error } = await supabase
      .rpc('get_wait_estimate', { p_queue_entry_id: entryId })
      .single()
    if (!error && data) setEstimate(data)
  }, [supabase, entryId])

  const { online } = useQueueBroadcast(serviceId, refresh)

  useEffect(() => {
    onOnlineChange(entryId, online)
  }, [entryId, online, onOnlineChange])

  return <QueueStatusCard estimate={estimate} />
}
