import { test, expect } from '@playwright/test'
import { ACCOUNTS, createTestClient, loginAs, resetDemoState, waitSettled } from './helpers'

/**
 * Regression test for migration undo_removes_false_notifications:
 * undoing a call used to leave the "you have been called" notification
 * in place even though the call itself was reversed — a patient who
 * was never actually served would still see (and could act on) a
 * notification telling them to come in.
 *
 * reset_demo_state checks General Consultation in this fixed order:
 * two no-login test patients, then Thabo — so calling "Next patient"
 * exactly 3 times always reaches Thabo specifically. That's required
 * here: notifications RLS (notifications_read_own) only lets a caller
 * read their own row, and Thabo is the only patient fixture with real
 * login credentials to verify against.
 */
test('undo removes the false "called" notification and reverses queue/consultation state', async ({ page }) => {
  await resetDemoState()

  await loginAs(page, ACCOUNTS.nurse.email, ACCOUNTS.nurse.password)

  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: /^(Call next patient|Next patient)$/ }).click()
    await waitSettled(page)
  }

  await expect(page.locator('main')).toContainText('Thabo Mokoena')
  const tokenMatch = (await page.locator('main').innerText()).match(/GC-\d+/)
  expect(tokenMatch).not.toBeNull()
  const token = tokenMatch![0]

  const asThabo = createTestClient()
  const { error: signInError } = await asThabo.auth.signInWithPassword(ACCOUNTS.patient)
  expect(signInError).toBeNull()

  const { data: entryBefore, error: entryError } = await asThabo
    .from('queue_entries')
    .select('id, status')
    .eq('status', 'in_progress')
    .single()
  expect(entryError).toBeNull()
  const entryId = entryBefore!.id

  // The call exists and produced exactly one "called" notification.
  const { count: calledBefore } = await asThabo
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('queue_entry_id', entryId)
    .eq('kind', 'called')
  expect(calledBefore).toBe(1)

  await page.getByRole('button', { name: /^Undo/ }).click()
  // Undoing this (the 3rd) call reopens the 2nd patient's consultation —
  // it does NOT return to idle, since there's a previous consultation for
  // it to restore. Thabo's name legitimately reappears elsewhere on the
  // page (the waiting list, once his entry reverts to 'waiting'), so
  // checking the whole page for its absence never settles. The reliable
  // signal is his own token showing "Waiting" in the waiting list row.
  await expect(page.locator('tr', { hasText: token })).toContainText('Waiting', { timeout: 15_000 })
  await waitSettled(page)

  const { data: entryAfter } = await asThabo
    .from('queue_entries')
    .select('status')
    .eq('id', entryId)
    .single()
  expect(entryAfter?.status).toBe('waiting')

  // Patients have no RLS read access to consultations at all (only
  // nurse/staff policies exist) — checking this as Thabo would pass
  // vacuously (zero rows either way) even if the delete never happened.
  const asNurse = createTestClient()
  await asNurse.auth.signInWithPassword(ACCOUNTS.nurse)
  const { data: consultationAfter } = await asNurse
    .from('consultations')
    .select('id')
    .eq('queue_entry_id', entryId)
  expect(consultationAfter ?? []).toHaveLength(0)
  await asNurse.auth.signOut()

  const { count: calledAfter } = await asThabo
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('queue_entry_id', entryId)
    .eq('kind', 'called')
  expect(calledAfter).toBe(0)

  await asThabo.auth.signOut()
})
