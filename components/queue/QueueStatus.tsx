'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { WaitEstimate } from '@/lib/types/database.types'
import { QueueStatusCard } from './QueueStatusCard'
import { OfflineBanner } from '@/components/ui/OfflineBanner'

const DEBOUNCE_MS = 500

interface QueueStatusProps {
  entryId: string
  serviceId: string
  initialEstimate: WaitEstimate
}

/**
 * Live wrapper around QueueToken.
 *
 * The estimate is computed, not stored, so Realtime can't broadcast it
 * directly (ADR-009). Instead a database trigger sends a content-free
 * "queue-service:<id> changed" ping — see migration
 * queue_broadcast_from_database — and every ping causes this component to
 * re-call get_wait_estimate() itself, which is RLS/role-checked for this
 * patient. Bursts of pings (e.g. several check-ins at once) are debounced
 * into a single refetch.
 */
export function QueueStatus({ entryId, serviceId, initialEstimate }: QueueStatusProps) {
  const [supabase] = useState(() => createClient())
  const [estimate, setEstimate] = useState<WaitEstimate>(initialEstimate)
  const [online, setOnline] = useState(true)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refresh = useCallback(async () => {
    const { data, error } = await supabase
      .rpc('get_wait_estimate', { p_queue_entry_id: entryId })
      .single()
    if (!error && data) setEstimate(data)
  }, [supabase, entryId])

  const scheduleRefresh = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(refresh, DEBOUNCE_MS)
  }, [refresh])

  useEffect(() => {
    const channel = supabase.channel(`queue-service:${serviceId}`, {
      config: { private: true },
    })

    channel
      .on('broadcast', { event: 'queue_changed' }, () => {
        scheduleRefresh()
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setOnline(true)
          // Reconnects (including the first connect) re-derive from the
          // database rather than trusting whatever local state we had.
          refresh()
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setOnline(false)
        }
      })

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      supabase.removeChannel(channel)
    }
  }, [supabase, serviceId, scheduleRefresh, refresh])

  return (
    <div className="flex flex-col gap-3">
      {!online && <OfflineBanner fullWidth />}
      <QueueStatusCard estimate={estimate} />
    </div>
  )
}
