'use client'

import { useState } from 'react'

interface WaitBreakdownProps {
  nursesServing: number
  patientsAhead: number
  averageMinutes: number
  soonestFreeMinutes: number
  estimatedWaitMinutes: number
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-base text-muted">{label}</span>
      <span className="font-mono text-sm font-semibold tabular-nums text-ink">{value}</span>
    </div>
  )
}

/**
 * "How is this calculated?" — collapsed by default, every number here
 * comes straight from the same get_wait_estimate() call that produced
 * the headline estimate (ADR-009); nothing is recomputed.
 *
 * The identity soonest_free + (ahead × average) ≈ estimate holds
 * exactly only for one nurse (see migration 0050) — each side is
 * rounded independently at the database layer (ceil for the wait
 * figures, round for the average), so the two can differ by a minute
 * even for a single nurse. That's why this renders "≈", never "=": the
 * displayed numbers are the real, honest inputs, not numbers picked to
 * make the arithmetic land exactly.
 *
 * Two or more nurses genuinely don't reduce to that formula — the queue
 * is assigned to whichever nurse frees soonest, which depends on each
 * nurse's individual remaining time, not a single shared countdown — so
 * showing an equation there would be false, not just approximate.
 */
export function WaitBreakdown({
  nursesServing,
  patientsAhead,
  averageMinutes,
  soonestFreeMinutes,
  estimatedWaitMinutes,
}: WaitBreakdownProps) {
  const [open, setOpen] = useState(false)
  const isSingleNurse = nursesServing === 1

  return (
    <div className="rounded-lg border border-border bg-surface">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-semibold text-primary-700"
      >
        How is this calculated?
        <span aria-hidden>{open ? '−' : '+'}</span>
      </button>

      {open && (
        <div className="flex flex-col gap-2 border-t border-border px-4 py-3">
          {isSingleNurse ? (
            <>
              <Row
                label="Current consultation finishing in"
                value={soonestFreeMinutes === 0 ? 'A nurse is free now' : `~${soonestFreeMinutes} min`}
              />
              <Row label="Patients ahead of you" value={String(patientsAhead)} />
              <Row label="Average consultation time" value={`${averageMinutes} min`} />
              <hr className="my-1 border-border" />
              <p className="font-mono text-sm font-semibold tabular-nums text-ink">
                {soonestFreeMinutes} + ({patientsAhead} &times; {averageMinutes} min) &asymp;{' '}
                {estimatedWaitMinutes} min
              </p>
            </>
          ) : (
            <>
              <Row label="Nurses serving this queue" value={String(nursesServing)} />
              <Row label="Patients ahead of you" value={String(patientsAhead)} />
              <Row label="Average consultation time" value={`${averageMinutes} min`} />
              <hr className="my-1 border-border" />
              <p className="text-base text-muted">
                We work out when each nurse becomes free, then work through the queue in order.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}
