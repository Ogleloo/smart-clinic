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
  initialNowServingToken: string | null
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
 *
 * now_serving_token is refetched alongside the estimate on every
 * broadcast event, from the same get_public_queue_display call the
 * public display board uses — it isn't part of get_wait_estimate's own
 * return shape, so it can't come from that single call, but it's still
 * a live database read, never a client-side guess.
 */
export function QueueEntryStatus({
  entryId,
  serviceId,
  initialEstimate,
  initialNowServingToken,
  onOnlineChange,
}: QueueEntryStatusProps) {
  const [supabase] = useState(() => createClient())
  const [estimate, setEstimate] = useState<WaitEstimate>(initialEstimate)
  const [nowServingToken, setNowServingToken] = useState<string | null>(initialNowServingToken)

  const refresh = useCallback(async () => {
    const [estimateResult, displayResult] = await Promise.all([
      supabase.rpc('get_wait_estimate', { p_queue_entry_id: entryId }).single(),
      supabase.rpc('get_public_queue_display', { p_service_id: serviceId }).single(),
    ])
    if (!estimateResult.error && estimateResult.data) setEstimate(estimateResult.data)
    if (!displayResult.error && displayResult.data) {
      setNowServingToken(displayResult.data.now_serving_token)
    }
  }, [supabase, entryId, serviceId])

  const { online } = useQueueBroadcast(serviceId, refresh)

  useEffect(() => {
    onOnlineChange(entryId, online)
  }, [entryId, online, onOnlineChange])

  return <QueueStatusCard estimate={estimate} nowServingToken={nowServingToken} />
}
