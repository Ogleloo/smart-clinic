import { test, expect } from '@playwright/test'
import { ACCOUNTS, loginAs, resetDemoState, setStaffIdleTimeoutMinutes, waitSettled } from './helpers'

/**
 * The critical property from the staff-shared-device-sessions work: a
 * nurse can spend 40 minutes with a patient without touching the
 * computer, and re-authenticating after an idle timeout must not
 * change clinical state. idleLogout() only ever calls
 * supabase.auth.signOut() — never end_shift or next_patient — and
 * getNurseCurrentState() re-reads the open consultation straight from
 * the database on every load, not from anything the client remembered.
 *
 * staff_idle_timeout_minutes is a whole-minute column, and 1 is the
 * smallest value that still exercises the real timer (IdleTimeoutMonitor
 * warns immediately when timeoutMinutes is under its 2-minute lead, then
 * signs out at the full timeout) — so this test genuinely waits ~60s for
 * expiry rather than mocking the timer. That's a deliberate trade of
 * suite speed for testing the real mechanism, not simulating it.
 */
test('idle timeout during an open consultation preserves it across re-login', async ({ page }) => {
  test.setTimeout(180_000)
  await resetDemoState()
  await setStaffIdleTimeoutMinutes(1)

  try {
    await loginAs(page, ACCOUNTS.nurse.email, ACCOUNTS.nurse.password)

    await page.getByRole('button', { name: 'Call next patient' }).click()
    await waitSettled(page)

    const before = await page.locator('main').innerText()
    const tokenMatch = before.match(/GC-\d+/)
    expect(tokenMatch).not.toBeNull()
    const token = tokenMatch![0]
    expect(before).toContain('Christopher Wilson')

    // 1-minute timeout is below the 2-minute warning lead, so the
    // warning shows immediately — but "Call next patient" is a real DB
    // round trip, so give this some room rather than tying it to
    // client-side timer speed. The apostrophe in the rendered text is a
    // curly &rsquo; (’), not a straight ' — match either with `.`.
    await expect(
      page.getByText(/You.ll be signed out in 2 minutes due to inactivity/)
    ).toBeVisible({ timeout: 15_000 })

    // No activity for the remainder of the real 60s timeout — never
    // silently: the warning stays up the whole time, then expiry fires.
    await page.waitForURL('**/login**', { timeout: 75_000 })
    await expect(page.getByText('You were signed out because this device was inactive.')).toBeVisible()

    await loginAs(page, ACCOUNTS.nurse.email, ACCOUNTS.nurse.password)

    const after = await page.locator('main').innerText()
    expect(after).toContain('Christopher Wilson')
    expect(after).toContain(token)
  } finally {
    await setStaffIdleTimeoutMinutes(30)
  }
})
