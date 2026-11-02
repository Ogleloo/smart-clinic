/** Stand-in for app/actions/auth.ts — only logout() is used by ProfileSettingsForm's QuickActions. */
import '../types'

export async function logout() {
  window.__profileHarness.calls.push({ name: 'logout', args: [] })
}
