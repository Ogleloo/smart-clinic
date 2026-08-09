'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { PublicQueueDisplay } from '@/lib/types/database.types'
import { ConfidenceChip, toConfidenceLevel } from '@/components/ui/ConfidenceChip'

const POLL_MS = 15_000

function relativeLabel(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (seconds < 10) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ago`
}

/**
 * Public waiting-room board (ADR-028). Polls get_public_queue_display
 * every 15s over plain request/response — NOT the broadcast channel
 * used elsewhere (useQueueBroadcast), which is configured private:true
 * and requires an authenticated session this unattended, unlogged-in
 * screen will never have.
 *
 * The "Updated" label is recomputed from a ticking clock, independent
 * of the poll cycle, specifically so a screen that has stopped
 * successfully fetching keeps visibly aging instead of looking current.
 * A failed poll keeps the last successful `display` as-is and only
 * flips `stale` — the board never blanks itself over a transient
 * network error.
 */
export function DisplayBoard({
  serviceId,
  initialDisplay,
}: {
  serviceId: string
  initialDisplay: PublicQueueDisplay
}) {
  const [supabase] = useState(() => createClient())
  const [display, setDisplay] = useState<PublicQueueDisplay>(initialDisplay)
  const [stale, setStale] = useState(false)
  const [, setClockTick] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setClockTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    let cancelled = false

    async function poll() {
      const { data, error } = await supabase
        .rpc('get_public_queue_display', { p_service_id: serviceId })
        .single()
      if (cancelled) return
      if (error || !data) {
        setStale(true)
      } else {
        setStale(false)
        setDisplay(data)
      }
    }

    const id = setInterval(poll, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [supabase, serviceId])

  const {
    service_name,
    now_serving_token,
    next_token,
    waiting_count,
    estimated_wait_minutes,
    confidence,
    is_being_served,
    updated_at,
  } = display

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-10 bg-paper px-10 py-16 text-center">
      <h1 className="font-display text-4xl font-bold tracking-wide text-ink sm:text-6xl">
        {service_name.toUpperCase()}
      </h1>

      <div className="flex flex-col items-center gap-3">
        <p className="text-2xl font-semibold tracking-wide text-muted sm:text-3xl">NOW SERVING</p>
        <p className="font-mono text-8xl font-bold tabular-nums text-primary-700 sm:text-9xl">
          {now_serving_token ?? '—'}
        </p>
      </div>

      <div className="flex flex-col items-center gap-2">
        <p className="text-xl font-semibold tracking-wide text-muted sm:text-2xl">NEXT</p>
        <p className="font-mono text-5xl font-bold tabular-nums text-ink sm:text-6xl">
          {next_token ?? '—'}
        </p>
      </div>

      <p className="text-3xl font-semibold text-ink sm:text-4xl">
        {waiting_count} waiting
      </p>

      {is_being_served ? (
        estimated_wait_minutes !== null && estimated_wait_minutes > 0 && (
          <div className="flex flex-wrap items-center justify-center gap-3">
            <span className="text-2xl font-semibold text-ink sm:text-3xl">
              Approx. wait: {estimated_wait_minutes} min
            </span>
            {confidence && <ConfidenceChip level={toConfidenceLevel(confidence)} />}
          </div>
        )
      ) : (
        <p className="text-2xl font-semibold text-muted sm:text-3xl">Not currently being served</p>
      )}

      <p className={`text-base font-semibold ${stale ? 'text-warning' : 'text-muted'}`}>
        Updated {relativeLabel(updated_at)}
        {stale ? ' — connection issue, showing last known values' : ''}
      </p>
    </main>
  )
}
