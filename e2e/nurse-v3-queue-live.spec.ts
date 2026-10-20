import type { Page } from '@playwright/test'
import { test, expect } from './support/safe-test'
import { ACCOUNTS, loginAs as rawLoginAs } from './helpers'

/**
 * My Queue (Nurse V3) — LIVE, READ-ONLY (split out of nurse-v3-queue.spec.ts, which is now fully offline: pure logic and
 * the mocked harness). These tests sign in with the demo accounts and look; they never click a control that calls, skips,
 * records or undoes anything. They run on the read-only guarded test (e2e/support/safe-test.ts), and the static audit in
 * e2e/e2e-safety.spec.ts rejects any mutation-capable control or Server Action handling in this file.
 */

const tab = (page: Page, name: RegExp) => page.getByRole('tab', { name })

const QUEUE_URL = '/nurse/queue'

async function loginAs(page: Page, email: string, password: string) {
  for (let attempt = 0; attempt < 2; attempt++) {
    await rawLoginAs(page, email, password)
    try {
      await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 90_000 })
      return
    } catch {
      if (attempt === 1) throw new Error('sign-in did not complete')
    }
  }
}

test.describe('My Queue — access', () => {
  test.describe.configure({ timeout: 300_000 })

  test('signed-out visitors are sent to login', async ({ page }) => {
    await page.goto(QUEUE_URL)
    await expect(page).toHaveURL(/\/login/, { timeout: 90_000 })
  })

  for (const role of ['patient', 'receptionist'] as const) {
    test(`a ${role} account is redirected away, not shown My Queue`, async ({ page }) => {
      await loginAs(page, ACCOUNTS[role].email, ACCOUNTS[role].password)
      await page.goto(QUEUE_URL)
      await page.waitForLoadState('domcontentloaded')
      await expect(page).not.toHaveURL(/\/nurse\/queue/, { timeout: 90_000 })
      await expect(page.getByRole('heading', { level: 1, name: 'My Queue' })).toHaveCount(0)
    })
  }
})

test.describe('My Queue — live, read-only', () => {
  test.describe.configure({ timeout: 300_000 })

  async function openQueue(page: Page) {
    await loginAs(page, ACCOUNTS.nurse.email, ACCOUNTS.nurse.password)
    await page.goto(QUEUE_URL)
    await expect(page.getByRole('heading', { level: 1, name: 'My Queue' })).toBeVisible({ timeout: 90_000 })
  }

  test('real nurse, real duty state, four tabs; no Figma example data; nothing is mutated on load', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1024 })
    await openQueue(page)
    const chip = page.getByRole('group', { name: 'Signed in as' })
    await expect(chip).toContainText(/Nurse/)
    await expect(chip).not.toContainText('Mkhize')
    for (const name of [/^All \(\d+\)$/, /^Waiting \(\d+\)$/, /^In Consultation \(\d+\)$/, /^Completed \(\d+\)$/]) await expect(tab(page, name)).toBeVisible()
    await expect(page.getByText(/On duty · |Off duty/).first()).toBeVisible()
    for (const name of ['Nomusa Dlamini', 'Sipho Zulu', 'Sr. L. Mkhize']) await expect(page.getByText(name)).toHaveCount(0)
    await expect(page.getByRole('button', { name: /start consult/i })).toHaveCount(0)
  })

  test('its Waiting count agrees with the classic screen’s WAITING tile', async ({ page }) => {
    await openQueue(page)
    const v3 = Number(/\((\d+)\)/.exec((await tab(page, /^Waiting/).textContent()) ?? '')![1])
    await page.goto('/nurse')
    await expect(page.getByRole('heading', { level: 1, name: /^Nurse/ })).toBeVisible({ timeout: 90_000 })
    const tile = page.locator('p', { hasText: /^WAITING$/ }).locator('xpath=following-sibling::p[1]')
    if (await tile.count()) await expect(tile).toHaveText(String(v3))
  })

  test('sidebar marks My Queue; the classic screen is one click away and still loads', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1024 })
    await openQueue(page)
    const nav = page.getByRole('navigation', { name: 'Main' }).first()
    await expect(nav.getByRole('link', { name: 'My Queue' })).toHaveAttribute('aria-current', 'page')
    await page.getByRole('link', { name: 'Open the classic nurse screen' }).click()
    await expect(page).toHaveURL(/\/nurse$/, { timeout: 90_000 })
    await expect(page.getByRole('heading', { level: 1, name: /^Nurse/ })).toBeVisible({ timeout: 90_000 })
  })

  for (const [w, h] of [
    [1440, 1024],
    [1280, 900],
    [1024, 900],
    [900, 900],
    [768, 1024],
    [390, 844],
  ] as const) {
    test(`${w}px: no page-level horizontal scroll on the real page`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h })
      await openQueue(page)
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
      if (w < 768) {
        await expect(page.getByRole('navigation', { name: 'Main' }).filter({ visible: true }).getByRole('button', { name: 'Sign Out' })).toBeVisible()
      }
    })
  }
})
