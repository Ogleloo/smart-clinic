'use client'

import { useCallback, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useNotificationsRealtime } from '@/lib/hooks/useNotificationsRealtime'
import { formatRelativeTime } from '@/lib/clinicTime'
import { EmptyState } from '@/components/ui/EmptyState'
import type { Notification } from '@/lib/types/database.types'

interface RecentNotificationsProps {
  queueEntryIds: string[]
  initialNotifications: Notification[]
}

/**
 * The real RECENT UPDATES section (Slice 6) — replaces the Slice 2 static
 * placeholder. Takes every active entry's id, not just one: a patient in
 * two queues at once should see updates from either here, not just
 * whichever entry happened to be "the" one.
 */
export function RecentNotifications({ queueEntryIds, initialNotifications }: RecentNotificationsProps) {
  const [supabase] = useState(() => createClient())
  const [notifications, setNotifications] = useState<Notification[]>(initialNotifications)

  const refresh = useCallback(async () => {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .in('queue_entry_id', queueEntryIds)
      .order('created_at', { ascending: false })
      .limit(3)
    if (!error && data) setNotifications(data)
  }, [supabase, queueEntryIds])

  useNotificationsRealtime(refresh)

  if (notifications.length === 0) {
    return (
      <EmptyState
        headline="No updates yet"
        body="You'll see updates here as your position changes."
        fullWidth
      />
    )
  }

  return (
    <ul className="flex flex-col gap-2">
      {notifications.map((n) => (
        <li key={n.id} className="rounded-lg border border-border bg-surface p-3">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-semibold text-ink">{n.title}</p>
            <span className="shrink-0 text-xs text-muted">{formatRelativeTime(n.created_at)}</span>
          </div>
          {n.body && <p className="mt-0.5 text-xs text-muted">{n.body}</p>}
        </li>
      ))}
    </ul>
  )
}
