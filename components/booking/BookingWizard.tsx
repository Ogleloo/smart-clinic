'use client'

import { useActionState, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, Calendar, Check, Clock, Info, MapPin, Pencil, Stethoscope } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { bookAppointment, type ActionState } from '@/app/actions/appointments'
import { Button } from '@/components/ui/Button'
import { LinkButton } from '@/components/ui/LinkButton'
import { BookingCalendar } from '@/components/booking/BookingCalendar'
import { TYPE } from '@/components/patient/PageHeader'
import { formatCalendarDate, formatClinicTime, todayInClinicTimezone } from '@/lib/clinicTime'
import { dayFullName, dayOfWeekForDate, hoursForDate } from '@/lib/clinicHours'
import { BEFORE_VISIT_CHECKLIST } from '@/lib/beforeVisitChecklist'
import type { PatientClinic } from '@/lib/patientClinic'

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
  { step: 2, label: 'Date & Time' },
  { step: 3, label: 'Confirm' },
]

/** Figma: three circles joined by a line — done teal-filled with a check, current teal-filled with its number, upcoming grey-filled with a muted number. */
function StepIndicator({ current }: { current: Step }) {
  return (
    <ol className="flex items-start" aria-label="Booking progress">
      {STEPS.map(({ step, label }, i) => {
        const done = step < current
        const active = step === current
        return (
          <li
            key={step}
            className="relative flex flex-1 flex-col items-center gap-2"
            aria-current={active ? 'step' : undefined}
          >
            {i > 0 && (
              <span
                className={`absolute right-1/2 top-5 h-0.5 w-full -translate-y-1/2 ${step <= current ? 'bg-primary-700' : 'bg-border'}`}
                aria-hidden
              />
            )}
            <span
              className={`relative z-10 flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold ${
                done || active ? 'bg-primary-700 text-white' : 'bg-border text-muted'
              }`}
            >
              {done ? <Check size={20} aria-hidden /> : step}
            </span>
            <span className={`text-sm font-semibold ${done ? 'text-primary-700' : active ? 'text-ink' : 'text-muted'}`}>{label}</span>
          </li>
        )
      })}
    </ol>
  )
}

/** Card-level header (Figma "Card-Header-Info"): a small circle tag, an uppercase eyebrow, the step title and its subtitle. Its own h2 is what each step's section is labelled by — no separate hidden heading needed. */
function StepHeader({ id, eyebrow, title, subtitle }: { id: string; eyebrow: string; title: string; subtitle: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span className="h-8 w-8 shrink-0 rounded-full bg-primary-700" aria-hidden />
        <span className="text-[13px] font-semibold uppercase tracking-wide text-muted">{eyebrow}</span>
      </div>
      <div className="flex flex-col gap-1">
        <h2 id={id} className={TYPE.pageTitle}>
          {title}
        </h2>
        <p className="text-base text-muted">{subtitle}</p>
      </div>
    </div>
  )
}

const ICON_BADGE = 'flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full'
const CHANGE_BUTTON = 'inline-flex h-10 shrink-0 items-center gap-2 rounded-md border-[1.5px] border-primary-700 bg-surface px-4 text-sm font-semibold text-primary-700 hover:bg-primary-50'

