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
 * Starting a session and switching service share this one form/action —
 * a bare on/off toggle can't also carry "which service" when starting,
 * and would force ending a session before switching while staying on.
 *
 * Ending a session lives in EndSessionControl, not here — "session"
 * (not "shift") because a nurse uses this for a lunch break as much as
 * end of day, and it needs to be visible wherever the nurse actually is
 * during the day (next to Next patient), not buried in this panel they
 * only touch once at the start of it.
 */
export function DutyControl({ services, isOnDuty, currentServiceId }: DutyControlProps) {
  const [state, formAction, pending] = useActionState<DutyState, FormData>(setDuty, {})

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
      <p className="text-xs font-semibold tracking-wide text-muted">DUTY STATUS</p>

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
          {isOnDuty ? 'Switch service' : 'Start session'}
        </Button>
      </form>

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
