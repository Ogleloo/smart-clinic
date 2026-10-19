import { test as base, expect, type BrowserContext, type Page } from '@playwright/test'
import { isMutatingSupabaseRequest } from './e2e-safety'

/**
 * Browser-level protection for READ-ONLY live specs. Three parts:
 *
 *  1. The context aborts, and records, any request to a Supabase API that would change data: PATCH/PUT/DELETE, a POST to a
 *     table, a POST to any RPC that is not on the READ_ONLY_RPCS allowlist, any non-GET GraphQL request, auth changes other
 *     than signing in and out, storage writes, edge-function calls (see isMutatingSupabaseRequest).
 *  2. SEALED: a spec cannot route around that guard at run time. `page.route` / `context.route` (a page route that calls
 *     route.continue() would skip the context guard — Playwright runs page routes first), `routeFromHAR`, `addInitScript`,
 *     `exposeFunction`, extra headers, and the APIRequestContext (`page.request`, `context.request`, the `request` fixture —
 *     none of which pass through routes) all THROW. The static audit (read-only-audit.ts) rejects the same constructs in
 *     the source; this is the second, independent layer.
 *  3. The test FAILS at teardown if the guard had to block anything — so a blocked write is a visible failure, not a
 *     quiet pass.
 *
 * Limits, stated plainly: a Server Action runs on the app server, so its writes are invisible to the browser and cannot be
 * classified here. That is why read-only specs may only click an allowlisted control — enforced statically by
 * findMutationSubmissions() (e2e/e2e-safety.spec.ts) — and why any test that submits a Server Action, even one expected to be
 * rejected, is a destructive spec (local stack only). The `browser` fixture cannot be sealed (Playwright builds the context
 * from it); `browser.newContext()` is rejected statically only. Realtime websockets are not inspected.
 */
export async function installReadOnlyGuard(context: BrowserContext): Promise<string[]> {
  const blocked: string[] = []
  await context.route(
    (url) => /^\/(rest|auth|storage|functions|graphql)\/v1(\/|$)/.test(url.pathname),
    async (route) => {
      const req = route.request()
      if (isMutatingSupabaseRequest(req.method(), req.url())) {
        blocked.push(`${req.method()} ${new URL(req.url()).pathname}`)
        return route.abort('blockedbyclient')
      }
      return route.fallback()
    }
  )
  return blocked
}

const refuse = (what: string) => () => {
  throw new Error(`${what} is not available in a read-only spec: it could send or rewrite requests outside the read-only guard (e2e/support/safe-test.ts)`)
}

/**
 * Wraps an APIRequestContext so that every method that SENDS a request throws, while the rest (dispose, storageState — which
 * Playwright's own runner calls) passes through. Returned as a Proxy so Playwright's internals keep working.
 */
function refuseSending<T extends object>(real: T, label: string): T {
  const sending = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'fetch'])
  return new Proxy(real, {
    get(target, prop) {
      if (typeof prop === 'string' && sending.has(prop)) return refuse(`${label}.${prop}()`)
      const value = Reflect.get(target, prop, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

/** Makes the ways around the guard throw. Idempotent. Applied to the guarded context and to every page it opens. */
export function sealReadOnlyContext(context: BrowserContext): void {
  const seal = (target: object, members: string[], label: string) => {
    for (const m of members) Object.defineProperty(target, m, { value: refuse(`${label}.${m}`), configurable: true, writable: true })
    const real = (target as { request?: object }).request
    if (real) Object.defineProperty(target, 'request', { value: refuseSending(real, `${label}.request`), configurable: true, writable: true })
  }
  const sealPage = (page: Page) => seal(page, ['route', 'routeFromHAR', 'routeWebSocket', 'addInitScript', 'exposeFunction', 'exposeBinding', 'setExtraHTTPHeaders'], 'page')
  seal(context, ['route', 'routeFromHAR', 'routeWebSocket', 'addInitScript', 'exposeFunction', 'exposeBinding', 'setExtraHTTPHeaders'], 'context')
  for (const page of context.pages()) sealPage(page)
  context.on('page', sealPage)
}

/** The `test` for read-only live specs: guard installed and sealed on every context; the test FAILS if it had to block anything. */
export const test = base.extend<{ context: BrowserContext }>({
  context: async ({ context }, provide) => {
    const blocked = await installReadOnlyGuard(context)
    sealReadOnlyContext(context)
    await provide(context)
    expect(blocked, 'a read-only spec tried to change data through the browser').toEqual([])
  },
  // The standalone APIRequestContext is not routed, so the guard could not see it: a spec that asks for it fails at once.
  request: async ({ request }, provide) => {
    await provide(refuseSending(request, 'the `request` fixture'))
  },
})
export { expect }
