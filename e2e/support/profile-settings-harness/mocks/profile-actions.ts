/**
 * Stand-in for app/actions/profile.ts. Same exported names and call shapes; updateProfile() always returns
 * whatever the test configured as __profileHarnessConfig.updateProfileResponse (a real Server Action is never
 * reached — no Supabase, no network). changePassword() is a harmless no-op recorder: nothing in this harness's
 * tests submits the password panel.
 */
import type { ActionState } from '../../../../app/actions/profile'
import '../types'

const form = (fd: FormData) => Object.fromEntries(fd.entries())

export async function updateProfile(_prev: ActionState, formData: FormData): Promise<ActionState> {
  window.__profileHarness.calls.push({ name: 'updateProfile', args: [form(formData)] })
  return window.__profileHarnessConfig.updateProfileResponse
}

export async function changePassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  window.__profileHarness.calls.push({ name: 'changePassword', args: [form(formData)] })
  return {}
}
