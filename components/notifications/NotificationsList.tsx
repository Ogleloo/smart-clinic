'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Bell,
  BellRing,
  CalendarClock,
  CalendarX,
  ListOrdered,
  Megaphone,
  Siren,
  UserX,
  type LucideIcon,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useNotificationsRealtime } from '@/lib/hooks/useNotificationsRealtime'
import { markNotificationsRead } from '@/app/actions/notifications'
import { formatClinicDateTime, formatRelativeTime } from '@/lib/clinicTime'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import type { Notification, NotificationKind } from '@/lib/types/database.types'

type Filter = 'all' | 'unread' | 'queue' | 'appointments'

const QUEUE_KINDS: string[] = ['queue_position', 'you_are_next', 'called', 'emergency_ahead'] satisfies NotificationKind[]
const APPOINTMENT_KINDS: string[] = [
  'appointment_reminder',
  'appointment_cancelled',
  'appointment_no_show',
] satisfies NotificationKind[]

const KIND_STYLE: Record<NotificationKind, { icon: LucideIcon; tone: string }> = {
  queue_position: { icon: ListOrdered, tone: 'bg-primary-50 text-primary-700' },
  you_are_next: { icon: BellRing, tone: 'bg-primary-50 text-primary-700' },
  called: { icon: Megaphone, tone: 'bg-success-bg text-success' },
  emergency_ahead: { icon: Siren, tone: 'bg-danger-bg text-danger' },
  appointment_reminder: { icon: CalendarClock, tone: 'bg-primary-50 text-primary-700' },
  appointment_cancelled: { icon: CalendarX, tone: 'bg-subtle text-muted' },
  appointment_no_show: { icon: UserX, tone: 'bg-warning-bg text-warning' },
}

/** notifications.kind is text with a CHECK constraint; anything this file doesn't know yet gets a plain bell, not a guessed meaning. */
function styleFor(kind: string) {
  return KIND_STYLE[kind as NotificationKind] ?? { icon: Bell, tone: 'bg-subtle text-muted' }
}

const FILTERS: { key: Filter; label: string; match: (n: Notification) => boolean }[] = [
  { key: 'all', label: 'All', match: () => true },
  { key: 'unread', label: 'Unread', match: (n) => !n.read_at },
  { key: 'queue', label: 'Queue', match: (n) => QUEUE_KINDS.includes(n.kind) },
  { key: 'appointments', label: 'Appointments', match: (n) => APPOINTMENT_KINDS.includes(n.kind) },
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
        icon={<Bell size={28} />}
        headline="No notifications yet"
        body="You'll see updates about your queue and appointments here."
        fullWidth
      />
    )
  }

  const activeFilter = FILTERS.find((f) => f.key === filter)!
  const visible = notifications.filter(activeFilter.match)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
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
                    : 'border-border bg-surface text-ink hover:border-primary-700'
                }`}
              >
                {label}
                <span className={`text-xs tabular ${active ? 'text-white/80' : 'text-muted'}`}>{count}</span>
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
          headline={filter === 'unread' ? 'You’re all caught up' : 'Nothing here yet'}
          body={filter === 'unread' ? 'There are no unread notifications.' : 'No notifications of this kind so far.'}
          fullWidth
        />
      ) : (
        <ul role="tabpanel" className="flex flex-col gap-2">
          {visible.map((n) => {
            const { icon: Icon, tone } = styleFor(n.kind)
            const unread = !n.read_at
            return (
              <li
                key={n.id}
                className={`flex items-start gap-3 rounded-lg border p-4 ${
                  unread ? 'border-primary-700 bg-primary-50' : 'border-border bg-surface'
                }`}
              >
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${tone}`}>
                  <Icon size={18} aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                      {unread && <span className="h-2 w-2 shrink-0 rounded-full bg-primary-700" aria-hidden />}
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
                  {n.body && <p className="mt-1 text-sm text-muted">{n.body}</p>}
                  <p className="mt-1 text-xs text-muted tabular">{formatClinicDateTime(n.created_at)}</p>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
