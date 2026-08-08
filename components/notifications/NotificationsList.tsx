'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useNotificationsRealtime } from '@/lib/hooks/useNotificationsRealtime'
import { markNotificationsRead } from '@/app/actions/notifications'
import { formatRelativeTime } from '@/lib/clinicTime'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import type { Notification } from '@/lib/types/database.types'

export function NotificationsList({ initialNotifications }: { initialNotifications: Notification[] }) {
  const [supabase] = useState(() => createClient())
  const [notifications, setNotifications] = useState<Notification[]>(initialNotifications)
  const [marking, setMarking] = useState(false)

  const refresh = useCallback(async () => {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50)
    if (!error && data) setNotifications(data)
  }, [supabase])

  useNotificationsRealtime(refresh)

  // Mark-on-view: whatever's unread at first render gets marked read
  // once, automatically. Anything that arrives later via realtime while
  // this page stays open is deliberately NOT auto-marked — "Mark all
  // read" below covers those explicitly instead of silently consuming
  // something the patient may not have actually seen yet.
  useEffect(() => {
    const unreadIds = initialNotifications.filter((n) => !n.read_at).map((n) => n.id)
    if (unreadIds.length > 0) markNotificationsRead(unreadIds)
    // Intentionally only the ids present at first render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleMarkAllRead() {
    const unreadIds = notifications.filter((n) => !n.read_at).map((n) => n.id)
    if (unreadIds.length === 0) return
    setMarking(true)
    await markNotificationsRead(unreadIds)
    await refresh()
    setMarking(false)
  }

  const unreadCount = notifications.filter((n) => !n.read_at).length

  if (notifications.length === 0) {
    return (
      <EmptyState
        headline="No notifications yet"
        body="You'll see updates about your queue and appointments here."
        fullWidth
      />
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {unreadCount > 0 && (
        <div className="flex justify-end">
          <Button variant="tertiary" onClick={handleMarkAllRead} loading={marking}>
            Mark all read
          </Button>
        </div>
      )}
      <ul className="flex flex-col gap-2">
        {notifications.map((n) => (
          <li
            key={n.id}
            className={`rounded-lg border p-4 ${
              n.read_at ? 'border-border bg-surface' : 'border-primary-700 bg-primary-50'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-semibold text-ink">{n.title}</p>
              <span className="shrink-0 text-xs text-muted">{formatRelativeTime(n.created_at)}</span>
            </div>
            {n.body && <p className="mt-1 text-sm text-muted">{n.body}</p>}
          </li>
        ))}
      </ul>
    </div>
  )
}
