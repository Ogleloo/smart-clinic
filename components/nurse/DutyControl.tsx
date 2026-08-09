'use client'

import { useActionState, useState } from 'react'
import { useRouter } from 'next/navigation'
import { setDuty, endShift, type DutyState, type LongDecision } from '@/app/actions/nurse'
import { Button } from '@/components/ui/Button'

interface Service {
  id: string
  name: string
}

interface DutyControlProps {
  services: Service[]
  isOnDuty: boolean
  currentServiceId: string | null
}

type EndShiftFlow =
  | { kind: 'NONE' }
  | { kind: 'SUBMITTING' }
  | { kind: 'NEEDS_LONG_DECISION'; durationMinutes: number; thresholdMinutes: number }

/**
 * Two separate small forms sharing one action, not a single toggle: a
 * bare on/off switch can't also carry "which service" when going on
 * duty, and forces going off duty before switching service while
 * staying on. Both "go on duty" forms post to setDuty; `pending`
 * reflects whichever is in flight.
 *
 * "End shift" (going off duty) is deliberately NOT part of that same
 * setDuty action — it now goes through end_shift, which closes any
 * open consultation first (with the same long-consultation guard as
 * next_patient) before flipping is_on_duty. end_shift takes no
 * action_id: it isn't part of the nurse_actions ledger, because its own
 * guard (only close a consultation whose ended_at is still null) is
 * already safe against a duplicate call.
 */
export function DutyControl({ services, isOnDuty, currentServiceId }: DutyControlProps) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState<DutyState, FormData>(setDuty, {})
  const [endShiftFlow, setEndShiftFlow] = useState<EndShiftFlow>({ kind: 'NONE' })
  const [endShiftError, setEndShiftError] = useState<string | null>(null)

  async function handleEndShift(longDecision?: LongDecision) {
    setEndShiftError(null)
    setEndShiftFlow({ kind: 'SUBMITTING' })
    const { data, error } = await endShift(longDecision)

    if (error) {
      setEndShiftError(error)
      setEndShiftFlow({ kind: 'NONE' })
      return
    }

    if (data!.status === 'long_consultation') {
      setEndShiftFlow({
        kind: 'NEEDS_LONG_DECISION',
        durationMinutes: data!.duration_minutes,
        thresholdMinutes: data!.threshold_minutes,
      })
      return
    }

    // status === 'shift_ended'. revalidatePath ran server-side, but that
    // alone only invalidates the cache — it doesn't push a fresh render
    // to an already-mounted page for an action invoked as a plain
    // function call (that auto-refresh is part of useActionState/form
    // dispatch, which this isn't). router.refresh() re-runs the Server
    // Component with fresh data so isOnDuty actually flips here.
    setEndShiftFlow({ kind: 'NONE' })
    router.refresh()
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
      <p className="text-xs font-semibold tracking-wide text-muted">DUTY STATUS</p>

      <div className="flex flex-wrap items-end gap-3">
        <form action={formAction} className="flex items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="duty-service" className="text-[13px] font-semibold text-muted">
              Service
            </label>
            <select
              id="duty-service"
              name="service_id"
              required
              defaultValue={currentServiceId ?? ''}
              className="min-h-11 rounded-lg border border-border bg-surface px-3 text-[15px] text-ink"
            >
              <option value="" disabled>
                Choose a service…
              </option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <input type="hidden" name="on_duty" value="true" />
          <Button type="submit" variant="primary" loading={pending}>
            {isOnDuty ? 'Switch service' : 'Go on duty'}
          </Button>
        </form>

        {isOnDuty && endShiftFlow.kind !== 'NEEDS_LONG_DECISION' && (
          <Button
            variant="tertiary"
            loading={endShiftFlow.kind === 'SUBMITTING'}
            onClick={() => handleEndShift()}
          >
            End shift
          </Button>
        )}
      </div>

      {endShiftFlow.kind === 'NEEDS_LONG_DECISION' && (
        <div className="flex flex-col gap-2 rounded-lg border border-warning bg-warning-bg p-3">
          <p className="text-sm font-semibold text-ink">
            This consultation has been open for {Math.round(endShiftFlow.durationMinutes)} minutes. Was
            this continuous patient care?
          </p>
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => handleEndShift('record')}>
              Record {Math.round(endShiftFlow.durationMinutes)} min
            </Button>
            <Button variant="tertiary" onClick={() => handleEndShift('break')}>
              Break occurred
            </Button>
          </div>
        </div>
      )}

      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
      {endShiftError && (
        <p role="alert" className="text-sm text-danger">
          {endShiftError}
        </p>
      )}

      <p className="text-sm text-muted">
        {isOnDuty
          ? 'You are counted as available for this service — patients see a live wait estimate based on your presence.'
          : 'You are off duty and not counted as available — patients on this service see "Not currently being served" instead of a wait estimate.'}
      </p>
    </section>
  )
}
