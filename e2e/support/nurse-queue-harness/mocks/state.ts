/**
 * Shared, in-page control surface for the harness. The Playwright test reads `calls` and pushes `responses`
 * through page.evaluate; nothing here talks to a network.
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
  queueListeners: Array<() => void>
  onlineListeners: Array<(online: boolean) => void>
  online: boolean
  fireQueueChange(): void
  setOnline(online: boolean): void
}

declare global {
  interface Window {
    __harness: Harness
    __harnessConfig: { mode: 'queue' | 'classic' | 'header'; props: Record<string, unknown>; defaults?: Record<string, HarnessResponse>; online?: boolean }
  }
}

export function createHarness(defaults: Record<string, HarnessResponse>, online: boolean): Harness {
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
    queueListeners: [],
    onlineListeners: [],
    online,
    fireQueueChange() {
      for (const l of [...h.queueListeners]) l()
    },
    setOnline(value) {
      h.online = value
      for (const l of [...h.onlineListeners]) l(value)
    },
  }
  return h
}

export async function respond(name: string, args: unknown[]): Promise<unknown> {
  const h = window.__harness
  h.calls.push({ name, args: JSON.parse(JSON.stringify(args ?? [])) })
  const r = h.responses[name]?.shift() ?? h.defaults[name]
  if (!r) throw new Error(`harness: no response configured for ${name}`)
  if (r.hold) await new Promise<void>((resolve) => (h.held[name] ??= []).push(resolve))
  if (r.throws) throw new Error(r.throws)
  return r.value === undefined ? undefined : JSON.parse(JSON.stringify(r.value))
}
