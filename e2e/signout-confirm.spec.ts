import { test, expect, type Page } from '@playwright/test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import {
  openSignOutHarness,
  queueSignOutResponse,
  releaseSignOut,
  signOutCalls,
} from './support/signout-confirm-harness/harness'

/**
 * SignOutConfirm — the real component, mounted in a browser with app/actions/auth swapped for an in-page mock
 * (e2e/support/signout-confirm-harness). No Supabase, no network, no Server Action ever reached. Every request
 * the harness doesn't expect is aborted and recorded in `escapes`, asserted empty by every test (fail-closed).
 *
 * What these tests pin is the one thing the confirmation step is responsible for: WHETHER logout() runs. Because
 * logout() is mocked, "Cancel signed nobody out" is provable as the absence of a call — not inferred from the
 * absence of a redirect, which a dialog that silently failed to open would also produce.
 *
 * logout() itself is unchanged and is not under test here; e2e/logout.spec.ts covers what it does against a live
 * project (session cleared server-side, protected routes no longer reachable).
 */

/** The page-level trigger. Located outside any dialog, because the confirm button shares its accessible name. */
const trigger = (page: Page, nth = 0) => page.locator('form > button[aria-haspopup="dialog"]').nth(nth)
const dialog = (page: Page) => page.getByRole('dialog')
/**
 * The confirm button, by type rather than by name: its label becomes "Signing out…" while the action is in
 * flight, so a name-based locator stops matching at exactly the moment the pending state is being asserted.
 */
const confirm = (page: Page) => dialog(page).locator('button[type="submit"]')
const cancel = (page: Page) => dialog(page).getByRole('button', { name: 'Cancel' })

test.describe('the confirmation step', () => {
  test('the trigger keeps its accessible name and opens no dialog until it is used', async ({ page }) => {
    const { escapes } = await openSignOutHarness(page)
    await expect(trigger(page)).toBeVisible()
    await expect(trigger(page)).toHaveAttribute('aria-haspopup', 'dialog')
    await expect(dialog(page)).toHaveCount(0)
    expect(await signOutCalls(page)).toHaveLength(0)
    expect(escapes).toEqual([])
  })

  test('the trigger asks instead of signing out — the dialog appears and logout() is not reached', async ({ page }) => {
    const { escapes } = await openSignOutHarness(page)
    await trigger(page).click()
    await expect(dialog(page)).toBeVisible()
    await expect(dialog(page)).toHaveAttribute('aria-modal', 'true')
    await expect(dialog(page).getByRole('heading', { name: 'Sign out?' })).toBeVisible()
    // The whole point: a click on Sign Out no longer signs anyone out by itself.
    expect(await signOutCalls(page)).toHaveLength(0)
    expect(escapes).toEqual([])
  })

  test('Cancel is the focused action when the dialog opens, so Enter and Space land on the safe choice', async ({
    page,
  }) => {
    const { escapes } = await openSignOutHarness(page)
    await trigger(page).click()
    await expect(cancel(page)).toBeFocused()
    // Pressing Enter on the focused element must cancel, not sign out.
    await page.keyboard.press('Enter')
    await expect(dialog(page)).toHaveCount(0)
    expect(await signOutCalls(page)).toHaveLength(0)
    expect(escapes).toEqual([])
  })

  test('Cancel closes the dialog, signs nobody out, and returns focus to the trigger', async ({ page }) => {
    const { escapes } = await openSignOutHarness(page)
    await trigger(page).click()
    await cancel(page).click()
    await expect(dialog(page)).toHaveCount(0)
    await expect(trigger(page)).toBeFocused()
    expect(await signOutCalls(page)).toHaveLength(0)
    expect(escapes).toEqual([])
  })

  test('Escape closes the dialog and signs nobody out', async ({ page }) => {
    const { escapes } = await openSignOutHarness(page)
    await trigger(page).click()
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toHaveCount(0)
    await expect(trigger(page)).toBeFocused()
    expect(await signOutCalls(page)).toHaveLength(0)
    expect(escapes).toEqual([])
  })

  test('clicking the backdrop closes the dialog and signs nobody out', async ({ page }) => {
    const { escapes } = await openSignOutHarness(page)
    await trigger(page).click()
    // Top-left corner of the viewport is backdrop, never the centred card.
    await page.mouse.click(4, 4)
    await expect(dialog(page)).toHaveCount(0)
    expect(await signOutCalls(page)).toHaveLength(0)
    expect(escapes).toEqual([])
  })

  test('clicking inside the card does not close it', async ({ page }) => {
    const { escapes } = await openSignOutHarness(page)
    await trigger(page).click()
    await dialog(page).getByRole('heading', { name: 'Sign out?' }).click()
    await expect(dialog(page)).toBeVisible()
    expect(await signOutCalls(page)).toHaveLength(0)
    expect(escapes).toEqual([])
  })

  test('confirming reaches logout() exactly once', async ({ page }) => {
    const { escapes } = await openSignOutHarness(page)
    await trigger(page).click()
    await expect(confirm(page)).toHaveAccessibleName('Sign Out')
    await confirm(page).click()
    await expect.poll(async () => (await signOutCalls(page)).length).toBe(1)
    expect(escapes).toEqual([])
  })

  test('Tab is kept inside the dialog while it is open', async ({ page }) => {
    const { escapes } = await openSignOutHarness(page)
    await trigger(page).click()
    await expect(cancel(page)).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(confirm(page)).toBeFocused()
    // Forward past the last item wraps to the first, rather than escaping to the link behind the dialog.
    await page.keyboard.press('Tab')
    await expect(cancel(page)).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(confirm(page)).toBeFocused()
    expect(escapes).toEqual([])
  })
})

