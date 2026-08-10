import type { Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../lib/types/database.types'

// Same publishable/anon values already committed in scripts/verify.ts —
// not a secret, RLS is the security boundary (ADR-010). This suite runs
// against the real shared dev backend, not a per-test-isolated database.
export const SUPABASE_URL = 'https://bffhjvpkfivtbzqielve.supabase.co'
export const SUPABASE_ANON_KEY = 'sb_publishable_uwBdyYKKd3bKm9SZ8tp8Rw_AbqRdoWD'

export const CLINIC_ID = '11111111-1111-1111-1111-111111111111'

export const ACCOUNTS = {
  patient: { email: 'thabo.patient@test.local', password: 'pw12345678' },
  receptionist: { email: 'grace.reception@riverside.test', password: 'staff-password-123' },
  nurse: { email: 'mabaso.nurse@riverside.test', password: 'staff-password-456' },
  admin: { email: 'admin@riverside.test', password: 'admin-password-789' },
}

/** A fresh client signed in as admin — reset_demo_state and clinic_settings writes both require this. Always sign out when done so the connection doesn't linger. */
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
 * Resets queue/consultation/notification state to a known baseline —
 * see migration demo_state_reset. Every test that touches shared queue
 * state calls this first; workers are forced to 1 (playwright.config.ts)
 * so no two tests race over it.
 */
export async function resetDemoState() {
  await withAdmin(async (admin) => {
    const { error } = await admin.rpc('reset_demo_state')
    if (error) throw new Error(`reset_demo_state failed: ${error.message}`)
  })
}

/** Admin-only write, same RLS path the admin settings page itself uses (settings_admin_write). */
export async function setStaffIdleTimeoutMinutes(minutes: number) {
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
