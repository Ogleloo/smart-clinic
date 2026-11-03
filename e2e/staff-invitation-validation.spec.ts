import { test, expect } from '@playwright/test'
import {
  INVITABLE_ROLES,
  invitationStatus,
  isRevocable,
  validateStaffInvite,
  type InvitationStatus,
} from '../lib/staffInvitationValidation'

/**
 * Pure logic, no browser and no database: the client-side mirror of what admin_invite_staff() enforces, and
 * the status an administrator is shown for an invitation row. The database remains authoritative for all of
 * it — these tests pin the UI's own behaviour so a typo is caught before a round trip and so the status
 * shown can never claim something the columns don't support.
 */

test.describe('validateStaffInvite', () => {
  const ok = { full_name: 'Thandeka Nkosi', email: 'thandeka@example.com', role: 'nurse' }

  test('a complete nurse invitation is accepted, trimmed and lower-cased', () => {
    const { errors, values } = validateStaffInvite({ full_name: '  Thandeka Nkosi  ', email: '  Thandeka@Example.COM ', role: 'nurse' })
    expect(errors).toEqual({})
    expect(values).toEqual({ full_name: 'Thandeka Nkosi', email: 'thandeka@example.com', role: 'nurse' })
  })

  test('a receptionist invitation is accepted too', () => {
    expect(validateStaffInvite({ ...ok, role: 'receptionist' }).values?.role).toBe('receptionist')
  })

  test('only nurse and receptionist are invitable — never admin or patient', () => {
    expect(INVITABLE_ROLES).toEqual(['nurse', 'receptionist'])
    for (const role of ['admin', 'patient', '', 'ADMIN', 'superuser']) {
      const { errors, values } = validateStaffInvite({ ...ok, role })
      expect(values, role).toBeNull()
      expect(errors.role, role).toBeTruthy()
    }
  })

  test('a missing name is refused', () => {
    const { errors, values } = validateStaffInvite({ ...ok, full_name: '   ' })
    expect(values).toBeNull()
    expect(errors.full_name).toBeTruthy()
  })

  for (const bad of ['', 'not-an-email', 'missing@domain', 'two@@at.com', 'spaces in@email.com', '@nolocal.com']) {
    test(`a malformed email is refused: ${JSON.stringify(bad)}`, () => {
      const { errors, values } = validateStaffInvite({ ...ok, email: bad })
      expect(values).toBeNull()
      expect(errors.email).toBeTruthy()
    })
  }

  test('every bad field is reported at once, not one at a time', () => {
    const { errors } = validateStaffInvite({ full_name: '', email: 'nope', role: 'admin' })
    expect(Object.keys(errors).sort()).toEqual(['email', 'full_name', 'role'])
  })
})

test.describe('invitationStatus', () => {
  const base = { accepted_at: null as string | null, revoked_at: null as string | null, expires_at: '2026-12-01T00:00:00Z' }
  const now = new Date('2026-11-03T12:00:00Z')

  test('an open, unexpired invitation is pending', () => {
    expect(invitationStatus(base, now)).toBe('pending')
  })

  test('an accepted invitation is accepted, even once its expiry has passed', () => {
    expect(invitationStatus({ ...base, accepted_at: '2026-11-02T00:00:00Z', expires_at: '2026-11-01T00:00:00Z' }, now)).toBe('accepted')
  })

  test('a revoked invitation stays revoked, even once its expiry has passed', () => {
    expect(invitationStatus({ ...base, revoked_at: '2026-11-02T00:00:00Z', expires_at: '2026-11-01T00:00:00Z' }, now)).toBe('revoked')
  })

  test('acceptance wins over revocation if both columns are somehow set', () => {
    expect(invitationStatus({ ...base, accepted_at: '2026-11-02T00:00:00Z', revoked_at: '2026-11-02T00:00:00Z' }, now)).toBe('accepted')
  })

  test('an untouched invitation past its expiry is expired', () => {
    expect(invitationStatus({ ...base, expires_at: '2026-11-01T00:00:00Z' }, now)).toBe('expired')
  })

  test('expiry is inclusive — the exact expiry instant is already expired, never still pending', () => {
    expect(invitationStatus({ ...base, expires_at: now.toISOString() }, now)).toBe('expired')
  })
})

test.describe('isRevocable', () => {
  test('only a pending invitation can be revoked — matching what the RPC accepts', () => {
    const expected: Record<InvitationStatus, boolean> = { pending: true, accepted: false, revoked: false, expired: false }
    for (const [status, revocable] of Object.entries(expected) as [InvitationStatus, boolean][]) {
      expect(isRevocable(status), status).toBe(revocable)
    }
  })
})
