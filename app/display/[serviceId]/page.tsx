import { notFound } from 'next/navigation'
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
 * the same error branch here — this screen has no reason to distinguish
 * them for an unauthenticated viewer.
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

  if (error || !data) notFound()

  return <DisplayBoard serviceId={serviceId} initialDisplay={data} />
}
