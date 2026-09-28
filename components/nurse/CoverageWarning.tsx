'use client'

import { useCallback, useEffect, useState } from 'react'
import { checkEndSessionImpact, type EndSessionImpact } from '@/app/actions/nurse'
import { useQueueBroadcast } from '@/lib/hooks/useQueueBroadcast'

/**
 * Ambient, not click-triggered: EndSessionControl's own CONFIRMING step
 * already re-checks this fresh at the moment a nurse actually tries to
 * end their session — that stays the real safety gate. This card exists
 * so the nurse learns the stakes *before* they reach for that button,
 * not only when they're already mid-click.
 *
 * Refreshes on the same queue broadcast WaitingList subscribes to (a
 * second nurse's own duty change doesn't fire it — an accepted gap,
 * since a fresh check still runs at the actual point of ending).
 */
export function CoverageWarning({ serviceId }: { serviceId: string }) {
  const [impact, setImpact] = useState<EndSessionImpact>(null)

  const refresh = useCallback(async () => {
    const { impact: next } = await checkEndSessionImpact(serviceId)
    setImpact(next)
  }, [serviceId])

  useQueueBroadcast(serviceId, refresh)

  // useQueueBroadcast already calls refresh() on every successful
  // (re)connect, but not before the socket handshake completes —
  // running it once more directly on mount means the first paint after
  // navigating here doesn't wait on that round trip.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    refresh()
  }, [refresh])
  /* eslint-enable react-hooks/set-state-in-effect */

  if (!impact) return null

  return (
    <section role="status" className="rounded-lg border border-warning bg-warning-bg p-4 text-sm text-ink">
      <p>
        You are the only nurse on this queue. If you end your session, the {impact.waitingCount}{' '}
        waiting patient{impact.waitingCount === 1 ? '' : 's'} will see &ldquo;Not currently being
        served&rdquo; instead of an estimated wait.
      </p>
    </section>
  )
}
