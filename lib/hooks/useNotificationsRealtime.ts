'use client'

import { useEffect, useId, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'

/**
 * postgres_changes, not broadcast — the opposite choice from
 * useQueueBroadcast, and deliberately so.
 *
 * queue_entries (Slice 2) needed broadcast because postgres_changes is
 * RLS-filtered per row: a patient's own RLS policy only lets them see
 * their own queue_entries row, so a postgres_changes subscription on
 * that table would never deliver the event that actually matters to
 * them — ANOTHER patient's row changing, which is what moves their
 * position. RLS was an obstacle there, worked around with a
 * content-free broadcast ping instead.
 *
 * notifications is the opposite shape: every row already belongs to
 * exactly one recipient by construction (the SECURITY DEFINER triggers
 * write recipient_id from the affected row, and RLS only lets a caller
 * SELECT their own). A postgres_changes subscription here delivers
 * exactly and only this patient's own notifications — RLS filtering
 * IS the desired behaviour, not something to route around. No
 * `private: true` channel config either: that's a broadcast-channel
 * concept, not applicable to postgres_changes, which relies on the
 * table's own RLS policy instead.
 *
 * No debounce, unlike useQueueBroadcast: notifications arrive one at a
 * time from discrete staff actions (a call, a cancellation), never in
 * the bursts a shared queue recalculation can produce, so there's no
 * thundering-herd to smooth over.
 */
export function useNotificationsRealtime(onChange: () => void | Promise<void>) {
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  })

  // BottomNav's unread badge and the /notifications list (and, on
  // /queue, RecentNotifications) can all be mounted at once, each
  // calling this hook independently. supabase-js keys channels by
  // name, and a second `.channel(sameName).on(...).subscribe()` while
  // the first is already subscribed throws ("cannot add postgres_changes
  // callbacks... after subscribe()") rather than sharing it — so every
  // instance needs its own uniquely-named channel, even though they're
  // all listening to the same table/event.
  const instanceId = useId()

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`notifications-own-changes-${instanceId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, () =>
        onChangeRef.current()
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [instanceId])
}
