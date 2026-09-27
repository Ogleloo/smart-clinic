'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { PublicQueueDisplay } from '@/lib/types/database.types'
import { CLINIC_TIMEZONE } from '@/lib/clinicTime'

const POLL_MS = 15_000

function clockLabel(now: Date): string {
  return now.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: CLINIC_TIMEZONE,
  })
}

/**
 * The single real "up next" identity (next_token) plus however many more
 * are waiting beyond it — get_public_queue_display only ever returns one
 * specific upcoming token, never a full list, so anything past the first
 * box is a count, never a guessed token. Guessing (next_token + 1, +2…)
 * would be wrong the moment an emergency reorders the queue or a walk-in
 * is inserted out of token-number order, and this screen is read by an
 * entire waiting room at once — a wrong guess here is a public one.
 */
function UpNext({ nextToken, waitingCount }: { nextToken: string | null; waitingCount: number }) {
  if (!nextToken || waitingCount === 0) return null
  const moreCount = waitingCount - 1

  return (
    <div className="flex flex-col items-center gap-[clamp(6px,0.7vw,12px)]">
      <p className="text-[clamp(12px,1vw,18px)] font-semibold uppercase tracking-wide text-primary-100">
        Up next
      </p>
      <div className="flex items-center gap-[clamp(8px,0.9vw,16px)]">
        <div className="rounded-[clamp(8px,0.8vw,14px)] bg-primary-700 px-[clamp(14px,1.6vw,28px)] py-[clamp(8px,1vw,18px)]">
          <p className="font-mono text-[clamp(24px,2.5vw,48px)] font-bold tabular-nums text-white">
            {nextToken}
          </p>
        </div>
        {moreCount > 0 && (
          <div className="rounded-[clamp(8px,0.8vw,14px)] bg-primary-700/40 px-[clamp(14px,1.6vw,28px)] py-[clamp(8px,1vw,18px)]">
            <p className="font-mono text-[clamp(18px,1.8vw,34px)] font-semibold tabular-nums text-primary-100">
              +{moreCount}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Public waiting-room board (ADR-028). Read from across a room on a
 * wall-mounted TV — not a dashboard, so type here is deliberately far
 * larger than anywhere else in the app. Sized with vw-based clamps
 * rather than breakpoints: 1280x720 and 1920x1080 are the same 16:9
 * ratio (exactly 2/3 scale), so proportional-to-viewport-width sizing
 * scales the whole layout identically between them with nothing to
 * "break" — the clamp floors only matter for a dev-time browser window
 * narrower than either target.
 *
 * Polls get_public_queue_display every 15s over plain request/response
 * — NOT the broadcast channel used elsewhere (useQueueBroadcast), which
 * is configured private:true and requires an authenticated session this
 * unattended, unlogged-in screen will never have.
 */
export function DisplayBoard({ initialDisplay }: { initialDisplay: PublicQueueDisplay }) {
  const [supabase] = useState(() => createClient())
  const [display, setDisplay] = useState<PublicQueueDisplay>(initialDisplay)
  // A re-render trigger, not the clock's own value — the clock is read
  // fresh from Date.now() at render time (see clockLabel below), the
  // same pattern this file already used for "Updated Xs ago" before
  // this rewrite. Storing a Date in state and setting it from an effect
  // body trips react-hooks/set-state-in-effect for no benefit: nothing
  // here needs the Date to persist across renders, only the ticking.
  const [, setClockTick] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setClockTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    let cancelled = false

    async function poll() {
      const { data, error } = await supabase
        .rpc('get_public_queue_display', { p_service_id: display.service_id })
        .single()
      if (cancelled || error || !data) return
      setDisplay(data)
    }

    const id = setInterval(poll, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [supabase, display.service_id])

  const {
    service_name,
    now_serving_token,
    next_token,
    waiting_count,
    estimated_wait_minutes,
    is_being_served,
  } = display

  return (
    <main className="flex h-dvh w-dvw flex-col justify-between overflow-hidden bg-primary-900 px-[clamp(24px,3vw,56px)] py-[clamp(16px,2vw,36px)] text-white">
      {/* Header: clinic name small, service name large, clock top-right */}
      <header className="flex items-start justify-between">
        <div>
          <p className="text-[clamp(14px,1.05vw,20px)] font-semibold text-primary-100">
            Riverside Clinic
          </p>
          <h1 className="font-display text-[clamp(28px,2.9vw,56px)] font-bold uppercase tracking-wide text-white">
            {service_name}
          </h1>
        </div>
        <p className="font-mono text-[clamp(16px,1.45vw,28px)] font-semibold tabular-nums text-primary-100">
          {clockLabel(new Date())}
        </p>
      </header>

      {/* Main: the token (or the not-being-served message) is the point of this screen */}
      <div className="flex flex-1 flex-col items-center justify-center gap-[clamp(12px,1.6vw,28px)]">
        {is_being_served ? (
          <>
            <p className="text-[clamp(16px,1.45vw,28px)] font-semibold uppercase tracking-[0.2em] text-primary-100">
              Now serving
            </p>
            <p className="font-mono text-[clamp(64px,8.75vw,168px)] font-bold leading-none tabular-nums text-white">
              {now_serving_token}
            </p>
            <p className="rounded-full bg-primary-50 px-[clamp(20px,2vw,36px)] py-[clamp(8px,1vw,18px)] text-[clamp(16px,1.45vw,28px)] font-semibold text-primary-900">
              Please proceed to {service_name}
            </p>
          </>
        ) : (
          <>
            <p className="rounded-full bg-warning-bg px-[clamp(20px,2vw,36px)] py-[clamp(8px,1vw,18px)] text-[clamp(16px,1.45vw,28px)] font-bold uppercase tracking-wide text-warning">
              Not currently being served
            </p>
            <p className="max-w-[70vw] text-[clamp(18px,1.6vw,30px)] font-semibold text-white">
              No nurse is on duty for this service at the moment.
            </p>
            <p className="max-w-[70vw] text-[clamp(16px,1.4vw,26px)] text-primary-100">
              Please speak to reception &middot; You keep your place in the queue
            </p>
          </>
        )}

        <UpNext nextToken={next_token} waitingCount={waiting_count} />
      </div>

      {/* Footer bar */}
      <footer className="flex items-center justify-between border-t border-primary-700 pt-[clamp(10px,1.2vw,20px)] text-[clamp(14px,1.25vw,24px)] font-semibold text-primary-100">
        <p>
          {waiting_count} waiting
          {is_being_served ? (
            estimated_wait_minutes !== null && estimated_wait_minutes > 0 ? (
              <> &middot; approx. {estimated_wait_minutes} min</>
            ) : null
          ) : (
            <> &middot; no estimate available</>
          )}
        </p>
        {is_being_served && now_serving_token && <p>Last called: {now_serving_token}</p>}
      </footer>
    </main>
  )
}
