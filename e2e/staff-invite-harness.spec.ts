import { test, expect, type Page } from '@playwright/test'
import { openStaffHarness, calls, queueResponse, setDefault, release } from './support/staff-invite-harness/harness'

/**
 * StaffInviteForm / PendingInvitations — the real components, mounted in a browser with app/actions/admin
 * swapped for in-page mocks (e2e/support/staff-invite-harness). No Supabase, no network, no Server Action
 * ever reached. Every request the harness doesn't expect is aborted and recorded in `escapes`, asserted
 * empty by every test (fail-closed).
 *
 * Authorisation itself is the database's job (admin_invite_staff / admin_revoke_staff_invitation are
 * SECURITY DEFINER and check the caller's role and clinic). What these tests pin is the UI's behaviour
 * around it: validation before the round trip, honest confirmation wording, recoverable errors, and that a
 * rejected invitation is never shown as if it succeeded.
 */

const REGISTRATION_URL = 'https://clinic.test/register'

async function openInviteForm(page: Page, defaults: Record<string, { value?: unknown; hold?: boolean }> = {}) {
  const res = await openStaffHarness(page, { mode: 'invite', props: { registrationUrl: REGISTRATION_URL }, defaults })
  await page.getByRole('button', { name: 'Add Staff Member' }).click()
  return res
}

async function fillValid(page: Page, over: { name?: string; email?: string; role?: 'Nurse' | 'Receptionist' } = {}) {
  await page.getByLabel('Full name').fill(over.name ?? 'Thandeka Nkosi')
  await page.getByLabel('Work email address').fill(over.email ?? 'thandeka@example.com')
  if (over.role) await page.getByRole('radio', { name: over.role }).check()
}

