/**
 * Stand-in for lib/supabase/client.ts. BookingWizard only ever calls supabase.rpc('get_available_slots', ...)
 * client-side — every other read/write happens server-side (the page's services/clinic fetch, and the
 * bookAppointment Server Action, both already swapped separately). Reads resolve from the test's queue under
 * "rpc:get_available_slots".
 */
import { respond } from './state'

export function createClient() {
  return {
    rpc(name: string, args: unknown) {
      const run = () => respond(`rpc:${name}`, [args])
      return {
        then: (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) => run().then(ok, fail),
      }
    },
    from() {
      throw new Error('harness: BookingWizard must not read any table directly client-side')
    },
  }
}
