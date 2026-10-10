export async function logout() {
  window.__harness.calls.push({ name: 'logout', args: [] })
}
