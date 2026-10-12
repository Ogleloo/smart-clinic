import type { Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../lib/types/database.types'
import { PRODUCTION_PROJECT_REF } from './support/local-supabase-guard'

/**
 * Where these specs run and who they sign in as come from the ENVIRONMENT. Nothing here defaults to the shared
 * production project and no credential is committed (they were, and the repository is public — see
 * docs/proposals/staged_migration_plan.md, finding C0). Test-account passwords live in the team password manager.
 *
 *   E2E_SUPABASE_URL, E2E_SUPABASE_ANON_KEY            the project the specs talk to
 *   E2E_{PATIENT,RECEPTIONIST,NURSE,ADMIN}_EMAIL / _PASSWORD
 *
 * Specs that WRITE shared state (queue, consultations, notifications, clinic settings) are disabled by default
 * (playwright.config.ts) and their helpers below refuse to run against anything but a local stack.
 */
export const SUPABASE_URL = (process.env.E2E_SUPABASE_URL ?? '').trim()
export const SUPABASE_ANON_KEY = (process.env.E2E_SUPABASE_ANON_KEY ?? '').trim()

export const CLINIC_ID = '11111111-1111-1111-1111-111111111111'

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(
      `${name} is not set. Test-account credentials are kept in the team password manager and supplied through the environment — they are never committed.`
    )
  }
  return value
}

/** Looked up when read, so importing this module (or listing tests) needs no credentials. */
function account(role: 'PATIENT' | 'RECEPTIONIST' | 'NURSE' | 'ADMIN') {
  return {
    get email() {
      return required(`E2E_${role}_EMAIL`)
    },
    get password() {
      return required(`E2E_${role}_PASSWORD`)
    },
  }
}

export const ACCOUNTS = {
  patient: account('PATIENT'),
  receptionist: account('RECEPTIONIST'),
  nurse: account('NURSE'),
  admin: account('ADMIN'),
}

/**
 * Refuses unless the configured project is a local stack. Destructive helpers (reset_demo_state, clinic-settings
 * writes) must never touch the shared project: it is production and previews share it.
 */
function assertLocalStack(action: string) {
  let host = ''
  try {
    host = new URL(SUPABASE_URL).hostname
  } catch {
    /* handled below */
  }
  if (!SUPABASE_URL || SUPABASE_URL.includes(PRODUCTION_PROJECT_REF) || !['localhost', '127.0.0.1'].includes(host)) {
    throw new Error(
      `${action} is destructive and only runs against a local Supabase stack. E2E_SUPABASE_URL is "${SUPABASE_URL || '(not set)'}". ` +
        'Start a local stack and set E2E_SUPABASE_URL to http://127.0.0.1:<port>.'
    )
  }
}

/** A fresh client signed in as admin — only ever used by the destructive helpers below, which require a local stack. Always sign out when done. */
async function withAdmin<T>(fn: (admin: ReturnType<typeof createClient<Database>>) => Promise<T>): Promise<T> {
  const admin = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY)
  const { error } = await admin.auth.signInWithPassword(ACCOUNTS.admin)
  if (error) throw new Error(`Admin sign-in failed: ${error.message}`)
  try {
    return await fn(admin)
  } finally {
    await admin.auth.signOut()
  }
}

/**
 * Resets queue/consultation/notification state to a known baseline — see migration demo_state_reset. LOCAL STACK
 * ONLY: it resets every clinic, so it is refused against the shared project. Specs that call it are disabled by
 * default (E2E_ENABLE_DESTRUCTIVE=1, local stack required).
 */
export async function resetDemoState() {
  assertLocalStack('resetDemoState()')
  await withAdmin(async (admin) => {
    const { error } = await admin.rpc('reset_demo_state')
    if (error) throw new Error(`reset_demo_state failed: ${error.message}`)
  })
}

/** Admin-only write, same RLS path the admin settings page itself uses (settings_admin_write). LOCAL STACK ONLY. */
export async function setStaffIdleTimeoutMinutes(minutes: number) {
  assertLocalStack('setStaffIdleTimeoutMinutes()')
  await withAdmin(async (admin) => {
    const { error } = await admin
      .from('clinic_settings')
      .update({ staff_idle_timeout_minutes: minutes })
      .eq('clinic_id', CLINIC_ID)
    if (error) throw new Error(`Failed to set staff_idle_timeout_minutes: ${error.message}`)
  })
}

/** A plain, unauthenticated client for signing in as a specific test account to run DB-level assertions (e.g. notification counts) that the UI doesn't surface directly. */
export function createTestClient() {
  return createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY)
}

export async function loginAs(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.fill('input[name="email"]', email)
  await page.fill('input[name="password"]', password)
  await page.click('button[type="submit"]')
  await waitSettled(page)
}

/** Every server action in this app renders "Please wait…" on its submit button while pending — this is the one wait condition shared by all of them. */
export async function waitSettled(page: Page, timeout = 30_000) {
  await page.waitForFunction(() => !document.body.innerText.includes('Please wait'), { timeout })
  await page.waitForTimeout(300)
}

/** V3 booking wizard, step 1 → step 2: pick a service card and continue to the calendar. */
export async function chooseBookingService(page: Page, serviceName: string) {
  await page.goto('/book')
  await page.getByText(serviceName, { exact: true }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
}

/** V3 booking calendar: page forward month by month until the YYYY-MM-DD day is on screen, then pick it. */
export async function pickBookingDate(page: Page, dateStr: string) {
  for (let i = 0; i < 24; i++) {
    const day = page.locator(`button[data-date="${dateStr}"]`)
    if ((await day.count()) > 0) {
      await day.click()
      return
    }
    await page.getByRole('button', { name: 'Next month' }).click()
  }
  throw new Error(`Calendar never reached ${dateStr}`)
}
