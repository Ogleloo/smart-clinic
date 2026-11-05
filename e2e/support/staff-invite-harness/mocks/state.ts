/**
 * Shared, in-page control surface for the staff-invite harness. The Playwright test reads `calls` and pushes
 * `responses` through page.evaluate; nothing here talks to a network. Namespaced to window.__staffHarness so
 * it never collides with the other harnesses in this suite.
 */
export interface HarnessResponse {
  value?: unknown
  hold?: boolean
}

export interface Harness {
  calls: { name: string; args: unknown[] }[]
  responses: Record<string, HarnessResponse[]>
  defaults: Record<string, HarnessResponse>
  held: Record<string, Array<() => void>>
  release(name: string): number
}

declare global {
  interface Window {
    __staffHarness: Harness
    __staffHarnessConfig: { mode: 'invite' | 'invitations'; props: Record<string, unknown>; defaults?: Record<string, HarnessResponse> }
  }
}

export function createHarness(defaults: Record<string, HarnessResponse>): Harness {
  const h: Harness = {
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

export async function respond(name: string, args: unknown[]): Promise<unknown> {
  const h = window.__staffHarness
  h.calls.push({ name, args: JSON.parse(JSON.stringify(args ?? [])) })
  const r = h.responses[name]?.shift() ?? h.defaults[name]
  if (!r) throw new Error(`harness: no response configured for ${name}`)
  if (r.hold) await new Promise<void>((resolve) => (h.held[name] ??= []).push(resolve))
  return r.value === undefined ? undefined : JSON.parse(JSON.stringify(r.value))
}
