import { expect as baseExpect, type Page } from '@playwright/test'
import { test } from './support/safe-test'
import { ACCOUNTS, loginAs as rawLoginAs } from './helpers'

/**
 * Patient Profile Settings (Figma 222:2091) — READ-ONLY.
 *
 * Runs against the shared dev Supabase project, so it submits NOTHING: no Save Changes, no Update password, no
 * upload — not even input the Server Action is expected to reject ("expected to fail" still calls a
 * mutation-capable endpoint). Everything that submits the profile or password form belongs in a destructive
 * spec (local stack only; see e2e/patient-v3.spec.ts, which already covers the full save/validate/restore cycle
 * against Thabo's demo account). Here: access rules, rendering, edit-state controls (nothing is sent), the
 * password panel's open/close behaviour, navigation, layout and Sign Out — the same split reception-profile.spec.ts
 * already uses for the identical reason.
 */
const SETTINGS = '/profile/settings'

async function loginAs(page: Page, email: string, password: string) {
  await rawLoginAs(page, email, password)
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 120_000 })
}
const expect = baseExpect.configure({ timeout: 30_000 })
test.describe.configure({ timeout: 300_000 })

async function openSettings(page: Page) {
  await loginAs(page, ACCOUNTS.patient.email, ACCOUNTS.patient.password)
  await page.goto(SETTINGS)
  await expect(page.getByRole('heading', { name: 'Profile Settings', level: 1 })).toBeVisible()
}

test.describe('Profile Settings — access', () => {
  test('signed-out visitors are sent to login', async ({ page }) => {
    await page.goto(SETTINGS)
    await expect(page).toHaveURL(/\/login/)
  })

  test('a staff account cannot open the patient page', async ({ page }) => {
    await loginAs(page, ACCOUNTS.receptionist.email, ACCOUNTS.receptionist.password)
    await page.goto(SETTINGS)
    await expect(page).not.toHaveURL(new RegExp(`${SETTINGS}$`))
    await expect(page.getByRole('heading', { name: 'Profile Settings', level: 1 })).toHaveCount(0)
  })
})

test.describe('Profile Settings — page', () => {
  test.beforeEach(async ({ page }) => {
    await openSettings(page)
  })

  test('shows the signed-in patient\'s real details, with role, clinic and email read-only', async ({ page }) => {
    await expect(page.locator('input[name="email_readonly"]')).toHaveValue(ACCOUNTS.patient.email)
    await expect(page.locator('input[name="role_readonly"]')).toHaveValue('Patient')
    expect((await page.locator('input[name="full_name"]').inputValue()).trim().length).toBeGreaterThan(1)

    for (const name of ['role_readonly', 'clinic_readonly', 'email_readonly']) {
      const field = page.locator(`input[name="${name}"]`)
      await expect(field, name).toHaveAttribute('readonly', '')
      await expect(field, name).toHaveAttribute('aria-readonly', 'true')
    }

    // Only the fields the form actually names can ever be submitted.
    const submitted = await page.locator('section[aria-labelledby="profile-information"] form').evaluate((f) =>
      // React 19 adds its own hidden $ACTION_* fields to every action form; they aren't user data.
      [...new FormData(f as HTMLFormElement).keys()].filter((k) => !k.startsWith('$ACTION'))
    )
    expect(submitted.sort()).toEqual(['date_of_birth', 'document_type', 'full_name', 'id_number', 'phone'])
  })

  test('South African ID is the default document type, and the matching field is shown', async ({ page }) => {
    await expect(page.getByRole('radio', { name: 'South African ID' })).toBeChecked()
    await expect(page.getByRole('radio', { name: 'Passport' })).not.toBeChecked()
    await expect(page.getByLabel('South African ID number')).toBeVisible()
    await expect(page.getByLabel('Passport number')).toHaveCount(0)
  })

  test('the avatar preview shows the signed-in patient\'s real initials', async ({ page }) => {
    const name = (await page.locator('input[name="full_name"]').inputValue()).trim()
    const initial = name.split(/\s+/).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('')
    const preview = page.locator('section[aria-labelledby="avatar-preview"]')
    await expect(preview).toContainText(`Initials: ${initial}`)
    await expect(preview).toContainText(name)
    await expect(preview).toContainText('Patient')
  })

  test('photo upload is honestly unavailable: Upload and Remove are disabled and say why', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Upload / Change Photo' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Remove Photo' })).toBeDisabled()
    await expect(page.getByText('JPG or PNG, max 5 MB.')).toBeVisible()
    await expect(page.getByText(/Photo upload isn.t available yet/)).toBeVisible()
  })

  test('Cancel returns to the read-only profile page without submitting anything', async ({ page }) => {
    // Cancel is a plain navigation link (GET /profile), not a button — nothing is submitted by following it.
    await page.getByRole('link', { name: 'Cancel', exact: true }).click()
    await expect(page).toHaveURL(/\/profile$/)
  })
})

