'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCallback, useState } from 'react'
import { Home, Users, Bell, User } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useNotificationsRealtime } from '@/lib/hooks/useNotificationsRealtime'

const TABS = [
  { href: '/dashboard', label: 'Home', icon: Home },
  { href: '/queue', label: 'Queue', icon: Users },
  { href: '/notifications', label: 'Alerts', icon: Bell },
  { href: '/profile', label: 'Profile', icon: User },
]

/** Deferred from Slice 1 (no /notifications or /profile to link to yet) — built now that both exist. */
export function BottomNav({ initialUnreadCount }: { initialUnreadCount: number }) {
  const pathname = usePathname()
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

  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-surface">
      <div className="mx-auto flex max-w-md items-center justify-around px-2 py-2">
        {TABS.map((tab) => {
          const isActive = pathname === tab.href
          const Icon = tab.icon
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`relative flex flex-col items-center gap-0.5 rounded-md px-4 py-1.5 text-xs font-semibold ${
                isActive ? 'text-primary-700' : 'text-muted'
              }`}
            >
              {/* Icon above the label, not replacing it — icons aid recognition for users with limited literacy, labels keep it unambiguous. */}
              <Icon size={20} aria-hidden />
              {tab.label}
              {tab.label === 'Alerts' && unreadCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
