'use client'

import { useCallback, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useNotificationsRealtime } from '@/lib/hooks/useNotificationsRealtime'

/**
 * Live unread-notification count for the patient nav badge. RLS scopes
 * notifications to the caller, so the count is this patient's own.
 * One instance feeds both the desktop sidebar and the mobile bottom
 * nav, so there's a single realtime subscription for the badge.
 */
export function useUnreadCount(initialUnreadCount: number) {
  const [supabase] = useState(() => createClient())
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount)

  const refresh = useCallback(async () => {
    const { count } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .is('read_at', null)
    setUnreadCount(count ?? 0)
  }, [supabase])

  useNotificationsRealtime(refresh)

  return unreadCount
}
