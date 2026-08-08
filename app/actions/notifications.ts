'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

/**
 * Called directly as a function (on mount, on button click) rather than
 * bound to a <form action>, unlike every other mutation in this app —
 * "mark as read" isn't a form submission with its own pending/error UI,
 * it's an imperative background update. Next.js Server Actions support
 * being invoked this way directly from a Client Component.
 */
export async function markNotificationsRead(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('mark_notifications_read', { p_ids: ids })
  if (error) {
    console.error('mark_notifications_read failed:', error.message)
    return 0
  }

  revalidatePath('/notifications')
  return data ?? 0
}
