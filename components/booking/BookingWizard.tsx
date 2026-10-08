'use client'

import { useActionState, useCallback, useEffect, useRef, useState } from 'react'
import { Check, Clock } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { bookAppointment, type ActionState } from '@/app/actions/appointments'
import { Button } from '@/components/ui/Button'
import { BookingCalendar } from '@/components/booking/BookingCalendar'
import { CLINIC_TIMEZONE, formatCalendarDate, todayInClinicTimezone } from '@/lib/clinicTime'
import { dayFullName, dayOfWeekForDate, hoursForDate } from '@/lib/clinicHours'
import type { ClinicHours } from '@/lib/types/database.types'

export interface BookableService {
  id: string
  name: string
  /** services.description — null for a service the clinic hasn't described, in which case nothing is shown. */
  description: string | null
}

interface Slot {
  slot_time: string
  is_taken: boolean
}

type Step = 1 | 2 | 3

const STEPS: { step: Step; label: string }[] = [
  { step: 1, label: 'Service' },
  { step: 2, label: 'Date & time' },
  { step: 3, label: 'Confirm' },
]

function formatSlotTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: CLINIC_TIMEZONE,
  })
}

function StepIndicator({ current }: { current: Step }) {
  return (
    <ol className="flex items-center gap-2" aria-label="Booking progress">
      {STEPS.map(({ step, label }, i) => {
        const done = step < current
        const active = step === current
        return (
          <li key={step} className="flex flex-1 items-center gap-2" aria-current={active ? 'step' : undefined}>
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                done || active ? 'bg-primary-700 text-white' : 'bg-subtle text-muted'
              }`}
            >
              {done ? <Check size={14} aria-hidden /> : step}
            </span>
            <span className={`text-sm font-semibold ${active ? 'text-ink' : 'text-muted'}`}>{label}</span>
            {i < STEPS.length - 1 && <span className="hidden h-px flex-1 bg-border sm:block" aria-hidden />}
          </li>
        )
      })}
    </ol>
  )
}

export function BookingWizard({
  services,
  clinicHours,
  clinicName,
}: {
  services: BookableService[]
  clinicHours: ClinicHours[]
  clinicName: string | null
}) {
  const [supabase] = useState(() => createClient())
  const [step, setStep] = useState<Step>(1)
  const [serviceId, setServiceId] = useState<string | null>(null)
  const [date, setDate] = useState(() => todayInClinicTimezone())
  const [slots, setSlots] = useState<Slot[] | null>(null)
  const [slotsLoading, setSlotsLoading] = useState(false)
  const [slotsError, setSlotsError] = useState<string | null>(null)
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null)
  const [state, formAction, pending] = useActionState<ActionState, FormData>(bookAppointment, {})
  // The action result that the patient has already moved past (by picking
  // a new slot and returning to Confirm) — its error shouldn't keep showing.
  const [acknowledgedState, setAcknowledgedState] = useState<ActionState | null>(null)
  const visibleError = state.error && state !== acknowledgedState ? state.error : null

  const selectedService = services.find((s) => s.id === serviceId) ?? null
  // A closed day still round-trips through get_available_slots (it
  // returns zero rows), but the reason matters to the person booking:
  // "closed" and "every slot already taken" both look like an empty
  // grid otherwise, and only one of them means "try a different service
  // or time instead of a different day".
  const isClosed = useCallback(
    (forDate: string) => hoursForDate(clinicHours, forDate)?.is_closed ?? false,
    [clinicHours]
  )
  const closedDay = isClosed(date)
  const fullyBooked = !!slots && slots.length > 0 && slots.every((s) => s.is_taken)

  // Selecting a service fires a fetch for the initial date, and picking
  // a date fires another — a user (or a fast test) can trigger both
  // within the same round trip. Without a sequence guard, whichever
  // response happens to resolve last wins even if it's answering an
  // earlier, now-superseded question, silently showing stale slots for
  // the wrong date.
  const latestRequestId = useRef(0)

  // Fetching slots always invalidates whatever was selected before —
  // clearing it here (rather than in the effect that triggers a refetch)
  // keeps every effect below free of direct setState calls; only the
  // async RPC callback updates state.
  const fetchSlots = useCallback(
    async (svcId: string, forDate: string) => {
      const requestId = ++latestRequestId.current
      setSelectedSlot(null)
      setSlotsLoading(true)
      setSlotsError(null)
      const { data, error } = await supabase.rpc('get_available_slots', {
        p_service_id: svcId,
        p_date: forDate,
      })
      if (requestId !== latestRequestId.current) return
      if (error) {
        setSlotsError(error.message)
        setSlots(null)
      } else {
        setSlots(data)
      }
      setSlotsLoading(false)
    },
    [supabase]
  )

  function goToDateStep() {
    if (!serviceId) return
    setStep(2)
    fetchSlots(serviceId, date)
  }

  function handleDateChange(newDate: string) {
    setDate(newDate)
    if (serviceId) fetchSlots(serviceId, newDate)
  }

  function goToConfirmStep() {
    if (!selectedSlot) return
    setAcknowledgedState(state)
    setStep(3)
  }

  // "That slot was just taken" means our grid is stale — send the
  // patient back to the time step and refresh it, so they pick from what
  // is actually still available instead of retrying an invalid slot.
  useEffect(() => {
    // Reacting to the server action's result, not a user event — an
    // effect is the correct place for this (react.dev/learn/you-might-not-need-an-effect#fetching-data).
    if (state.error && serviceId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStep(2)
      fetchSlots(serviceId, date)
    }
    // Depends on the whole `state` object, not state.error: two
    // separate failed bookings can produce the identical error string
    // ("That slot was just taken." is plausible twice in a row on a
    // busy day), and useActionState only guarantees a fresh object
    // reference per dispatch, not a fresh error message — keying on
    // the string would silently stop re-triggering the stale-grid
    // refresh after the first time that exact message appeared.
    // serviceId/date are deliberately excluded: those changes already
    // trigger a fetch via the step/date handlers above, so reacting
    // to them here too would double-fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  return (
    <div className="flex flex-col gap-6">
      <StepIndicator current={step} />

      {visibleError && (
        <p role="alert" className="rounded-lg bg-danger-bg px-4 py-3 text-sm font-semibold text-danger">
          {visibleError}
        </p>
      )}

      {step === 1 && (
        <section className="flex flex-col gap-4" aria-labelledby="step-service">
          <h2 id="step-service" className="font-display text-lg font-semibold text-ink">
            Which service do you need?
          </h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {services.map((service) => {
              const isSelected = service.id === serviceId
              return (
                <button
                  key={service.id}
                  type="button"
                  onClick={() => setServiceId(service.id)}
                  aria-pressed={isSelected}
                  className={`flex min-h-11 flex-col gap-1 rounded-lg border p-4 text-left transition-colors ${
                    isSelected
                      ? 'border-primary-700 bg-primary-50'
                      : 'border-border bg-surface hover:border-primary-700'
                  }`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className={`font-display text-base font-semibold ${isSelected ? 'text-primary-700' : 'text-ink'}`}>
                      {service.name}
                    </span>
                    {isSelected && <Check size={18} className="text-primary-700" aria-hidden />}
                  </span>
                  {service.description && <span className="text-sm text-muted">{service.description}</span>}
                </button>
              )
            })}
          </div>
          <div className="flex justify-end">
            <Button type="button" onClick={goToDateStep} disabled={!serviceId}>
              Continue
            </Button>
          </div>
        </section>
      )}

      {step === 2 && selectedService && (
        <section className="flex flex-col gap-4" aria-labelledby="step-time">
          <h2 id="step-time" className="font-display text-lg font-semibold text-ink">
            Pick a day and time for {selectedService.name}
          </h2>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <BookingCalendar
              value={date}
              min={todayInClinicTimezone()}
              onChange={handleDateChange}
              isClosed={isClosed}
            />

            <div className="flex flex-col gap-3">
              <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                <Clock size={16} aria-hidden />
                {formatCalendarDate(date, { weekday: 'long' })}
              </p>
              {slotsLoading ? (
                <p className="text-sm text-muted">Loading available times…</p>
              ) : slotsError ? (
                <p className="text-sm text-danger">Couldn&rsquo;t load times for that date. Try another date.</p>
              ) : closedDay ? (
                <p className="rounded-lg bg-subtle px-4 py-3 text-sm text-muted">
                  The clinic is closed on {dayFullName(dayOfWeekForDate(date))}s. Choose another day.
                </p>
              ) : fullyBooked ? (
                <p className="rounded-lg bg-warning-bg px-4 py-3 text-sm text-warning">
                  Fully booked for this date. Choose another day.
                </p>
              ) : slots && slots.length > 0 ? (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {slots.map((slot) => {
                    const isSelected = selectedSlot === slot.slot_time
                    return (
                      <button
                        key={slot.slot_time}
                        type="button"
                        disabled={slot.is_taken}
                        aria-pressed={isSelected}
                        onClick={() => setSelectedSlot(slot.slot_time)}
                        className={`min-h-11 rounded-md border px-2 py-2 text-center text-sm font-semibold tabular-nums transition-colors ${
                          slot.is_taken
                            ? 'cursor-not-allowed border-border bg-subtle text-muted line-through'
                            : isSelected
                              ? 'border-primary-700 bg-primary-700 text-white'
                              : 'border-border bg-surface text-ink hover:bg-subtle'
                        }`}
                      >
                        {formatSlotTime(slot.slot_time)}
                      </button>
                    )
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted">No times available on this date.</p>
              )}
            </div>
          </div>
          <div className="flex justify-between gap-3">
            <Button type="button" variant="tertiary" onClick={() => setStep(1)}>
              Back
            </Button>
            <Button type="button" onClick={goToConfirmStep} disabled={!selectedSlot}>
              Continue
            </Button>
          </div>
        </section>
      )}

      {step === 3 && selectedService && selectedSlot && (
        <section className="flex flex-col gap-4" aria-labelledby="step-confirm">
          <h2 id="step-confirm" className="font-display text-lg font-semibold text-ink">
            Confirm your appointment
          </h2>
          <form action={formAction} className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
            <input type="hidden" name="service_id" value={selectedService.id} />
            <input type="hidden" name="slot" value={selectedSlot} />
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs font-semibold tracking-wide text-muted">SERVICE</dt>
                <dd className="mt-0.5 font-semibold text-ink">{selectedService.name}</dd>
              </div>
              {clinicName && (
                <div>
                  <dt className="text-xs font-semibold tracking-wide text-muted">CLINIC</dt>
                  <dd className="mt-0.5 font-semibold text-ink">{clinicName}</dd>
                </div>
              )}
              <div>
                <dt className="text-xs font-semibold tracking-wide text-muted">DATE</dt>
                <dd className="mt-0.5 font-semibold text-ink">{formatCalendarDate(date, { weekday: 'long' })}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold tracking-wide text-muted">TIME</dt>
                <dd className="mt-0.5 font-semibold text-ink tabular">{formatSlotTime(selectedSlot)}</dd>
              </div>
            </dl>
            <p className="text-sm text-muted">
              You&rsquo;ll get a reference number as soon as this is booked.
            </p>
            <div className="flex flex-col-reverse justify-between gap-3 sm:flex-row">
              <Button type="button" variant="tertiary" onClick={() => setStep(2)} disabled={pending}>
                Back
              </Button>
              <Button type="submit" variant="primary" loading={pending}>
                Confirm booking
              </Button>
            </div>
          </form>
        </section>
      )}
    </div>
  )
}
