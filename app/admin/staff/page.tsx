import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { StaffRow } from '@/components/admin/StaffRow'
import { StaffInviteForm } from '@/components/admin/v3/StaffInviteForm'
import { PendingInvitations, type InvitationRow } from '@/components/admin/v3/PendingInvitations'

/**
 * Staff Management (Figma 168:412).
 *
 * Figma's table also carries a Service column, a Workload percentage and an On duty / Off duty chip per
 * person. None is shown here: profiles carry no service assignment (a nurse picks one when they go on duty),
 * there is no workload metric anywhere in the schema, and duty is a per-session fact rather than a property
 * of the account. Inventing those columns would mean inventing the data behind them — the same reasoning the
 * admin dashboard already applies to Figma's "+6 from yesterday" trend lines.
 *
 * Staff onboarding runs on migration 0053: the administrator records an invitation, the invitee registers
 * themselves, and accept_staff_invitation() applies the role only once their email is verified. Nothing here
 * ever holds elevated credentials — admin_invite_staff() is SECURITY DEFINER and does its own authorisation.
 */
export default async function AdminStaffPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const [{ data: staff, error }, { data: invitations, error: invitationsError }] = await Promise.all([
    supabase.from('profiles').select('*').in('role', ['receptionist', 'nurse', 'admin']).order('full_name'),
    // RLS (staff_invitations_admin_read) already restricts this to the caller's own clinic.
    supabase
      .from('staff_invitations')
      .select('id, email, full_name, role, created_at, expires_at, accepted_at, revoked_at')
      .order('created_at', { ascending: false }),
  ])

  // The registration URL the administrator has to pass on. Taken from the request's own host so it is right
  // in every environment rather than hardcoded to production.
  const host = (await headers()).get('host') ?? ''
  const protocol = host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https'
  const registrationUrl = host ? `${protocol}://${host}/register` : '/register'

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-[22px] font-semibold text-ink">Staff Management</h2>
        <p className="text-sm text-muted">
          Invite nurses and receptionists, and set each staff member&rsquo;s role and whether they can sign in.
        </p>
      </div>

      <StaffInviteForm registrationUrl={registrationUrl} />

      {invitationsError ? (
        <p className="text-sm text-danger">Couldn&rsquo;t load invitations. Try refreshing.</p>
      ) : (
        <PendingInvitations invitations={(invitations ?? []) as InvitationRow[]} />
      )}

      <section className="flex flex-col gap-3" aria-labelledby="staff-accounts">
        <h3 id="staff-accounts" className="text-base font-semibold text-ink">
          Staff accounts
        </h3>
        {error ? (
          <p className="text-sm text-danger">Couldn&rsquo;t load staff. Try refreshing.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {(staff ?? []).map((member) => (
              <StaffRow key={member.id} staff={member} isSelf={member.auth_user_id === user?.id} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
