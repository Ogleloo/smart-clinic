'use client'

import { useActionState, useEffect, useState } from 'react'
import { updateStaffMember, type StaffFormState } from '@/app/actions/admin'
import { Button } from '@/components/ui/Button'
import { StatusChip } from '@/components/ui/StatusChip'
import type { Database } from '@/lib/types/database.types'

type Profile = Database['public']['Tables']['profiles']['Row']

const ROLE_LABELS: Record<string, string> = {
  receptionist: 'Receptionist',
  nurse: 'Nurse',
  admin: 'Admin',
}

export function StaffRow({ staff, isSelf }: { staff: Profile; isSelf: boolean }) {
  const [editing, setEditing] = useState(false)
  const [showSaved, setShowSaved] = useState(false)
  const [state, formAction, pending] = useActionState<StaffFormState, FormData>(updateStaffMember, {})

  // Depends on the whole `state` object, not state.success — see
  // ServiceRow for why keying on the boolean would miss every save
  // after the first.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!state.success) return
    setEditing(false)
    setShowSaved(true)
    const timer = setTimeout(() => setShowSaved(false), 3000)
    return () => clearTimeout(timer)
  }, [state])
  /* eslint-enable react-hooks/set-state-in-effect */

  if (!editing) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-ink">
              {staff.full_name} {isSelf && <span className="text-xs font-normal text-muted">(you)</span>}
            </p>
            <p className="text-xs text-muted">{ROLE_LABELS[staff.role] ?? staff.role}</p>
          </div>
          <div className="flex items-center gap-2">
            <StatusChip status={staff.is_active ? 'booked' : 'cancelled'} label={staff.is_active ? 'Active' : 'Inactive'} />
            <Button variant="tertiary" onClick={() => setEditing(true)}>
              Edit
            </Button>
          </div>
        </div>
        {showSaved && (
          <p role="status" className="text-xs font-semibold text-success">
            {state.changed && state.changed.length > 0
              ? `Saved — updated ${state.changed.join(', ')}.`
              : 'Saved — no changes.'}
          </p>
        )}
      </div>
    )
  }

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3 rounded-lg border border-primary-700 bg-primary-50 p-4"
    >
      <input type="hidden" name="id" value={staff.id} />
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`role-${staff.id}`} className="text-sm font-semibold text-ink">
          Role
        </label>
        <select
          id={`role-${staff.id}`}
          name="role"
          defaultValue={staff.role}
          disabled={isSelf}
          className="min-h-11 w-full rounded-lg border border-border bg-surface px-3 text-[15px] text-ink disabled:opacity-60"
        >
          <option value="receptionist">Receptionist</option>
          <option value="nurse">Nurse</option>
          <option value="admin">Admin</option>
        </select>
      </div>
      <label className="flex items-center gap-2 text-sm font-semibold text-ink">
        <input type="checkbox" name="is_active" value="true" defaultChecked={staff.is_active} disabled={isSelf} />
        Active
      </label>
      {isSelf && (
        <p className="text-xs text-muted">You can&rsquo;t change your own role or deactivate yourself.</p>
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