test.describe('Add Staff Member form', () => {
  test('the form stays collapsed until asked for, matching Figma’s single toolbar button', async ({ page }) => {
    const { escapes } = await openStaffHarness(page, { mode: 'invite', props: { registrationUrl: REGISTRATION_URL } })
    await expect(page.getByRole('button', { name: 'Add Staff Member' })).toBeVisible()
    await expect(page.getByLabel('Full name')).toHaveCount(0)
    await page.getByRole('button', { name: 'Add Staff Member' }).click()
    await expect(page.getByLabel('Full name')).toBeVisible()
    expect(escapes).toEqual([])
  })

  test('only Nurse and Receptionist are offered — there is no Administrator option anywhere', async ({ page }) => {
    const { escapes } = await openInviteForm(page)
    await expect(page.getByRole('radio', { name: 'Nurse' })).toBeVisible()
    await expect(page.getByRole('radio', { name: 'Receptionist' })).toBeVisible()
    await expect(page.getByRole('radio', { name: /admin/i })).toHaveCount(0)
    await expect(page.getByText(/Administrator accounts can.t be created here/)).toBeVisible()
    expect(escapes).toEqual([])
  })

  test('invalid input is caught before anything is sent, and every bad field is reported at once', async ({ page }) => {
    const { escapes } = await openInviteForm(page)
    await page.getByLabel('Work email address').fill('not-an-email')
    await page.getByRole('button', { name: 'Record invitation' }).click()
    await expect(page.getByText('Enter the staff member’s full name.')).toBeVisible()
    await expect(page.getByText('That doesn’t look like an email address.')).toBeVisible()
    expect(await calls(page, 'inviteStaffMember')).toHaveLength(0)
    expect(escapes).toEqual([])
  })

  test('a valid invitation reaches the action once, with the chosen role, and is confirmed with the normalised address', async ({ page }) => {
    const { escapes } = await openInviteForm(page)
    // The action returns what the database actually stored — lower-cased and trimmed by validateStaffInvite
    // (covered on its own in staff-invitation-validation.spec.ts). The form sends the raw field values;
    // normalisation is deliberately not the browser's decision.
    await setDefault(page, 'inviteStaffMember', {
      value: { invited: { full_name: 'Thandeka Nkosi', email: 'thandeka@example.com', role: 'receptionist' } },
    })
    await fillValid(page, { name: '  Thandeka Nkosi  ', email: 'Thandeka@Example.COM', role: 'Receptionist' })
    await page.getByRole('button', { name: 'Record invitation' }).click()
    await expect(page.getByText(/Invitation recorded for Thandeka Nkosi/)).toBeVisible()

    const sent = await calls(page, 'inviteStaffMember')
    expect(sent).toHaveLength(1)
    expect(sent[0].args[0]).toMatchObject({ full_name: '  Thandeka Nkosi  ', role: 'receptionist' })
    // The confirmation shows the stored address, not whatever casing was typed.
    await expect(page.getByRole('region', { name: /Invitation recorded/ })).toContainText('thandeka@example.com')
    expect(escapes).toEqual([])
  })

  test('the confirmation never claims an email was sent, and tells the administrator what to pass on', async ({ page }) => {
    await openInviteForm(page)
    await setDefault(page, 'inviteStaffMember', {
      value: { invited: { full_name: 'Thandeka Nkosi', email: 'thandeka@example.com', role: 'nurse' } },
    })
    await fillValid(page)
    await page.getByRole('button', { name: 'Record invitation' }).click()

    const panel = page.getByRole('region', { name: /Invitation recorded/ })
    await expect(panel).toContainText('No email has been sent')
    await expect(panel).toContainText(REGISTRATION_URL)
    await expect(panel).toContainText('thandeka@example.com')
    await expect(panel).toContainText('Nurse')
    // Nothing anywhere implies delivery.
    await expect(page.getByText(/we.ve sent|invitation sent|email sent to/i)).toHaveCount(0)
  })

  test('a database rejection (duplicate account, wrong role, not an admin) is shown and never looks like success', async ({ page }) => {
    const { escapes } = await openInviteForm(page)
    await setDefault(page, 'inviteStaffMember', { value: { error: 'An account already exists for this email address' } })
    await fillValid(page)
    await page.getByRole('button', { name: 'Record invitation' }).click()

    await expect(page.getByRole('alert')).toHaveText('An account already exists for this email address')
    await expect(page.getByText(/Invitation recorded/)).toHaveCount(0)
    // The form stays open with the values intact so the administrator can correct and retry.
    await expect(page.getByLabel('Work email address')).toHaveValue('thandeka@example.com')
    expect(escapes).toEqual([])
  })

  test('recovery: after a rejection, correcting the address and retrying succeeds', async ({ page }) => {
    await openInviteForm(page)
    await queueResponse(page, 'inviteStaffMember', { value: { error: 'An account already exists for this email address' } })
    await queueResponse(page, 'inviteStaffMember', {
      value: { invited: { full_name: 'Thandeka Nkosi', email: 'new@example.com', role: 'receptionist' } },
    })
    await fillValid(page)
    await page.getByRole('button', { name: 'Record invitation' }).click()
    await expect(page.getByRole('alert')).toBeVisible()

    await page.getByLabel('Work email address').fill('new@example.com')
    await page.getByRole('radio', { name: 'Receptionist' }).check()
    await page.getByRole('button', { name: 'Record invitation' }).click()
    await expect(page.getByText(/Invitation recorded for Thandeka Nkosi/)).toBeVisible()
    expect(await calls(page, 'inviteStaffMember')).toHaveLength(2)
  })

  test('clicking Record invitation twice in quick succession only ever submits once', async ({ page }) => {
    const { escapes } = await openInviteForm(page)
    await setDefault(page, 'inviteStaffMember', { hold: true })
    await fillValid(page)

    const submit = page.getByRole('button', { name: /Record invitation|Please wait/ })
    await submit.click()
    await submit.click({ force: true })
    await expect(page.getByRole('button', { name: 'Please wait' })).toBeDisabled()
    expect(await calls(page, 'inviteStaffMember')).toHaveLength(1)

    await release(page, 'inviteStaffMember')
    expect(escapes).toEqual([])
  })

  test('the whole form is reachable by keyboard', async ({ page }) => {
    await openInviteForm(page)
    await page.getByLabel('Full name').focus()
    await expect(page.getByLabel('Full name')).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(page.getByLabel('Work email address')).toBeFocused()
  })

  for (const width of [1440, 768, 390, 320]) {
    test(`${width}px: the invite form fits with no sideways scrolling`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1200 })
      await openInviteForm(page)
      await fillValid(page)
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(overflow).toBeLessThanOrEqual(0)
    })
  }
})

