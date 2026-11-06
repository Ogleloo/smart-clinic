/**
 * Shared, in-page control surface for the sign-out-confirmation harness. The Playwright test reads `calls` and
 * pushes `responses` through page.evaluate; nothing here talks to a network. Namespaced to window.__signOutHarness
 * so it never collides with the other harnesses in this suite.
 *
 * `hold` is what makes the pending state testable: the mocked logout() parks until the test releases it, which is
 * the window in which a second click could fire a second sign-out.
 */
export interface SignOutHarnessResponse {
  hold?: boolean
}

export interface SignOutHarness {
  calls: { name: string }[]
  responses: Record<string, SignOutHarnessResponse[]>
  defaults: Record<string, SignOutHarnessResponse>
  held: Record<string, Array<() => void>>
  release(name: string): number
}

declare global {
  interface Window {
    __signOutHarness: SignOutHarness
    __signOutHarnessConfig: { instances: number; defaults?: Record<string, SignOutHarnessResponse> }
  }
}

export function createSignOutHarness(defaults: Record<string, SignOutHarnessResponse>): SignOutHarness {
  const h: SignOutHarness = {
    calls: [],
    responses: {},
    defaults,
    held: {},
    release(name) {
      const list = h.held[name] ?? []
      const next = list.shift()
      next?.()
      return list.length
    },
  }
  return h
}

export async function respond(name: string): Promise<void> {
  const h = window.__signOutHarness
  h.calls.push({ name })
  const r = h.responses[name]?.shift() ?? h.defaults[name]
  if (r?.hold) await new Promise<void>((resolve) => (h.held[name] ??= []).push(resolve))
}
