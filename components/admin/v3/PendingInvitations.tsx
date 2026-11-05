'use client'

import { useActionState } from 'react'
import { revokeStaffInvitation, type RevokeInviteState } from '@/app/actions/admin'
import { Button } from '@/components/ui/Button'
import { formatClinicDate } from '@/lib/clinicTime'
import { invitationStatus, isRevocable, ROLE_LABELS, type InvitableRole, type InvitationStatus } from '@/lib/staffInvitationValidation'

export interface InvitationRow {
  id: string
  email: string
  full_name: string
  role: string
  created_at: string
  expires_at: string
  accepted_at: string | null
  revoked_at: string | null
}

const STATUS_STYLE: Record<InvitationStatus, string> = {
  pending: 'bg-card-mint text-primary-700',
  accepted: 'bg-primary-700 text-white',
  revoked: 'bg-subtle text-muted',
  expired: 'bg-warning-bg text-warning',
}

const STATUS_LABEL: Record<InvitationStatus, string> = {
  pending: 'Awaiting registration',
  accepted: 'Active',
  revoked: 'Revoked',
  expired: 'Expired',
}

function RevokeButton({ id }: { id: string }) {
  const [state, formAction, pending] = useActionState<RevokeInviteState, FormData>(revokeStaffInvitation, {})

  // A successful revoke revalidates /admin/staff, so the row re-renders from the database with its new
  // status rather than this component guessing at it.
  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <input type="hidden" name="invitation_id" value={id} />
      <Button type="submit" variant="danger-outline" loading={pending}>
        Revoke
      </Button>
      {state.error && (
        <p role="alert" className="text-xs text-danger">
          {state.error}
        </p>
      )}
    </form>
  )
}

/**
 * Invitations an administrator has recorded, with the status the database can actually justify
 * (see invitationStatus). There is no "sent"/"delivered" column because nothing in this system emails the
 * invitee — "Awaiting registration" says what is really true of an open invitation.
 *
 * Only the caller's own clinic's invitations are ever visible: staff_invitations' RLS policy restricts
 * SELECT to an administrator of the owning clinic, so this list is scoped by the database, not by a filter
 * applied here.
 */
export function PendingInvitations({ invitations }: { invitations: InvitationRow[] }) {
  if (invitations.length === 0) {
    return (
      <section className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-5" aria-labelledby="invitations">
        <h3 id="invitations" className="text-base font-semibold text-ink">
          Invitations
        </h3>
        <p className="text-sm text-muted">No invitations yet. Use Add Staff Member to invite a nurse or receptionist.</p>
      </section>
    )
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5" aria-labelledby="invitations">
      <h3 id="invitations" className="text-base font-semibold text-ink">
        Invitations
      </h3>
      <ul className="flex flex-col gap-2">
        {invitations.map((invitation) => {
          const status = invitationStatus(invitation)
          const role = ROLE_LABELS[invitation.role as InvitableRole] ?? invitation.role
          return (
            <li
              key={invitation.id}
              className="flex flex-col gap-3 rounded-lg border border-border bg-paper p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-ink">{invitation.full_name}</p>
                  <span className={`inline-flex w-fit items-center rounded-full px-3 py-1 text-xs font-semibold ${STATUS_STYLE[status]}`}>
                    {STATUS_LABEL[status]}
                  </span>
                </div>
                <p className="truncate font-mono text-xs text-muted">{invitation.email}</p>
                <p className="text-xs text-muted">
                  {role} · invited {formatClinicDate(invitation.created_at, { month: 'long', year: 'numeric' })}
                  {status === 'pending' && <> · expires {formatClinicDate(invitation.expires_at, { month: 'long', year: 'numeric' })}</>}
                </p>
              </div>
              {isRevocable(status) && <RevokeButton id={invitation.id} />}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
