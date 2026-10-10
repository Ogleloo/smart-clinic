import { test, expect as baseExpect, type Page } from '@playwright/test'
import { ACCOUNTS, loginAs as rawLoginAs } from './helpers'

/**
 * Reception Profile Settings (Phase 4 — Figma frame 222:1755).
 *
 * Runs against the shared dev Supabase project, so it is strictly read-only:
 * no valid profile save, no real password change, no upload. Every form
 * submission below uses input that the Server Action rejects BEFORE it touches
 * the database (empty or one-character name, malformed phone, mismatched or
 * too-short passwords), so a rejected submit proves the validation and the
 * error path without writing anything. Success paths (save, password change,
 * upload) are covered with injected mock actions on a throwaway harness, not here.
 */
const SETTINGS = '/reception/profile/settings'

/** The shared loginAs can return before the post-login redirect lands on a slow server, and the next goto then aborts it. */
async function loginAs(page: Page, email: string, password: string) {
  await rawLoginAs(page, email, password)
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 120_000 })
}
// These pages do several sequential Supabase round trips per load (and recompile on first hit in dev); 5s is too tight.
const expect = baseExpect.configure({ timeout: 30_000 })
test.describe.configure({ timeout: 300_000 })

async function openSettings(page: Page) {
  await loginAs(page, ACCOUNTS.receptionist.email, ACCOUNTS.receptionist.password)
  await page.goto(SETTINGS)
  await expect(page.getByRole('heading', { name: 'Profile Settings', level: 1 })).toBeVisible()
}

/** Every Server Action invocation is a browser POST carrying a `next-action` header. */
function trackActions(page: Page) {
  const posts: string[] = []
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.headers()['next-action']) posts.push(req.url())
  })
  return posts
}

test.describe('Profile Settings — access', () => {
  test('signed-out visitors are sent to login', async ({ page }) => {
    await page.goto(SETTINGS)
    await expect(page).toHaveURL(/\/login/)
  })

  test('a patient account cannot open the reception page', async ({ page }) => {
    await loginAs(page, ACCOUNTS.patient.email, ACCOUNTS.patient.password)
    await page.goto(SETTINGS)
    await expect(page).not.toHaveURL(/\/reception/)
    await expect(page.getByRole('heading', { name: 'Profile Settings', level: 1 })).toHaveCount(0)
  })
})

