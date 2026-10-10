/**
 * Stand-in for lib/supabase/client.ts. Reads resolve from the test's queue under names like
 * "rpc:get_service_queue" and "from:consultations" (with the applied filters recorded as args). There is no
 * insert/update/delete/upsert: a write attempt throws.
 */
import { respond } from './state'

function query(table: string) {
  const filters: unknown[] = []
  const run = () => respond(`from:${table}`, filters)
  const builder: Record<string, unknown> = {
    then: (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) => run().then(ok, fail),
    maybeSingle: run,
    single: run,
  }
  for (const m of ['select', 'eq', 'neq', 'not', 'is', 'in', 'gte', 'lte', 'order', 'limit']) {
    builder[m] = (...args: unknown[]) => {
      filters.push([m, ...args])
      return builder
    }
  }
  for (const m of ['insert', 'update', 'delete', 'upsert']) {
    builder[m] = () => {
      throw new Error(`harness: write attempted (${m} on ${table})`)
    }
  }
  return builder
}

export function createClient() {
  return {
    rpc(name: string, args: unknown) {
      const run = () => respond(`rpc:${name}`, [args])
      return {
        then: (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) => run().then(ok, fail),
        maybeSingle: run,
        single: run,
      }
    },
    from: query,
    channel() {
      throw new Error('harness: realtime channels are mocked by broadcast.ts')
    },
  }
}
