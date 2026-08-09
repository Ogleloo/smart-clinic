'use client'

import { useCallback, useState } from 'react'
import type { Notification } from '@/lib/types/database.types'
import { QueueEntryStatus, type QueueEntryData } from './QueueEntryStatus'
import { RecentNotifications } from './RecentNotifications'
import { OfflineBanner } from '@/components/ui/OfflineBanner'

interface QueueStatusProps {
  entries: QueueEntryData[]
  entryIds: string[]
  initialNotifications: Notification[]
}

/**
 * Orchestrates one card per active queue entry. A patient can legitimately
 * be in more than one queue at once (consultation, then pharmacy), so
 * this never collapses them into a single "your wait" figure — each
 * entry keeps its own position/estimate/confidence, exactly as
 * get_wait_estimate returned it. The in_progress entry (if any) is
 * surfaced first under "NOW BEING SERVED"; everything else follows under
 * "ALSO IN YOUR VISIT".
 */
export function QueueStatus({ entries, entryIds, initialNotifications }: QueueStatusProps) {
  const [offlineIds, setOfflineIds] = useState<Set<string>>(new Set())

  const handleOnlineChange = useCallback((entryId: string, online: boolean) => {
    setOfflineIds((prev) => {
      const next = new Set(prev)
      if (online) next.delete(entryId)
      else next.add(entryId)
      return next
    })
  }, [])

  const nowServing = entries.filter((e) => e.initialEstimate.status === 'in_progress')
  const alsoInVisit = entries.filter((e) => e.initialEstimate.status !== 'in_progress')

  return (
    <div className="flex flex-col gap-4">
      {offlineIds.size > 0 && <OfflineBanner fullWidth />}

      {nowServing.length > 0 && (
        <section className="flex flex-col gap-3">
          <p className="text-xs font-semibold tracking-wide text-muted">NOW BEING SERVED</p>
          {nowServing.map((entry) => (
            <QueueEntryStatus key={entry.entryId} {...entry} onOnlineChange={handleOnlineChange} />
          ))}
        </section>
      )}

      {alsoInVisit.length > 0 && (
        <section className="flex flex-col gap-3">
          {nowServing.length > 0 && (
            <p className="text-xs font-semibold tracking-wide text-muted">ALSO IN YOUR VISIT</p>
          )}
          {alsoInVisit.map((entry) => (
            <QueueEntryStatus key={entry.entryId} {...entry} onOnlineChange={handleOnlineChange} />
          ))}
        </section>
      )}

      <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
        <p className="text-xs font-semibold tracking-wide text-muted">RECENT UPDATES</p>
        <RecentNotifications queueEntryIds={entryIds} initialNotifications={initialNotifications} />
      </section>
    </div>
  )
}
