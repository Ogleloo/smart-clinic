'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const DEBOUNCE_MS = 500

/**
 * Subscribes to the private 'queue-service:{serviceId}' broadcast
 * channel and calls `onChange` (debounced ~500ms) whenever the database
 * signals a change, plus once on every successful (re)connect — a
 * reconnect must re-derive from the database, never trust stale state.
 *
 * Broadcast, not postgres_changes: row-level Postgres Changes events are
 * RLS-filtered per row, so a caller would never be notified when
 * ANOTHER patient's row changes — exactly the event that changes
 * everyone else's position. A database trigger broadcasts a
 * content-free ping instead; this hook doesn't care what it's for,
 * only that something changed, which is what makes it reusable for
 * both the patient's own wait estimate (Slice 2) and reception's
 * per-service queue listing (Slice 4).
 *
 * `onChange` is read via a ref so passing a fresh inline callback each
 * render doesn't tear down and resubscribe the channel. The ref is
 * updated from its own effect (not during render) — mutating a ref
 * synchronously in the render body is no longer safe under the
 * stricter React Compiler purity rules this project lints against.
 */
export function useQueueBroadcast(serviceId: string, onChange: () => void | Promise<void>) {
  const [online, setOnline] = useState(true)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onChangeRef = useRef(onChange)

  useEffect(() => {
    onChangeRef.current = onChange
  })

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase.channel(`queue-service:${serviceId}`, {
      config: { private: true },
    })

    const scheduleRefresh = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => onChangeRef.current(), DEBOUNCE_MS)
    }

    channel
      .on('broadcast', { event: 'queue_changed' }, scheduleRefresh)
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setOnline(true)
          onChangeRef.current()
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setOnline(false)
        }
      })

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      supabase.removeChannel(channel)
    }
  }, [serviceId])

  return { online }
}
