'use client'

import { useActionState, useEffect, useState } from 'react'
import { updateClinicHours, type HoursFormState } from '@/app/actions/admin'
import { Button } from '@/components/ui/Button'
import type { ClinicHours } from '@/lib/types/database.types'

// day_of_week follows Postgres extract(dow): 0 = Sunday .. 6 = Saturday
// (migration 0052). Rows are displayed Monday-first, matching the
// landing-page footer's own ordering, not the database's own numbering.
const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const
const DAY_LABEL: Record<number, string> = {
  0: 'Sunday',
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
}

function formatHM(time: string | null): string {
  return time ? time.slice(0, 5) : ''
}

export function OpeningHoursForm({ hours }: { hours: ClinicHours[] }) {
  const byDay = new Map(hours.map((h) => [h.day_of_week, h]))
  const [state, formAction, pending] = useActionState<HoursFormState, FormData>(updateClinicHours, {})
  const [showSaved, setShowSaved] = useState(false)
  // One entry per day, seeded from the current row (or a sensible
  // default for a day never configured) — the closed toggle needs live
  // client state so it can grey out that row's time inputs immediately.
  const [closed, setClosed] = useState<Record<number, boolean>>(() =>
    Object.fromEntries(DISPLAY_ORDER.map((d) => [d, byDay.get(d)?.is_closed ?? false]))
  )

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!state.success) return
    setShowSaved(true)
    const timer = setTimeout(() => setShowSaved(false), 3000)
    return () => clearTimeout(timer)
  }, [state])
  /* eslint-enable react-hooks/set-state-in-effect */

  return (
    <form action={formAction} className="flex flex-col gap-3">
      {DISPLAY_ORDER.map((day) => {
        const row = byDay.get(day)
        const isClosed = closed[day]
        return (
          <div
            key={day}
            className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <p className="w-24 shrink-0 text-sm font-semibold text-ink">{DAY_LABEL[day]}</p>

            <label className="flex items-center gap-2 text-sm text-muted">
              <input
                type="checkbox"
                checked={isClosed}
                onChange={(e) => setClosed((prev) => ({ ...prev, [day]: e.target.checked }))}
                className="h-4 w-4"
              />
              Closed
              <input type="hidden" name={`day_${day}_closed`} value={isClosed ? 'true' : 'false'} />
            </label>

            <div className="flex items-center gap-2">
              <input
                type="time"
                name={`day_${day}_opens`}
                defaultValue={formatHM(row?.opens_at ?? null)}
                disabled={isClosed}
                className="min-h-11 w-32 rounded-lg border border-border bg-surface px-3 text-[15px] text-ink disabled:cursor-not-allowed disabled:bg-subtle disabled:text-muted"
              />
              <span className="text-muted">&ndash;</span>
              <input
                type="time"
                name={`day_${day}_closes`}
                defaultValue={formatHM(row?.closes_at ?? null)}
                disabled={isClosed}
                className="min-h-11 w-32 rounded-lg border border-border bg-surface px-3 text-[15px] text-ink disabled:cursor-not-allowed disabled:bg-subtle disabled:text-muted"
              />
            </div>
          </div>
        )
      })}

      {state.error && (
        <p role="alert" className="text-sm font-semibold text-danger">
          {state.error}
        </p>
      )}
      {showSaved && (
        <p role="status" className="text-sm font-semibold text-success">
          Saved.
        </p>
      )}

      <Button type="submit" variant="primary" loading={pending}>
        Save opening hours
      </Button>
    </form>
  )
}
