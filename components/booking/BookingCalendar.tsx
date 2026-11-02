'use client'

import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { formatCalendarDate } from '@/lib/clinicTime'

interface BookingCalendarProps {
  /** Selected YYYY-MM-DD. */
  value: string
  /** Earliest selectable YYYY-MM-DD — today in the clinic's timezone. */
  min: string
  onChange: (date: string) => void
  /** From clinic_hours. Closed days stay selectable so the "closed" message can explain why there are no times. */
  isClosed: (date: string) => boolean
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function toDateStr(year: number, monthIndex: number, day: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * Month grid, Monday first. Pure calendar arithmetic on YYYY-MM-DD
 * strings in UTC — a calendar date has no timezone, so nothing here can
 * shift a day depending on where the browser is.
 */
export function BookingCalendar({ value, min, onChange, isClosed }: BookingCalendarProps) {
  const [view, setView] = useState(() => ({
    year: Number(value.slice(0, 4)),
    month: Number(value.slice(5, 7)) - 1,
  }))

  const minYear = Number(min.slice(0, 4))
  const minMonth = Number(min.slice(5, 7)) - 1
  const atEarliestMonth = view.year < minYear || (view.year === minYear && view.month <= minMonth)

  const daysInMonth = new Date(Date.UTC(view.year, view.month + 1, 0)).getUTCDate()
  // getUTCDay: 0 = Sunday. Shift so Monday is column 0.
  const leadingBlanks = (new Date(Date.UTC(view.year, view.month, 1)).getUTCDay() + 6) % 7

  const monthLabel = new Date(Date.UTC(view.year, view.month, 1)).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })

  function shiftMonth(delta: number) {
    setView(({ year, month }) => {
      const next = new Date(Date.UTC(year, month + delta, 1))
      return { year: next.getUTCFullYear(), month: next.getUTCMonth() }
    })
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2 py-2">
        <button
          type="button"
          onClick={() => shiftMonth(-1)}
          disabled={atEarliestMonth}
          aria-label="Previous month"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-ink hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-30"
        >
          <ChevronLeft size={16} aria-hidden />
        </button>
        <p className="text-sm text-ink sm:text-base" aria-live="polite">
          {monthLabel}
        </p>
        <button
          type="button"
          onClick={() => shiftMonth(1)}
          aria-label="Next month"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-ink hover:bg-subtle"
        >
          <ChevronRight size={16} aria-hidden />
        </button>
      </div>

      {/*
        Each day cell is a fixed 44px square — the WCAG touch-target minimum, and (not coincidentally) what
        Figma's own cells already are (size-[40px], fixed — never a fluid stretched column). Seven of those
        plus gaps (332px) don't fit a 320px viewport once the step's own padding is subtracted, so this
        region — and only this region — scrolls horizontally; the page itself never gains an overflow. The
        weekday header row shares the exact same fixed column template and lives in the same scrollable
        element, so it scrolls in lockstep with the date grid and never drifts out of alignment with it.
      */}
      <div className="overflow-x-auto">
        <div className="grid w-fit grid-cols-[repeat(7,44px)] gap-1 text-center" aria-hidden>
          {WEEKDAYS.map((d) => (
            <span key={d} className="pb-1 text-xs text-muted">
              {d}
            </span>
          ))}
        </div>
        <div className="grid w-fit grid-cols-[repeat(7,44px)] gap-1 text-center">
          {Array.from({ length: leadingBlanks }, (_, i) => (
            <span key={`blank-${i}`} aria-hidden />
          ))}
          {Array.from({ length: daysInMonth }, (_, i) => {
            const day = i + 1
            const dateStr = toDateStr(view.year, view.month, day)
            const isPast = dateStr < min
            const closed = !isPast && isClosed(dateStr)
            const isSelected = dateStr === value
            const isToday = dateStr === min
            return (
              <button
                key={dateStr}
                type="button"
                data-date={dateStr}
                disabled={isPast}
                aria-pressed={isSelected}
                aria-label={`${formatCalendarDate(dateStr, { weekday: 'long' })}${closed ? ', clinic closed' : ''}`}
                onClick={() => onChange(dateStr)}
                className={`flex h-11 w-11 items-center justify-center rounded-md text-sm font-semibold tabular transition-colors ${
                  isSelected
                    ? 'bg-primary-700 text-white'
                    : isPast
                      ? 'cursor-not-allowed text-muted/40'
                      : closed
                        ? 'text-muted/60 line-through hover:bg-subtle'
                        : 'text-ink hover:bg-card-mint'
                } ${isToday && !isSelected ? 'ring-1 ring-primary-700' : ''}`}
              >
                {day}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
