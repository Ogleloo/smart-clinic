import { createClient } from '@/lib/supabase/server'
import { DisplayBoard } from '@/components/display/DisplayBoard'

/**
 * Public waiting-room display board (ADR-028). No login: this is meant
 * to run unattended on a screen in the clinic, so the auth middleware
 * explicitly allowlists /display. get_public_queue_display is the only
 * function callable by the anon role in this system — everything it
 * returns is a token or a count, never a name, id, or appointment.
 *
 * "Service not found" (raised by the function itself for a missing or
 * deactivated service) and RLS/permission errors both fall through to
 * the same friendly message here — a TV mounted in a waiting room must
 * never show a stack trace or go blank, and there's no reason to
 * distinguish the two failure causes for an unattended, unauthenticated
 * screen. Rendered inline (not next/navigation's notFound()) so it
 * keeps this screen's own dark, full-bleed styling instead of the
 * app's generic 404 page.
 */
export default async function DisplayPage({
  params,
}: {
  params: Promise<{ serviceId: string }>
}) {
  const { serviceId } = await params
  const supabase = await createClient()

  const { data, error } = await supabase
    .rpc('get_public_queue_display', { p_service_id: serviceId })
    .single()

  if (error || !data) {
    return (
      <main className="flex h-dvh w-dvw flex-col items-center justify-center gap-4 bg-primary-900 text-center">
        <p className="font-display text-[clamp(28px,3vw,48px)] font-bold text-white">
          This board is unavailable
        </p>
        <p className="text-[clamp(16px,1.4vw,24px)] text-primary-100">
          Please speak to reception.
        </p>
      </main>
    )
  }

  return <DisplayBoard initialDisplay={data} />
}
