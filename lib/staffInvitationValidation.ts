/** The only roles an administrator may invite. Mirrors staff_invitation_role_is_staff in migration 0053. */
export const INVITABLE_ROLES = ['nurse', 'receptionist'] as const
export type InvitableRole = (typeof INVITABLE_ROLES)[number]

export const ROLE_LABELS: Record<InvitableRole, string> = {
  nurse: 'Nurse',
  receptionist: 'Receptionist',
}

export interface StaffInviteInput {
  full_name: string
  email: string
  role: string
}

export type StaffInviteErrors = Partial<Record<'full_name' | 'email' | 'role', string>>

export const STAFF_INVITE_FIELD_ORDER = ['full_name', 'email', 'role'] as const

/**
 * Client/server-side mirror of what admin_invite_staff() already enforces in the database. The database
 * stays authoritative — it re-checks every one of these, plus the caller's role, their clinic, and whether
 * an account already exists, none of which the browser can be trusted to decide. This exists so a typo is
 * caught before a round trip, not to replace that check: anything this misses is still refused server-side.
 *
 * The email pattern is deliberately the same shape as the function's own regex rather than a stricter one,
 * so the form never accepts an address the database would then reject (or vice versa).
 */
export function validateStaffInvite(input: StaffInviteInput): { errors: StaffInviteErrors; values: { full_name: string; email: string; role: InvitableRole } | null } {
  const errors: StaffInviteErrors = {}

  const fullName = input.full_name.trim()
  if (!fullName) errors.full_name = 'Enter the staff member’s full name.'

  const email = input.email.trim().toLowerCase()
  if (!email) {
    errors.email = 'Enter their work email address.'
  } else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    errors.email = 'That doesn’t look like an email address.'
  }

  const role = input.role as InvitableRole
  if (!INVITABLE_ROLES.includes(role)) {
    errors.role = 'Choose either Nurse or Receptionist.'
  }

  if (Object.keys(errors).length > 0) return { errors, values: null }
  return { errors, values: { full_name: fullName, email, role } }
}

export type InvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired'

/**
 * The status an administrator actually sees, derived only from columns migration 0053 writes. There is no
 * "sent" or "delivered" state because nothing in this system sends the invitee anything — the administrator
 * passes the registration instructions on themselves (see StaffInviteForm), so claiming delivery here would
 * be inventing a fact the database cannot support.
 *
 * Order matters: a revoked invitation stays revoked even once its expiry passes, and an accepted one is
 * final regardless of either.
 */
export function invitationStatus(row: { accepted_at: string | null; revoked_at: string | null; expires_at: string }, now: Date = new Date()): InvitationStatus {
  if (row.accepted_at) return 'accepted'
  if (row.revoked_at) return 'revoked'
  if (new Date(row.expires_at).getTime() <= now.getTime()) return 'expired'
  return 'pending'
}

/** Only a still-open invitation can be revoked — admin_revoke_staff_invitation() refuses anything else. */
export function isRevocable(status: InvitationStatus): boolean {
  return status === 'pending'
}