export function BookingWizard({
  services,
  clinic,
}: {
  services: BookableService[]
  clinic: PatientClinic | null
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
    (forDate: string) => hoursForDate(clinic?.hours ?? [], forDate)?.is_closed ?? false,
    [clinic]
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
      // A query-level failure comes back as { error } below; a true network exception (offline, DNS, a
      // dropped connection) throws instead — without this catch it would leave slotsLoading stuck true
      // forever (an infinite "Loading available times…" with no way to recover) rather than a message with
      // a way to try again.
      try {
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
      } catch (e) {
        if (requestId !== latestRequestId.current) return
        setSlotsError(e instanceof Error ? e.message : 'Something went wrong.')
        setSlots(null)
      }
      if (requestId === latestRequestId.current) setSlotsLoading(false)
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

  // Backward navigation never re-validates or clears a prior selection — the service, date and slot already
  // chosen stay exactly as they were until the patient actively changes them, matching "without losing valid
  // selections unnecessarily". Picking a new service/date and moving forward again already refetches slots
  // (goToDateStep/handleDateChange), so nothing here needs to.
  function changeService() {
    setStep(1)
  }
  function changeDateTime() {
    setStep(2)
  }

  function retryFetchSlots() {
    if (serviceId) fetchSlots(serviceId, date)
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
        <p role="alert" className="rounded-md bg-danger-bg px-4 py-3 text-base font-semibold text-danger">
          {visibleError}
        </p>
      )}

      <div className="flex flex-col gap-7 rounded-lg border border-border bg-surface p-6 shadow-[0_12px_32px_rgba(5,48,46,0.08)] sm:p-10">
        {step === 1 && (
          <section className="flex flex-col gap-7" aria-labelledby="step-service">
            <StepHeader id="step-service" eyebrow="Service" title="Select a service" subtitle="Choose the type of care you need." />
            <div className="flex flex-col gap-4">
              {services.map((service) => {
                const isSelected = service.id === serviceId
                return (
                  <button
                    key={service.id}
                    type="button"
                    data-testid={`service-option-${service.id}`}
                    onClick={() => setServiceId(service.id)}
                    aria-pressed={isSelected}
                    className={`flex min-h-11 items-center justify-between gap-4 rounded-[24px] border px-6 py-5 text-left transition-colors ${
                      isSelected ? 'border-[1.5px] border-primary-700 bg-card-mint' : 'border-border bg-surface hover:border-primary-700'
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-5">
                      <span className={`${ICON_BADGE} ${isSelected ? 'bg-surface text-primary-700' : 'bg-card-mint text-primary-700'}`}>
                        <Stethoscope size={24} aria-hidden />
                      </span>
                      <span className="flex min-w-0 flex-col gap-1">
                        <span className={TYPE.section}>{service.name}</span>
                        {service.description && <span className="text-base text-muted">{service.description}</span>}
                      </span>
                    </span>
                    <span
                      className={`flex h-10 w-9 shrink-0 items-center justify-center rounded-md ${
                        isSelected ? 'bg-primary-700 text-white' : 'bg-card-mint text-primary-700'
                      }`}
                    >
                      {isSelected ? <Check size={18} aria-hidden /> : <ArrowRight size={18} aria-hidden />}
                    </span>
                  </button>
                )
              })}
            </div>
            <div className="flex gap-5">
              <LinkButton href="/dashboard" variant="secondary" className="flex-1">
                Cancel
              </LinkButton>
              <Button type="button" onClick={goToDateStep} disabled={!serviceId} className="flex-1">
                <span className="inline-flex items-center gap-2">
                  Continue
                  <ArrowRight size={16} aria-hidden />
                </span>
              </Button>
            </div>
          </section>
        )}

        {step === 2 && selectedService && (
          <section className="flex flex-col gap-7" aria-labelledby="step-time">
            <StepHeader
              id="step-time"
              eyebrow="Date & time"
              title="Choose a date and time"
              subtitle={`Select a convenient date and available time for your ${selectedService.name}.`}
            />

            <div className="flex items-center justify-between gap-4 rounded-md border border-border bg-card-mint px-5 py-4">
              <span className="flex min-w-0 items-center gap-4">
                <span className={`${ICON_BADGE} bg-surface text-primary-700`}>
                  <Stethoscope size={24} aria-hidden />
                </span>
                <span className="flex min-w-0 flex-col gap-1">
                  <span className={TYPE.section}>{selectedService.name}</span>
                  {selectedService.description && <span className="text-base text-muted">{selectedService.description}</span>}
                </span>
              </span>
              <button type="button" onClick={changeService} className={CHANGE_BUTTON}>
                <Pencil size={14} aria-hidden />
                Change service
              </button>
            </div>

            <div className="flex flex-col gap-6 rounded-md border border-border md:flex-row md:divide-x md:divide-border">
              <div className="flex flex-1 flex-col gap-4 p-5">
                <p className={TYPE.section}>Select a date</p>
                <BookingCalendar value={date} min={todayInClinicTimezone()} onChange={handleDateChange} isClosed={isClosed} />
              </div>

              <div className="flex flex-1 flex-col gap-4 p-5">
                <p className={`${TYPE.section} flex items-center gap-2`}>
                  <Clock size={18} className="text-muted" aria-hidden />
                  Available times for {formatCalendarDate(date, { weekday: 'short' })}
                </p>
                {slotsLoading ? (
                  <p className="text-base text-muted">Loading available times…</p>
                ) : slotsError ? (
                  <div className="flex flex-col items-start gap-3">
                    <p className="text-base text-danger">Couldn&rsquo;t load times for that date. Check your connection and try again.</p>
                    <Button type="button" variant="secondary" onClick={retryFetchSlots}>
                      Try again
                    </Button>
                  </div>
                ) : closedDay ? (
                  <p className="rounded-md bg-subtle px-4 py-3 text-base text-muted">
                    The clinic is closed on {dayFullName(dayOfWeekForDate(date))}s. Choose another day.
                  </p>
                ) : fullyBooked ? (
                  <p className="rounded-md bg-warning-bg px-4 py-3 text-base text-warning">
                    Every time slot for this date has already been booked. Choose another day.
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
                          {formatClinicTime(slot.slot_time)}
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  <p className="text-base text-muted">No times available on this date.</p>
                )}
              </div>
            </div>

            <div className="flex gap-5">
              <Button type="button" variant="secondary" onClick={() => setStep(1)} className="flex-1">
                <span className="inline-flex items-center gap-2">
                  <ArrowLeft size={16} aria-hidden />
                  Back
                </span>
              </Button>
              <Button type="button" onClick={goToConfirmStep} disabled={!selectedSlot} className="flex-1">
                <span className="inline-flex items-center gap-2">
                  Continue
                  <ArrowRight size={16} aria-hidden />
                </span>
              </Button>
            </div>
          </section>
        )}

        {step === 3 && selectedService && selectedSlot && (
          <section className="flex flex-col gap-7" aria-labelledby="step-confirm">
            <StepHeader
              id="step-confirm"
              eyebrow="Confirm"
              title="Confirm your appointment"
              subtitle="Please review your appointment details before confirming."
            />

            <form action={formAction} className="flex flex-col gap-6">
              <input type="hidden" name="service_id" value={selectedService.id} />
              <input type="hidden" name="slot" value={selectedSlot} />

              <div className="flex flex-col divide-y divide-border rounded-md border border-border bg-card-mint">
                <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                  <span className="flex min-w-0 items-center gap-4">
                    <span className={`${ICON_BADGE} bg-surface text-primary-700`}>
                      <Stethoscope size={20} aria-hidden />
                    </span>
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-xs text-muted">Service</span>
                      <span className="text-base font-semibold text-ink">{selectedService.name}</span>
                      {selectedService.description && <span className="text-xs text-muted">{selectedService.description}</span>}
                    </span>
                  </span>
                  <button type="button" onClick={changeService} className={CHANGE_BUTTON}>
                    <Pencil size={14} aria-hidden />
                    Change service
                  </button>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                  <span className="flex min-w-0 items-center gap-4">
                    <span className={`${ICON_BADGE} bg-surface text-primary-700`}>
                      <Calendar size={20} aria-hidden />
                    </span>
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-xs text-muted">Date</span>
                      <span className="text-base font-semibold text-ink">{formatCalendarDate(date, { weekday: 'long' })}</span>
                    </span>
                  </span>
                  <button type="button" onClick={changeDateTime} className={CHANGE_BUTTON}>
                    <Pencil size={14} aria-hidden />
                    Change date
                  </button>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                  <span className="flex min-w-0 items-center gap-4">
                    <span className={`${ICON_BADGE} bg-surface text-primary-700`}>
                      <Clock size={20} aria-hidden />
                    </span>
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-xs text-muted">Time</span>
                      <span className="text-base font-semibold text-ink tabular">{formatClinicTime(selectedSlot)}</span>
                    </span>
                  </span>
                  <button type="button" onClick={changeDateTime} className={CHANGE_BUTTON}>
                    <Pencil size={14} aria-hidden />
                    Change time
                  </button>
                </div>

                {clinic && (
                  <div className="flex items-center gap-4 px-5 py-4">
                    <span className={`${ICON_BADGE} bg-surface text-primary-700`}>
                      <MapPin size={20} aria-hidden />
                    </span>
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-xs text-muted">Location</span>
                      <span className="text-base font-semibold text-ink">{clinic.name}</span>
                      {(clinic.address || clinic.city) && (
                        <span className="text-xs text-muted">{[clinic.address, clinic.city].filter(Boolean).join(', ')}</span>
                      )}
                    </span>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-3 rounded-md border border-border bg-surface p-5">
                <p className="flex items-center gap-2 text-base font-semibold text-ink">
                  <Info size={18} className="text-muted" aria-hidden />
                  Important information
                </p>
                <ul className="flex flex-col gap-2">
                  {BEFORE_VISIT_CHECKLIST.map((item) => (
                    <li key={item} className="flex items-start gap-3 text-sm text-muted">
                      <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary-700" aria-hidden />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="flex flex-col-reverse gap-5 sm:flex-row">
                <Button type="button" variant="secondary" onClick={() => setStep(2)} disabled={pending} className="flex-1">
                  <span className="inline-flex items-center gap-2">
                    <ArrowLeft size={16} aria-hidden />
                    Back
                  </span>
                </Button>
                <Button type="submit" variant="primary" loading={pending} className="flex-1">
                  Confirm booking
                </Button>
              </div>
            </form>
          </section>
        )}
      </div>
    </div>
  )
}
