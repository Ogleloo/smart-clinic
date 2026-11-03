/**
 * Stand-in for app/actions/admin.ts — only the two invitation actions are used by the components under test.
 * The real actions call admin_invite_staff / admin_revoke_staff_invitation, which carry all the
 * authorisation; what the harness exercises is the UI's own behaviour around whatever they return.
 */
import { respond } from './state'
import type { RevokeInviteState, StaffInviteState } from '../../../../app/actions/admin'

export async function inviteStaffMember(_prev: StaffInviteState, formData: FormData): Promise<StaffInviteState> {
  const payload = {
    full_name: String(formData.get('full_name') ?? ''),
    email: String(formData.get('email') ?? ''),
    role: String(formData.get('role') ?? ''),
  }
  const result = (await respond('inviteStaffMember', [payload])) as StaffInviteState | undefined
  return result ?? {}
}

export async function revokeStaffInvitation(_prev: RevokeInviteState, formData: FormData): Promise<RevokeInviteState> {
  const invitation_id = String(formData.get('invitation_id') ?? '')
  const result = (await respond('revokeStaffInvitation', [{ invitation_id }])) as RevokeInviteState | undefined
  return result ?? {}
}