test.describe('double submission', () => {
  test('a second click while the first is in flight cannot fire a second sign-out', async ({ page }) => {
    const { escapes } = await openSignOutHarness(page)
    // The first logout() parks until released: exactly the window in which a second click could land.
    await queueSignOutResponse(page, { hold: true })
    await trigger(page).click()

    const button = confirm(page)
    await button.click()
    await expect(button).toBeDisabled()
    await expect(button).toHaveAttribute('aria-busy', 'true')
    await expect(button).toHaveText('Signing out…')
    // Cancel is disabled too, so the dialog cannot be dismissed out from under a request already sent.
    await expect(cancel(page)).toBeDisabled()

    await button.click({ force: true }).catch(() => {})
    await releaseSignOut(page)
    await expect.poll(async () => (await signOutCalls(page)).length).toBe(1)
    expect(escapes).toEqual([])
  })
})

test.describe('more than one sign-out control on the same page', () => {
  test('each dialog labels itself — the ARIA ids are per instance, not shared constants', async ({ page }) => {
    // Every real screen mounts both a sidebar and a mobile nav, so two triggers coexist on every page.
    const { escapes } = await openSignOutHarness(page, { instances: 2 })
    await expect(page.getByRole('button', { name: 'Sign Out' })).toHaveCount(2)

    await trigger(page, 0).click()
    const firstId = await dialog(page).getAttribute('aria-labelledby')
    await expect(dialog(page).getByRole('heading', { name: 'Sign out?' })).toBeVisible()
    await page.keyboard.press('Escape')

    await trigger(page, 1).click()
    const secondId = await dialog(page).getAttribute('aria-labelledby')
    await expect(dialog(page).getByRole('heading', { name: 'Sign out?' })).toBeVisible()

    expect(firstId).toBeTruthy()
    expect(secondId).toBeTruthy()
    expect(firstId).not.toBe(secondId)
    expect(await signOutCalls(page)).toHaveLength(0)
    expect(escapes).toEqual([])
  })

  test('using one trigger opens one dialog, not every dialog on the page', async ({ page }) => {
    const { escapes } = await openSignOutHarness(page, { instances: 2 })
    await trigger(page, 1).click()
    await expect(dialog(page)).toHaveCount(1)
    expect(escapes).toEqual([])
  })
})

