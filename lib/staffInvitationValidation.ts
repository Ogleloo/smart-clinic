import { parseEmail, parseStaffName } from './profileValidation'

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
 * The email rule may be stricter than the function's own regex, never looser — see parseEmail's note below.
 * That direction is the safe one: the form can refuse an address the database would have taken, but it can
 * never accept one the database will then reject.
 */

export function validateStaffInvite(input: StaffInviteInput): { errors: StaffInviteErrors; values: { full_name: string; email: string; role: InvitableRole } | null } {
  const errors: StaffInviteErrors = {}

  // The same name rule as every other name field in the app (letters, spaces, hyphens, apostrophes, full stops),
  // with this form's own wording for the empty case — an invited nurse's name is displayed on the queue screens
  // beside patients', so it cannot be held to a looser standard than a patient's own.
  const name = parseStaffName(input.full_name)
  const fullName = name.value ?? ''
  if (name.error) errors.full_name = name.error === 'Enter your full name.' ? 'Enter the staff member’s full name.' : name.error

  /**
   * Syntax only — it says nothing about whether the mailbox exists or can be reached, and nothing in this system
   * sends the invitee anything (see invitationStatus below), so there is no delivery for it to imply.
   *
   * Stricter than admin_invite_staff()'s own regex, which is the safe direction: this can refuse an address the
   * database would have accepted, but it can never accept one the database will then reject, so the form still
   * cannot promise something the database refuses. The extra rules — consecutive dots, a dot at the edge of a
   * part, the 254-character limit — reject text that is not a deliverable address under any reading.
   */
  const parsed = parseEmail(input.email)
  const email = parsed.value ?? ''
  if (parsed.error) {
    errors.email =
      parsed.error === 'Enter your email address.'
        ? 'Enter their work email address.'
        : parsed.error === 'Enter a valid email address.'
          ? 'That doesn’t look like an email address.'
          : parsed.error
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
