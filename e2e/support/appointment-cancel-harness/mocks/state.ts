/**
 * Shared, in-page control surface for the appointment-cancel harness. The Playwright test reads `calls` and
 * pushes `responses` through page.evaluate; nothing here talks to a network. Same shape as the booking
 * harness's own mocks/state.ts, namespaced to window.__cancelHarness so the two never collide.
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
    __cancelHarness: Harness
    __cancelHarnessConfig: { props: Record<string, unknown>; defaults?: Record<string, HarnessResponse> }
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
  const h = window.__cancelHarness
  h.calls.push({ name, args: JSON.parse(JSON.stringify(args ?? [])) })
  const r = h.responses[name]?.shift() ?? h.defaults[name]
  if (!r) throw new Error(`harness: no response configured for ${name}`)
  if (r.hold) await new Promise<void>((resolve) => (h.held[name] ??= []).push(resolve))
  return r.value === undefined ? undefined : JSON.parse(JSON.stringify(r.value))
}