test.describe('Invitations list', () => {
  // Neutral names on purpose: a fixture called "Revoked Person" would make a status assertion match the
  // name as well as the chip, and pass for the wrong reason.
  const rows = [
    { id: 'inv-1', email: 'one@example.com', full_name: 'Ayanda Zulu', role: 'nurse', created_at: '2026-11-01T08:00:00Z', expires_at: '2099-01-01T00:00:00Z', accepted_at: null, revoked_at: null },
    { id: 'inv-2', email: 'two@example.com', full_name: 'Bongani Dube', role: 'receptionist', created_at: '2026-10-20T08:00:00Z', expires_at: '2026-10-27T00:00:00Z', accepted_at: '2026-10-21T08:00:00Z', revoked_at: null },
    { id: 'inv-3', email: 'three@example.com', full_name: 'Chuma Matiwane', role: 'nurse', created_at: '2026-10-20T08:00:00Z', expires_at: '2099-01-01T00:00:00Z', accepted_at: null, revoked_at: '2026-10-22T08:00:00Z' },
    { id: 'inv-4', email: 'four@example.com', full_name: 'Dineo Khoza', role: 'nurse', created_at: '2026-01-01T08:00:00Z', expires_at: '2026-01-08T00:00:00Z', accepted_at: null, revoked_at: null },
  ]

  test('each invitation shows the status its own columns support — and no "sent"/"delivered" state exists', async ({ page }) => {
    const { escapes } = await openStaffHarness(page, { mode: 'invitations', props: { invitations: rows } })
    for (const label of ['Awaiting registration', 'Active', 'Revoked', 'Expired']) {
      await expect(page.getByText(label, { exact: true })).toHaveCount(1)
    }
    await expect(page.getByText(/\bsent\b|delivered/i)).toHaveCount(0)
    expect(escapes).toEqual([])
  })

  test('only the still-pending invitation offers Revoke', async ({ page }) => {
    await openStaffHarness(page, { mode: 'invitations', props: { invitations: rows } })
    await expect(page.getByRole('button', { name: 'Revoke' })).toHaveCount(1)
  })

  test('revoking sends exactly that invitation’s id', async ({ page }) => {
    const { escapes } = await openStaffHarness(page, { mode: 'invitations', props: { invitations: rows }, defaults: { revokeStaffInvitation: { value: { revoked: true } } } })
    await page.getByRole('button', { name: 'Revoke' }).click()
    const sent = await calls(page, 'revokeStaffInvitation')
    expect(sent).toHaveLength(1)
    expect(sent[0].args[0]).toEqual({ invitation_id: 'inv-1' })
    expect(escapes).toEqual([])
  })

  test('a refused revoke is reported inline rather than silently doing nothing', async ({ page }) => {
    await openStaffHarness(page, {
      mode: 'invitations',
      props: { invitations: rows },
      defaults: { revokeStaffInvitation: { value: { error: 'Invitation not found, or it has already been used' } } },
    })
    await page.getByRole('button', { name: 'Revoke' }).click()
    await expect(page.getByRole('alert')).toHaveText('Invitation not found, or it has already been used')
  })

  test('an empty list says so instead of rendering a bare heading', async ({ page }) => {
    await openStaffHarness(page, { mode: 'invitations', props: { invitations: [] } })
    await expect(page.getByText(/No invitations yet/)).toBeVisible()
  })
})
