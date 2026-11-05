import { test, expect } from './support/guarded-test'
import { ACCOUNTS, createTestClient } from './helpers'

/**
 * Staff onboarding, against a real database (migration 0053).
 *
 * DESTRUCTIVE: every test here writes to staff_invitations, so this spec only runs against an isolated local
 * stack (E2E_ENABLE_DESTRUCTIVE=1 plus a plain-localhost project — see e2e/support/guarded-test.ts). It must
 * never run against the shared project, which production and previews both use.
 *
 * What is under test is the DATABASE's authorisation, not the UI's: admin_invite_staff,
 * admin_revoke_staff_invitation and accept_staff_invitation are SECURITY DEFINER, so they are the real
 * boundary. The browser could be rewritten entirely and these properties would still have to hold.
 *
 * Each test cleans up the invitation it created, in a finally, so a failure can't leave an open invitation
 * that blocks the next run's unique index (staff_invitations_one_open_per_email).
 */

const INVITEE = 'e2e-staff-invite@example.test'

async function signIn(account: { email: string; password: string }) {
  const client = createTestClient()
  const { error } = await client.auth.signInWithPassword(account)
  if (error) throw new Error(`sign-in failed for ${account.email}: ${error.message}`)
  return client
}

/** Removes any invitation this spec created, whatever state it ended in. */
async function cleanUp(email: string) {
  const admin = await signIn(ACCOUNTS.admin)
  const { data } = await admin.from('staff_invitations').select('id').eq('email', email)
  for (const row of data ?? []) {
    await admin.rpc('admin_revoke_staff_invitation', { p_id: row.id })
  }
  await admin.auth.signOut({ scope: 'local' })
}

test.describe('admin_invite_staff: who may invite', () => {
  test.afterEach(() => cleanUp(INVITEE))

  test('an administrator can invite a nurse, and the row records who invited them', async () => {
    const admin = await signIn(ACCOUNTS.admin)
    const { data, error } = await admin
      .rpc('admin_invite_staff', { p_email: INVITEE, p_full_name: 'E2E Nurse', p_role: 'nurse' })
    expect(error).toBeNull()
    expect(data).toMatchObject({ email: INVITEE, full_name: 'E2E Nurse', role: 'nurse' })
    expect(data!.invited_by).toBeTruthy()
    expect(data!.clinic_id).toBeTruthy()
    expect(data!.accepted_at).toBeNull()
    expect(data!.revoked_at).toBeNull()
    await admin.auth.signOut({ scope: 'local' })
  })

  for (const who of ['patient', 'receptionist', 'nurse'] as const) {
    test(`a ${who} cannot invite staff`, async () => {
      const client = await signIn(ACCOUNTS[who])
      const { error } = await client.rpc('admin_invite_staff', {
        p_email: INVITEE,
        p_full_name: 'Should Not Exist',
        p_role: 'nurse',
      })
      expect(error).not.toBeNull()
      expect(error!.message).toContain('Only an administrator may invite staff')
      await client.auth.signOut({ scope: 'local' })
    })
  }
})

test.describe('admin_invite_staff: privilege escalation is refused', () => {
  test.afterEach(() => cleanUp(INVITEE))

  for (const role of ['admin', 'patient'] as const) {
    test(`an administrator cannot invite someone as ${role}`, async () => {
      const admin = await signIn(ACCOUNTS.admin)
      const { error } = await admin.rpc('admin_invite_staff', {
        p_email: INVITEE,
        p_full_name: 'Escalation Attempt',
        // Cast: the point of the test is that the database refuses a value the typed client wouldn't offer.
        p_role: role as 'nurse',
      })
      expect(error).not.toBeNull()
      expect(error!.message).toContain('Staff accounts can only be created for nurses and receptionists')
      await admin.auth.signOut({ scope: 'local' })
    })
  }

  test('an invitation cannot be created for an address that already has an account', async () => {
    const admin = await signIn(ACCOUNTS.admin)
    const { error } = await admin.rpc('admin_invite_staff', {
      p_email: ACCOUNTS.patient.email,
      p_full_name: 'Already Registered',
      p_role: 'nurse',
    })
    expect(error).not.toBeNull()
    expect(error!.message).toContain('An account already exists for this email address')
    await admin.auth.signOut({ scope: 'local' })
  })

  test('a malformed email and an empty name are both refused', async () => {
    const admin = await signIn(ACCOUNTS.admin)
    const bad = await admin.rpc('admin_invite_staff', { p_email: 'not-an-email', p_full_name: 'X', p_role: 'nurse' })
    expect(bad.error?.message).toContain('That does not look like an email address')
    const blank = await admin.rpc('admin_invite_staff', { p_email: INVITEE, p_full_name: '   ', p_role: 'nurse' })
    expect(blank.error?.message).toContain('Full name is required')
    await admin.auth.signOut({ scope: 'local' })
  })
})