/**
 * Source contract. The confirmation is only as good as its coverage: one `<form action={logout}>` left anywhere
 * is a surface that still signs out on a single click, and nothing on screen would look wrong. This walks the
 * real app and component trees instead of trusting a list written by hand.
 */
test.describe('every sign-out control goes through the confirmation', () => {
  const ROOT = path.resolve(__dirname, '..')

  function sourceFiles(dir: string): string[] {
    const out: string[] = []
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue
      const full = path.join(dir, entry)
      if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
      else if (/\.tsx?$/.test(entry)) out.push(full)
    }
    return out
  }

  const files = [...sourceFiles(path.join(ROOT, 'app')), ...sourceFiles(path.join(ROOT, 'components'))]

  test('no component submits logout directly any more', () => {
    const offenders = files
      .filter((f) => path.resolve(f) !== path.resolve(ROOT, 'components/ui/SignOutConfirm.tsx'))
      .filter((f) => /action=\{logout\}/.test(readFileSync(f, 'utf8')))
      .map((f) => path.relative(ROOT, f).replace(/\\/g, '/'))
    expect(offenders).toEqual([])
  })

  test('SignOutConfirm is the only component that imports the sign-out action at all', () => {
    // `logout` as a named import, not `idleLogout`: IdleTimeoutMonitor imports that one — a different action with
    // a different destination — and deliberately does NOT confirm, because an expired session has already ended
    // and there is nothing left to ask about.
    const importsLogout = (src: string) =>
      [...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'@\/app\/actions\/auth'/g)].some((m) =>
        m[1]!.split(',').some((n) => n.trim() === 'logout')
      )
    const importers = files
      .filter((f) => importsLogout(readFileSync(f, 'utf8')))
      .map((f) => path.relative(ROOT, f).replace(/\\/g, '/'))
    expect(importers).toEqual(['components/ui/SignOutConfirm.tsx'])
  })

  test('all twelve known sign-out surfaces render the confirmation component', () => {
    const surfaces = [
      'app/(auth)/login/page.tsx',
      'app/(patient)/profile/page.tsx',
      'components/admin/v3/AdminMobileNav.tsx',
      'components/admin/v3/AdminSidebar.tsx',
      'components/nurse/v3/NurseMobileNav.tsx',
      'components/nurse/v3/NurseSidebar.tsx',
      'components/patient/Sidebar.tsx',
      'components/profile/ProfileSettingsForm.tsx',
      'components/reception/ProfileSettingsView.tsx',
      'components/reception/ReceptionMobileNav.tsx',
      'components/reception/ReceptionSidebar.tsx',
      'components/ui/LogoutButton.tsx',
    ]
    for (const rel of surfaces) {
      const src = readFileSync(path.join(ROOT, rel), 'utf8')
      expect(src, rel).toContain('<SignOutConfirm')
      // LogoutButton sits next to it and imports relatively; every other surface uses the alias.
      expect(src, rel).toMatch(/from '(@\/components\/ui|\.)\/SignOutConfirm'/)
    }
  })

  test('the trigger stays a real submit button inside a real form, so sign-out survives without JavaScript', () => {
    const src = readFileSync(path.join(ROOT, 'components/ui/SignOutConfirm.tsx'), 'utf8')
    // Before hydration the form posts to logout() directly; onSubmit only intercepts once JS is running. The
    // failure mode of the confirmation is "no confirmation", never "no way to sign out" — which is what matters
    // on the shared clinic devices /login tells people to sign out of.
    expect(src).toContain('<form\n        action={logout}')
    expect(src).toContain('type="submit"')
    expect(src).toContain('e.preventDefault()')
  })
})