test.describe('Profile Settings — page', () => {
  test.beforeEach(async ({ page }) => {
    await openSettings(page)
  })

  test('shows the signed-in receptionist\'s real details, with role, clinic and email read-only', async ({ page }) => {
    await expect(page.locator('#email')).toHaveValue(ACCOUNTS.receptionist.email)
    await expect(page.locator('#role')).toHaveValue('Receptionist')
    expect((await page.locator('#clinic').inputValue()).length).toBeGreaterThan(0)
    expect((await page.locator('#full_name').inputValue()).trim().length).toBeGreaterThan(1)

    for (const id of ['#role', '#clinic', '#email']) {
      await expect(page.locator(id)).toHaveAttribute('readonly', '')
      await expect(page.locator(id)).toHaveAttribute('aria-readonly', 'true')
    }
    // Only name and phone are named form fields, so only they can ever be submitted.
    const submitted = await page.locator('section[aria-labelledby="profile-information"] form').evaluate((f) =>
      // React 19 adds its own hidden $ACTION_* fields to every action form; they aren't user data.
      [...new FormData(f as HTMLFormElement).keys()].filter((k) => !k.startsWith('$ACTION'))
    )
    expect(submitted.sort()).toEqual(['full_name', 'phone'])

    // The header chip and the form agree on who is signed in.
    const chipText = await page.locator('[aria-label="Signed in as"]').innerText()
    expect(chipText).toContain((await page.locator('#full_name').inputValue()).trim())
    expect(chipText).toContain('Receptionist')
  })

  test('initials fallback: no photo, so the avatar and preview show initials; the preview follows edits and Cancel restores them', async ({
    page,
  }) => {
    const name = (await page.locator('#full_name').inputValue()).trim()
    const initial = name.split(/\s+/).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('')
    const preview = page.locator('section[aria-labelledby="avatar-preview"]')
    await expect(preview).toContainText(`Initials: ${initial}`)
    await expect(page.locator('main img')).toHaveCount(0)

    await page.locator('#full_name').fill('Noluthando Dlamini')
    await expect(preview).toContainText('Initials: ND')
    await expect(preview).toContainText('Noluthando Dlamini')
    // The header chip is the SAVED name: it must not change before Save.
    await expect(page.locator('[aria-label="Signed in as"]')).not.toContainText('Noluthando')

    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.locator('#full_name')).toHaveValue(name)
    await expect(preview).toContainText(`Initials: ${initial}`)
  })

  test('Save and Cancel are only available when something changed; Cancel discards phone edits too', async ({ page }) => {
    const save = page.getByRole('button', { name: 'Save Changes' })
    const cancel = page.getByRole('button', { name: 'Cancel' })
    await expect(save).toBeDisabled()
    await expect(cancel).toBeDisabled()

    const phoneBefore = await page.locator('#phone').inputValue()
    await page.locator('#phone').fill('082 000 0000')
    await expect(save).toBeEnabled()
    await expect(cancel).toBeEnabled()
    await cancel.click()
    await expect(page.locator('#phone')).toHaveValue(phoneBefore)
    await expect(save).toBeDisabled()
  })

  test('photo upload is honestly unavailable: Upload and Remove are disabled and say why', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Upload / Change Photo' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Remove Photo' })).toBeDisabled()
    await expect(page.getByText('JPG or PNG, max 5 MB.')).toBeVisible()
    await expect(page.getByText(/Photo upload isn.t available yet/)).toBeVisible()
  })

  for (const [label, name, phone, expected] of [
    ['an empty name', '', '', /enter your full name/i],
    ['a one-character name', 'A', '', /at least 2 characters/i],
    ['a letters-only phone number', 'Valid Name', 'abc', /digits, spaces, dashes/i],
    ['a too-short phone number', 'Valid Name', '12345', /south african number/i],
  ] as const) {
    test(`rejects ${label} with a clear message and writes nothing`, async ({ page }) => {
      await page.locator('#full_name').fill(name)
      await page.locator('#phone').fill(phone)
      await page.getByRole('button', { name: 'Save Changes' }).click()
      await expect(page.getByRole('alert').filter({ hasText: expected })).toBeVisible({ timeout: 30_000 })
      // The header chip still shows the saved name: nothing was persisted.
      await expect(page.locator('[aria-label="Signed in as"]')).not.toContainText('Valid Name')
    })
  }

  test('double submit: three same-tick clicks send exactly one Server Action, even while the first is in flight', async ({ page }) => {
    // Invalid input again, so nothing is written whichever way this goes. A 1.5s hold keeps the first request pending.
    await page.route('**/*', async (route) => {
      const req = route.request()
      if (req.method() === 'POST' && req.headers()['next-action']) await new Promise((r) => setTimeout(r, 1500))
      await route.continue()
    })
    await page.locator('#full_name').fill('A')
    const posts = trackActions(page)
    await page.getByRole('button', { name: 'Save Changes' }).evaluate((el) => {
      const b = el as HTMLButtonElement
      b.click()
      b.click()
      b.click()
    })
    await expect(page.getByRole('alert').filter({ hasText: /at least 2 characters/i })).toBeVisible({ timeout: 30_000 })
    await page.waitForTimeout(1500)
    expect(posts.length).toBe(1)
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
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  for (const [label, current, next, confirm, expected] of [
    ['a too-short new password', 'whatever-current', 'short', 'short', /at least 8 characters/i],
    ['mismatched confirmation', 'whatever-current', 'newpassword1', 'newpassword2', /don.t match/i],
    ['a new password equal to the current one', 'same-password-1', 'same-password-1', 'same-password-1', /different from your current/i],
  ] as const) {
    test(`rejects ${label} before any sign-in attempt`, async ({ page }) => {
      await page.getByRole('button', { name: 'Change Password' }).click()
      const panel = page.getByRole('form', { name: 'Change password' })
      await panel.getByLabel('Current password').fill(current)
      await panel.getByLabel('New password', { exact: true }).fill(next)
      await panel.getByLabel('Confirm new password', { exact: true }).fill(confirm)
      await panel.getByRole('button', { name: 'Update password' }).click()
      await expect(panel.getByRole('alert').filter({ hasText: expected })).toBeVisible({ timeout: 30_000 })
    })
  }

  test('a missing current password is stopped by the browser before anything is sent', async ({ page }) => {
    const posts = trackActions(page)
    await page.getByRole('button', { name: 'Change Password' }).click()
    const panel = page.getByRole('form', { name: 'Change password' })
    await panel.getByLabel('New password', { exact: true }).fill('newpassword1')
    await panel.getByLabel('Confirm new password').fill('newpassword1')
    await panel.getByRole('button', { name: 'Update password' }).click()
    await expect(panel.getByLabel('Current password')).toHaveJSProperty('validity.valueMissing', true)
    await page.waitForTimeout(500)
    expect(posts).toHaveLength(0)
  })
})