test.describe('Profile Settings — Change Password (validation only; no real change is attempted)', () => {
  test.beforeEach(async ({ page }) => {
    await openSettings(page)
  })

  test('opens as an accessible expandable panel and focuses its first field', async ({ page }) => {
    const toggle = page.getByRole('button', { name: 'Change Password' })
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const panel = page.getByRole('form', { name: 'Change password' })
    await expect(panel).toBeVisible()
    await expect(panel.getByLabel('Current password')).toBeFocused()
    for (const label of ['Current password', 'New password', 'Confirm new password']) {
      await expect(panel.getByLabel(label, { exact: true })).toHaveAttribute('type', 'password')
    }
    // The toggle and the panel's own submit never share an accessible name.
    await expect(panel.getByRole('button', { name: 'Update password' })).toBeVisible()
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })
})

test.describe('Profile Settings — navigation, responsiveness, Sign Out', () => {
  test('the sidebar Profile link leads here and is marked current', async ({ page }) => {
    await loginAs(page, ACCOUNTS.patient.email, ACCOUNTS.patient.password)
    await page.goto('/dashboard')
    const sidebar = page.locator('aside')
    await expect(sidebar.getByRole('link', { name: /^Profile/ })).not.toHaveAttribute('aria-current', 'page')
    await sidebar.getByRole('link', { name: /^Profile/ }).click()
    await page.waitForURL('**/profile')
    await page.goto(SETTINGS)
    await expect(sidebar.getByRole('link', { name: /^Profile/ })).toHaveAttribute('aria-current', 'page')
  })

  for (const width of [1440, 1280, 1024, 768, 390, 320]) {
    test(`layout at ${width}px: no page-level horizontal scroll; two panels from xl, stacked below`, async ({ page }) => {
      await openSettings(page)
      await page.setViewportSize({ width, height: width >= 1280 ? 1200 : 1000 })
      await page.waitForTimeout(300)

      expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false)

      const form = (await page.locator('section[aria-labelledby="profile-information"]').boundingBox())!
      const preview = (await page.locator('section[aria-labelledby="avatar-preview"]').boundingBox())!
      if (width >= 1280) {
        expect(preview.x).toBeGreaterThan(form.x + form.width) // side by side
      } else {
        expect(preview.y).toBeGreaterThan(form.y + form.height - 1) // stacked
      }
      for (const name of ['Save Changes', 'Upload / Change Photo', 'Remove Photo', 'Change Password', 'Sign Out']) {
        const box = await page.locator('main').getByRole('button', { name, exact: true }).first().boundingBox()
        expect(box, name).not.toBeNull()
        expect(box!.x + box!.width, name).toBeLessThanOrEqual(width + 1)
      }
      const cancelBox = (await page.locator('main').getByRole('link', { name: 'Cancel', exact: true }).boundingBox())!
      expect(cancelBox.x + cancelBox.width).toBeLessThanOrEqual(width + 1)
    })
  }

  test('Sign Out on this page uses the real logout and lands on /login', async ({ page }) => {
    await openSettings(page)
    // Two steps since components/ui/SignOutConfirm.tsx — the page control confirms first, the dialog's button acts.
    await page.locator('main').getByRole('button', { name: 'Sign Out' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Sign Out' }).click()
    await page.waitForURL(/\/login$/, { timeout: 120_000 })
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/login/)
  })
})
