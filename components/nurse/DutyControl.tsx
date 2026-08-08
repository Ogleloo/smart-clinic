'use client'

import { useActionState } from 'react'
import { setDuty, type DutyState } from '@/app/actions/nurse'
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

/**
 * Two separate small forms sharing one action, not a single toggle: a
 * bare on/off switch can't also carry "which service" when going on
 * duty, and forces going off duty before switching service while
 * staying on. Both forms post to the same setDuty action; `pending`
 * reflects whichever is in flight.
 */
export function DutyControl({ services, isOnDuty, currentServiceId }: DutyControlProps) {
  const [state, formAction, pending] = useActionState<DutyState, FormData>(setDuty, {})

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

        {isOnDuty && (
          <form action={formAction}>
            <input type="hidden" name="on_duty" value="false" />
            <Button type="submit" variant="tertiary" loading={pending}>
              Go off duty
            </Button>
          </form>
        )}
      </div>

      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
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