test.describe('Profile Settings — navigation, responsiveness, Sign Out', () => {
  test('the profile chip on the Dashboard and Queue pages, and the sidebar row, all lead here', async ({ page }) => {
    await loginAs(page, ACCOUNTS.receptionist.email, ACCOUNTS.receptionist.password)
    await page.goto('/reception')
    await page.getByRole('link', { name: /open Profile Settings/i }).click()
    await expect(page).toHaveURL(new RegExp(`${SETTINGS}$`), { timeout: 120_000 })

    await page.goto('/reception/queue')
    await page.getByRole('link', { name: /open Profile Settings/i }).click()
    await expect(page).toHaveURL(new RegExp(`${SETTINGS}$`), { timeout: 120_000 })

    await page.goto('/reception/appointments')
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Profile Settings' }).click()
    await expect(page).toHaveURL(new RegExp(`${SETTINGS}$`), { timeout: 120_000 })
    await expect(page.getByRole('link', { name: 'Profile Settings' }).first()).toHaveAttribute('aria-current', 'page')
  })

  for (const width of [1440, 1280, 1024, 900, 768, 390]) {
    test(`layout at ${width}px: no page-level horizontal scroll; two panels from 1280px, stacked below`, async ({ page }) => {
      await openSettings(page)
      await page.setViewportSize({ width, height: width >= 1280 ? 1024 : 900 })
      await page.waitForTimeout(300)

      expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false)

      const form = (await page.locator('section[aria-labelledby="profile-information"]').boundingBox())!
      const preview = (await page.locator('section[aria-labelledby="avatar-preview"]').boundingBox())!
      if (width >= 1280) {
        expect(preview.x).toBeGreaterThan(form.x + form.width) // side by side
        expect(preview.y).toBeCloseTo(form.y, 0)
      } else {
        expect(preview.y).toBeGreaterThan(form.y + form.height - 1) // stacked
        expect(Math.round(preview.width)).toBe(Math.round(form.width))
      }
      // Every control stays on screen horizontally.
      for (const name of ['Save Changes', 'Cancel', 'Upload / Change Photo', 'Remove Photo', 'Change Password', 'Sign Out']) {
        const box = await page.locator('main').getByRole('button', { name, exact: true }).first().boundingBox()
        expect(box, name).not.toBeNull()
        expect(box!.x + box!.width, name).toBeLessThanOrEqual(width + 1)
      }
    })
  }

  test('on mobile the top bar offers Profile and Sign Out', async ({ page }) => {
    await loginAs(page, ACCOUNTS.receptionist.email, ACCOUNTS.receptionist.password)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/reception')
    const nav = page.getByRole('navigation', { name: 'Main' })
    // Pinned, not scrolled away inside the page-link strip: both must be on screen without any scrolling.
    for (const target of [nav.getByRole('link', { name: 'Profile Settings' }), nav.getByRole('button', { name: 'Sign Out' })]) {
      await expect(target).toBeVisible()
      const box = (await target.boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(390)
    }
    await nav.getByRole('link', { name: 'Profile Settings' }).click()
    await expect(page).toHaveURL(new RegExp(`${SETTINGS}$`), { timeout: 120_000 })
  })

  test('Sign Out on this page uses the real logout and lands on /login', async ({ page }) => {
    await openSettings(page)
    await page.getByRole('button', { name: 'Sign Out' }).last().click()
    await expect(page).toHaveURL(/\/login/, { timeout: 30_000 })
    await page.goto(SETTINGS)
    await expect(page).toHaveURL(/\/login/)
  })
})