test.describe('duplicate invitations', () => {
  test.afterEach(() => cleanUp(INVITEE))

  test('a second invitation for the same address supersedes the first rather than creating two open ones', async () => {
    const admin = await signIn(ACCOUNTS.admin)
    const first = await admin.rpc('admin_invite_staff', { p_email: INVITEE, p_full_name: 'First', p_role: 'nurse' })
    expect(first.error).toBeNull()

    const second = await admin
      .rpc('admin_invite_staff', { p_email: INVITEE, p_full_name: 'Second', p_role: 'receptionist' })
    expect(second.error).toBeNull()

    // The unique index allows only one open invitation per address; the older one must now be revoked.
    const { data: rows } = await admin
      .from('staff_invitations')
      .select('id, full_name, role, revoked_at')
      .eq('email', INVITEE)
      .order('created_at', { ascending: true })

    expect(rows).toHaveLength(2)
    expect(rows![0].revoked_at).not.toBeNull()
    expect(rows![1].revoked_at).toBeNull()
    expect(rows![1].role).toBe('receptionist')
    await admin.auth.signOut({ scope: 'local' })
  })
})

test.describe('admin_revoke_staff_invitation', () => {
  test.afterEach(() => cleanUp(INVITEE))

  test('an administrator can revoke an open invitation, and revoking it twice is refused', async () => {
    const admin = await signIn(ACCOUNTS.admin)
    const { data: inv } = await admin
      .rpc('admin_invite_staff', { p_email: INVITEE, p_full_name: 'To Revoke', p_role: 'nurse' })

    const first = await admin.rpc('admin_revoke_staff_invitation', { p_id: inv!.id })
    expect(first.error).toBeNull()

    const again = await admin.rpc('admin_revoke_staff_invitation', { p_id: inv!.id })
    expect(again.error).not.toBeNull()
    expect(again.error!.message).toContain('already been used')
    await admin.auth.signOut({ scope: 'local' })
  })

  test('a non-administrator cannot revoke an invitation', async () => {
    const admin = await signIn(ACCOUNTS.admin)
    const { data: inv } = await admin
      .rpc('admin_invite_staff', { p_email: INVITEE, p_full_name: 'To Revoke', p_role: 'nurse' })
    await admin.auth.signOut({ scope: 'local' })

    const receptionist = await signIn(ACCOUNTS.receptionist)
    const { error } = await receptionist.rpc('admin_revoke_staff_invitation', { p_id: inv!.id })
    expect(error).not.toBeNull()
    expect(error!.message).toContain('Only an administrator may revoke invitations')
    await receptionist.auth.signOut({ scope: 'local' })
  })
})

test.describe('staff_invitations visibility (RLS)', () => {
  test.afterEach(() => cleanUp(INVITEE))

  test('only an administrator sees invitations; other roles see none even though the table is granted to them', async () => {
    const admin = await signIn(ACCOUNTS.admin)
    await admin.rpc('admin_invite_staff', { p_email: INVITEE, p_full_name: 'Visible To Admin', p_role: 'nurse' })
    const { data: adminRows } = await admin.from('staff_invitations').select('id').eq('email', INVITEE)
    expect(adminRows?.length).toBe(1)
    await admin.auth.signOut({ scope: 'local' })

    for (const who of ['patient', 'receptionist', 'nurse'] as const) {
      const client = await signIn(ACCOUNTS[who])
      const { data } = await client.from('staff_invitations').select('id').eq('email', INVITEE)
      expect(data ?? [], who).toHaveLength(0)
      await client.auth.signOut({ scope: 'local' })
    }
  })

  test('no role can write to staff_invitations directly — every write goes through the functions', async () => {
    const admin = await signIn(ACCOUNTS.admin)
    const { data: me } = await admin.from('profiles').select('id, clinic_id').limit(1).single()
    const { error } = await admin.from('staff_invitations').insert({
      clinic_id: me!.clinic_id!,
      email: 'direct-insert@example.test',
      full_name: 'Direct Insert',
      role: 'nurse',
      invited_by: me!.id,
    })
    // RLS has a SELECT policy only, so an INSERT has no permissive policy to satisfy.
    expect(error).not.toBeNull()
    await admin.auth.signOut({ scope: 'local' })
  })
})

test.describe('accept_staff_invitation', () => {
  test('a signed-in user with no invitation keeps their patient role and is told nothing sensitive', async () => {
    const patient = await signIn(ACCOUNTS.patient)
    const { data, error } = await patient.rpc('accept_staff_invitation')
    expect(error).toBeNull()
    // 'none' (no invitation) or 'not_applicable' (already staff) — never a role change, and never a leak of
    // whether some other address has an invitation.
    expect(['none', 'not_applicable']).toContain((data as { status: string }).status)

    const { data: profile } = await patient.from('profiles').select('role').limit(1).single()
    expect(profile!.role).toBe('patient')
    await patient.auth.signOut({ scope: 'local' })
  })

  test('an existing staff member calling it again is a no-op, not an error', async () => {
    const nurse = await signIn(ACCOUNTS.nurse)
    const { data, error } = await nurse.rpc('accept_staff_invitation')
    expect(error).toBeNull()
    expect((data as { status: string }).status).toBe('not_applicable')
    await nurse.auth.signOut({ scope: 'local' })
  })
})
