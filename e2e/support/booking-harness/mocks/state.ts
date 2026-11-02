/**
 * Shared, in-page control surface for the booking harness. The Playwright test reads `calls` and pushes
 * `responses` through page.evaluate; nothing here talks to a network. Same shape as
 * e2e/support/nurse-queue-harness/mocks/state.ts, namespaced to window.__bookingHarness so the two harnesses
 * never collide if a future spec somehow loaded both in one page.
 *
 * Fail-closed: a call with no queued response and no default throws, so an unexpected request can never
 * silently "succeed".
 */
export interface HarnessResponse {
  value?: unknown
  /** Reject the call with this message (a thrown/network failure, not an { error } result). */
  throws?: string
  /** Wait until the test calls release(name). */
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
    __bookingHarness: Harness
    __bookingHarnessConfig: { props: Record<string, unknown>; defaults?: Record<string, HarnessResponse> }
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
  const h = window.__bookingHarness
  h.calls.push({ name, args: JSON.parse(JSON.stringify(args ?? [])) })
  const r = h.responses[name]?.shift() ?? h.defaults[name]
  if (!r) throw new Error(`harness: no response configured for ${name}`)
  if (r.hold) await new Promise<void>((resolve) => (h.held[name] ??= []).push(resolve))
  if (r.throws) throw new Error(r.throws)
  return r.value === undefined ? undefined : JSON.parse(JSON.stringify(r.value))
}
