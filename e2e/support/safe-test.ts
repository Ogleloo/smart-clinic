import { test as base, expect, type BrowserContext } from '@playwright/test'
import { isMutatingSupabaseRequest } from './e2e-safety'

/**
 * Browser-level protection for READ-ONLY live specs: the context aborts, and records, any request to a Supabase API that
 * would change data (PATCH/PUT/DELETE, a POST to a table or to a write RPC, auth changes other than signing in and out,
 * storage writes, edge-function calls). Returns the list it appends to.
 *
 * Limit, stated plainly: a Server Action runs on the app server, so its writes are invisible to the browser and cannot be
 * classified here. That is why read-only specs may not click mutation-capable controls at all — enforced statically by
 * findMutationSubmissions() (e2e/e2e-safety.spec.ts) — and why any test that submits a Server Action, even one expected to
 * be rejected, is a destructive spec (local stack only).
 */
export async function installReadOnlyGuard(context: BrowserContext): Promise<string[]> {
  const blocked: string[] = []
  await context.route(
    (url) => isMutatingSupabaseRequest('POST', url.href) || isMutatingSupabaseRequest('PATCH', url.href),
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

/** The `test` for read-only live specs: the guard is installed on every context and the test FAILS if it had to block anything. */
export const test = base.extend<{ context: BrowserContext }>({
  context: async ({ context }, provide) => {
    const blocked = await installReadOnlyGuard(context)
    await provide(context)
    expect(blocked, 'a read-only spec tried to change data through the browser').toEqual([])
  },
})
export { expect }
