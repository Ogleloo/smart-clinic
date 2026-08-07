'use client'

import { useActionState, useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { bookAppointment, type ActionState } from '@/app/actions/appointments'
import { Button } from '@/components/ui/Button'
import { ServicePicker, type Service } from '@/components/booking/ServicePicker'
import { CLINIC_TIMEZONE, todayInClinicTimezone } from '@/lib/clinicTime'

interface Slot {
  slot_time: string
  is_taken: boolean
}

function formatSlotTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: CLINIC_TIMEZONE,
  })
}

function formatPickedDate(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}

export function BookingWizard({ services }: { services: Service[] }) {
  const [supabase] = useState(() => createClient())
  const [serviceId, setServiceId] = useState<string | null>(null)
  const [date, setDate] = useState(() => todayInClinicTimezone())
  const [slots, setSlots] = useState<Slot[] | null>(null)
  const [slotsLoading, setSlotsLoading] = useState(false)
  const [slotsError, setSlotsError] = useState<string | null>(null)
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null)
  const [state, formAction, pending] = useActionState<ActionState, FormData>(bookAppointment, {})

  const selectedService = services.find((s) => s.id === serviceId) ?? null

  // Fetching slots always invalidates whatever was selected before —
  // clearing it here (rather than in the effect that triggers a refetch)
  // keeps every effect below free of direct setState calls; only the
  // async RPC callback updates state.
  const fetchSlots = useCallback(
    async (svcId: string, forDate: string) => {
      setSelectedSlot(null)
      setSlotsLoading(true)
      setSlotsError(null)
      const { data, error } = await supabase.rpc('get_available_slots', {
        p_service_id: svcId,
        p_date: forDate,
      })
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

  function handleSelectService(id: string) {
    setServiceId(id)
    fetchSlots(id, date)
  }

  function handleDateChange(newDate: string) {
    setDate(newDate)
    if (serviceId) fetchSlots(serviceId, newDate)
  }

  // "That slot was just taken" means our grid is stale — refresh it so
  // the user picks from what's actually still available, instead of
  // retrying the same now-invalid slot.
  useEffect(() => {
    // Reacting to the server action's result, not a user event — an
    // effect is the correct place for this (react.dev/learn/you-might-not-need-an-effect#fetching-data).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (state.error && serviceId) fetchSlots(serviceId, date)
    // Deliberately only [state.error]: serviceId/date changes already
    // trigger a fetch via the select/date handlers above, so reacting to
    // them here too would double-fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.error])

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2">
        <p className="text-xs font-semibold tracking-wide text-muted">1. SERVICE</p>
        <ServicePicker services={services} selectedId={serviceId} onSelect={handleSelectService} />
      </section>

      {selectedService && (
        <section className="flex flex-col gap-2">
          <label htmlFor="booking-date" className="text-xs font-semibold tracking-wide text-muted">
            2. DATE
          </label>
          <input
            id="booking-date"
            type="date"
            value={date}
            min={todayInClinicTimezone()}
            onChange={(e) => handleDateChange(e.target.value)}
            className="min-h-11 w-full rounded-lg border border-border bg-surface px-3 text-[15px] text-ink"
          />
        </section>
      )}

      {selectedService && (
        <section className="flex flex-col gap-2">
          <p className="text-xs font-semibold tracking-wide text-muted">3. TIME</p>
          {slotsLoading ? (
            <p className="text-sm text-muted">Loading available times…</p>
          ) : slotsError ? (
            <p className="text-sm text-danger">Couldn&rsquo;t load times for that date. Try another date.</p>
          ) : slots && slots.length > 0 ? (
            <div className="grid grid-cols-3 gap-2">
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
        </section>
      )}

      {/* Deliberately outside the selectedSlot block below: a booking
          error clears selectedSlot (via the stale-grid refetch above),
          which would otherwise hide this message in the same instant it
          appears. */}
      {state.error && (
        <p role="alert" className="text-sm font-semibold text-danger">
          {state.error}
        </p>
      )}

      {selectedService && selectedSlot && (
        <form
          action={formAction}
          className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
        >
          <input type="hidden" name="service_id" value={selectedService.id} />
          <input type="hidden" name="slot" value={selectedSlot} />
          <p className="text-sm text-muted">
            {selectedService.name} · {formatPickedDate(date)} · {formatSlotTime(selectedSlot)}
          </p>
          <Button type="submit" variant="primary" fullWidth loading={pending}>
            Confirm booking
          </Button>
        </form>
      )}
    </div>
  )
}
