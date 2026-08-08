'use client'

import { useActionState, useEffect, useState } from 'react'
import { updateService, type ServiceFormState } from '@/app/actions/admin'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { StatusChip } from '@/components/ui/StatusChip'
import type { Database } from '@/lib/types/database.types'

type Service = Database['public']['Tables']['services']['Row']

export function ServiceRow({ service }: { service: Service }) {
  const [editing, setEditing] = useState(false)
  const [state, formAction, pending] = useActionState<ServiceFormState, FormData>(updateService, {})

  // Close the edit form once the action actually succeeds, not on the
  // Save click itself — an onClick that also flips local state
  // synchronously can race the native form submission and silently
  // drop it (the bug this app already hit once in EmergencyToggle).
  //
  // Depends on the whole `state` object, not state.success: useActionState
  // gives every dispatch a fresh object reference, but `success` is a
  // boolean that stays `true` across repeated successful saves. A
  // second save in the same mounted row would leave state.success
  // unchanged (true -> true), so an effect keyed on that primitive
  // would silently stop firing after the first save — the form would
  // never close again. Keying on the object itself catches every
  // dispatch, since its reference changes even when success stays true.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (state.success) setEditing(false)
  }, [state])

  if (!editing) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface p-4">
        <div>
          <p className="text-sm font-semibold text-ink">
            {service.name} <span className="font-mono text-xs text-muted">({service.token_prefix})</span>
          </p>
          <p className="text-xs text-muted">{service.default_consultation_minutes} min default</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusChip status={service.is_active ? 'booked' : 'cancelled'} label={service.is_active ? 'Active' : 'Inactive'} />
          <Button variant="tertiary" onClick={() => setEditing(true)}>
            Edit
          </Button>
        </div>
      </div>
    )
  }

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3 rounded-lg border border-primary-700 bg-primary-50 p-4"
    >
      <input type="hidden" name="id" value={service.id} />
      <Input label="Name" name="name" defaultValue={service.name} required />
      <Input label="Token prefix" name="token_prefix" defaultValue={service.token_prefix} required />
      <Input
        label="Default consultation minutes"
        name="default_consultation_minutes"
        type="number"
        min={1}
        defaultValue={service.default_consultation_minutes}
        required
      />
      <label className="flex items-center gap-2 text-sm font-semibold text-ink">
        <input type="checkbox" name="is_active" value="true" defaultChecked={service.is_active} />
        Active (visible for walk-in and booking)
      </label>
      {!service.is_active && (
        <p className="text-xs text-muted">
          Services are never deleted — historical queue entries and consultations reference them, and
          deleting would orphan that history. Deactivating just hides it from new bookings and walk-ins.
        </p>
      )}
      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="button" variant="tertiary" fullWidth onClick={() => setEditing(false)}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" fullWidth loading={pending}>
          Save
        </Button>
      </div>
    </form>
  )
}
