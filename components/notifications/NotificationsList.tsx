'use client'

import { useCallback, useEffect, useState } from 'react'
import { Bell } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useNotificationsRealtime } from '@/lib/hooks/useNotificationsRealtime'
import { markNotificationsRead } from '@/app/actions/notifications'
import { formatClinicDateTime, formatRelativeTime } from '@/lib/clinicTime'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import type { Notification, NotificationKind } from '@/lib/types/database.types'

type Filter = 'all' | 'appointments' | 'queue' | 'reminders'

const QUEUE_KINDS: string[] = ['queue_position', 'you_are_next', 'called', 'emergency_ahead'] satisfies NotificationKind[]
const APPOINTMENT_KINDS: string[] = ['appointment_cancelled', 'appointment_no_show'] satisfies NotificationKind[]
const REMINDER_KINDS: string[] = ['appointment_reminder'] satisfies NotificationKind[]

/** Figma: a coloured dot per type. Danger for anything that went wrong or jumped the queue. */
const KIND_DOT: Record<NotificationKind, string> = {
  queue_position: 'bg-primary-700',
  you_are_next: 'bg-primary-700',
  called: 'bg-primary-700',
  emergency_ahead: 'bg-danger',
  appointment_reminder: 'bg-muted',
  appointment_cancelled: 'bg-danger',
  appointment_no_show: 'bg-danger',
}

/** notifications.kind is text with a CHECK constraint; anything this file doesn't know yet gets a neutral dot, not a guessed meaning. */
function dotFor(kind: string) {
  return KIND_DOT[kind as NotificationKind] ?? 'bg-border'
}

const FILTERS: { key: Filter; label: string; match: (n: Notification) => boolean }[] = [
  { key: 'all', label: 'All', match: () => true },
  { key: 'appointments', label: 'Appointments', match: (n) => APPOINTMENT_KINDS.includes(n.kind) },
  { key: 'queue', label: 'Queue', match: (n) => QUEUE_KINDS.includes(n.kind) },
  { key: 'reminders', label: 'Reminders', match: (n) => REMINDER_KINDS.includes(n.kind) },
]

export function NotificationsList({ initialNotifications }: { initialNotifications: Notification[] }) {
  const [supabase] = useState(() => createClient())
  const [notifications, setNotifications] = useState<Notification[]>(initialNotifications)
  const [marking, setMarking] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')

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
        icon={<Bell size={32} />}
        headline="No notifications yet"
        body="You'll see updates about your queue and appointments here."
        fullWidth
      />
    )
  }

  const activeFilter = FILTERS.find((f) => f.key === filter)!
  const visible = notifications.filter(activeFilter.match)

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div role="tablist" aria-label="Filter notifications" className="flex flex-wrap gap-2">
          {FILTERS.map(({ key, label, match }) => {
            const active = key === filter
            const count = notifications.filter(match).length
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setFilter(key)}
                className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition-colors ${
                  active
                    ? 'border-primary-700 bg-primary-700 text-white'
                    : 'border-border bg-surface text-muted hover:border-primary-700 hover:text-primary-700'
                }`}
              >
                {label}
                <span className={`text-xs tabular ${active ? 'text-white' : 'text-muted'}`}>{count}</span>
              </button>
            )
          })}
        </div>
        {unreadCount > 0 && (
          <Button variant="tertiary" onClick={handleMarkAllRead} loading={marking}>
            Mark all read
          </Button>
        )}
      </div>

      {visible.length === 0 ? (
        <EmptyState
          headline="Nothing here yet"
          body="No notifications of this kind so far."
          fullWidth
        />
      ) : (
        <ul role="tabpanel" className="flex flex-col overflow-hidden rounded-lg border border-border bg-surface">
          {visible.map((n) => {
            const unread = !n.read_at
            return (
              <li
                key={n.id}
                className={`flex items-start gap-4 border-b border-border p-5 last:border-b-0 ${unread ? 'bg-card-mint' : ''}`}
              >
                <span className={`mt-2 h-3 w-3 shrink-0 rounded-full ${dotFor(n.kind)}`} aria-hidden />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex items-start justify-between gap-4">
                    <p className="text-base font-semibold text-ink">
                      {n.title}
                      <span className="sr-only">{unread ? ' (unread)' : ' (read)'}</span>
                    </p>
                    <time
                      dateTime={n.created_at}
                      title={formatClinicDateTime(n.created_at)}
                      className="shrink-0 text-xs text-muted"
                    >
                      {formatRelativeTime(n.created_at)}
                    </time>
                  </div>
                  {n.body && <p className="text-base text-ink">{n.body}</p>}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
