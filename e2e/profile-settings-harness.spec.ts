import { test, expect, type Page } from '@playwright/test'
import { openProfileSettingsHarness, calls } from './support/profile-settings-harness/harness'
import type { ProfileSettingsHarnessProps } from './support/profile-settings-harness/types'

/**
 * Patient Profile Settings — the real ProfileSettingsForm, mounted in a browser with app/actions/profile and
 * app/actions/auth swapped for in-page mocks (e2e/support/profile-settings-harness). No Supabase, no network,
 * no Server Action ever reached — updateProfile() returns whatever each test configures, which is what makes
 * it possible to simulate a SERVER-returned field error without submitting anything real. Every request this
 * harness doesn't expect is aborted and recorded in `escapes`, asserted empty by every test (fail-closed).
 *
 * Covers the one thing the static-render spec (profile-settings-render.spec.ts) explicitly can't: interactive
 * behaviour across a real submit — specifically, that switching document type clears a stale id_number error
 * whichever source it came from (a client-side check, or — as here — a Server Action response).
 */

const BASE_PROPS: ProfileSettingsHarnessProps = {
  fullName: 'Thabo Mokoena',
  phone: '082 123 4567',
  dateOfBirth: '1980-01-01',
  idNumber: '8001015009087',
  email: 'thabo@example.com',
  roleLabel: 'Patient',
  clinicName: 'Riverside Clinic',
  today: '2026-11-02',
}

function saveButton(page: Page) {
  return page.getByRole('button', { name: 'Save Changes' })
}

test.describe('ProfileSettingsForm: document-type switch clears a server-returned id_number error', () => {
  test('a server-only id_number rejection (client validation never ran, nothing changed) is cleared by switching document type', async ({ page }) => {
    const { escapes } = await openProfileSettingsHarness(page, {
      props: BASE_PROPS,
      updateProfileResponse: {
        error: 'A South African ID number has 13 digits.',
        fieldErrors: { id_number: 'A South African ID number has 13 digits.' },
      },
    })

    // Submitted with nothing changed: client-side validation passes trivially (an unchanged value is never
    // re-validated), so the error on screen afterward can only have come from the mocked Server Action.
    await saveButton(page).click()
    await expect(page.getByText('A South African ID number has 13 digits.')).toBeVisible()
    expect(await calls(page, 'updateProfile')).toHaveLength(1)

    await page.getByRole('radio', { name: 'Passport' }).check()
    await expect(page.getByText('A South African ID number has 13 digits.')).toHaveCount(0)
    await expect(page.getByLabel('Passport number')).toHaveValue('') // switching always starts the field blank

    expect(escapes).toEqual([])
  })

  test('an unrelated field error from the same server response survives the switch — only id_number is cleared', async ({ page }) => {
    const { escapes } = await openProfileSettingsHarness(page, {
      props: BASE_PROPS,
      updateProfileResponse: {
        error: 'A South African ID number has 13 digits.',
        fieldErrors: {
          id_number: 'A South African ID number has 13 digits.',
          phone: 'That phone number should have between 7 and 15 digits.',
        },
      },
    })

    await saveButton(page).click()
    await expect(page.getByText('A South African ID number has 13 digits.')).toBeVisible()
    await expect(page.getByText('That phone number should have between 7 and 15 digits.')).toBeVisible()

    await page.getByRole('radio', { name: 'Passport' }).check()
    await expect(page.getByText('A South African ID number has 13 digits.')).toHaveCount(0)
    // The genuine, unrelated server failure is not hidden by switching document type.
    await expect(page.getByText('That phone number should have between 7 and 15 digits.')).toBeVisible()

    expect(escapes).toEqual([])
  })

  test('switching back to South African ID after the server rejection is just as clean', async ({ page }) => {
    const { escapes } = await openProfileSettingsHarness(page, {
      props: { ...BASE_PROPS, idNumber: 'A1234567' }, // starts in Passport (not 13 digits) — see initialDocumentType
      updateProfileResponse: {
        error: 'Passport number must be 6–20 letters or digits, with no dashes or symbols.',
        fieldErrors: { id_number: 'Passport number must be 6–20 letters or digits, with no dashes or symbols.' },
      },
    })

    await expect(page.getByLabel('Passport number')).toBeVisible()
    await saveButton(page).click()
    await expect(page.getByText('Passport number must be 6–20 letters or digits, with no dashes or symbols.')).toBeVisible()

    await page.getByRole('radio', { name: 'South African ID' }).check()
    await expect(page.getByText('Passport number must be 6–20 letters or digits, with no dashes or symbols.')).toHaveCount(0)
    await expect(page.getByLabel('South African ID number')).toHaveValue('')

    expect(escapes).toEqual([])
  })
})
