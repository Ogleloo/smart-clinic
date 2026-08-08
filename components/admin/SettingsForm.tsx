'use client'

import { useActionState, useEffect, useState } from 'react'
import { updateClinicSettings, type SettingsFormState } from '@/app/actions/admin'
import { Button } from '@/components/ui/Button'
import type { Database } from '@/lib/types/database.types'

type ClinicSettings = Database['public']['Tables']['clinic_settings']['Row']

const FIELDS: { name: keyof ClinicSettings; label: string; help: string; step?: number }[] = [
  {
    name: 'confidence_min_count_floor',
    label: 'Minimum sample size',
    help: 'Below this many past consultations for a service, a wait estimate is always shown as low confidence — there simply isn’t enough history yet.',
  },
  {
    name: 'confidence_high_min_count',
    label: 'High-confidence sample size',
    help: 'A service needs at least this many recent consultations before an estimate can be labelled high confidence.',
  },
  {
    name: 'confidence_consistent_stddev_minutes',
    label: 'Consistent variation (minutes)',
    help: 'If recent consultation durations vary by less than this, that consistency supports a higher confidence label.',
    step: 0.5,
  },
  {
    name: 'confidence_inconsistent_stddev_minutes',
    label: 'Inconsistent variation (minutes)',
    help: 'If recent durations vary by more than this, confidence is capped lower no matter how many samples exist.',
    step: 0.5,
  },
  {
    name: 'capacity_threshold',
    label: 'Capacity threshold',
    help: 'Number of patients waiting before the clinic is considered at capacity.',
  },
  {
    name: 'min_plausible_consultation_minutes',
    label: 'Minimum plausible duration (minutes)',
    help: 'Consultations shorter than this are excluded from the running average — treated as a mis-click, not a real visit.',
  },
  {
    name: 'max_plausible_consultation_minutes',
    label: 'Maximum plausible duration (minutes)',
    help: 'Consultations longer than this are excluded from the running average — treated as someone forgetting to end it.',
  },
  {
    name: 'no_show_grace_minutes',
    label: 'No-show grace period (minutes)',
    help: 'How long after the scheduled time a booked appointment is still honoured before it’s automatically marked as a no-show.',
  },
  {
    name: 'min_booking_lead_minutes',
    label: 'Minimum booking lead time (minutes)',
    help: 'How much notice a patient must give — prevents booking a slot that’s about to start or has already passed.',
  },
]

export function SettingsForm({ settings }: { settings: ClinicSettings }) {
  const [state, formAction, pending] = useActionState<SettingsFormState, FormData>(
    updateClinicSettings,
    {}
  )
  const [showSaved, setShowSaved] = useState(false)

  // Reacting to the server action's result, not a user event.
  // Depends on the whole `state` object — see ServiceRow for why
  // keying on the boolean would miss every save after the first.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!state.success) return
    setShowSaved(true)
    const timer = setTimeout(() => setShowSaved(false), 3000)
    return () => clearTimeout(timer)
  }, [state])
  /* eslint-enable react-hooks/set-state-in-effect */

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {FIELDS.map((field) => (
        <div key={field.name} className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface p-4">
          <label htmlFor={field.name} className="text-sm font-semibold text-ink">
            {field.label}
          </label>
          <p className="text-xs text-muted">{field.help}</p>
          <input
            id={field.name}
            name={field.name}
            type="number"
            min={0}
            step={field.step ?? 1}
            defaultValue={settings[field.name] as number}
            required
            className="min-h-11 w-40 rounded-lg border border-border bg-surface px-3 text-[15px] text-ink"
          />
        </div>
      ))}

      {state.error && (
        <p role="alert" className="text-sm font-semibold text-danger">
          {state.error}
        </p>
      )}
      {showSaved && (
        <p role="status" className="text-sm font-semibold text-success">
          {state.changed && state.changed.length > 0
            ? `Saved — updated ${state.changed.join(', ')}.`
            : 'Saved — no changes.'}
        </p>
      )}

      <Button type="submit" variant="primary" loading={pending}>
        Save settings
      </Button>
    </form>
  )
}
