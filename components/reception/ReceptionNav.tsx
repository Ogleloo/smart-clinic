'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const LINKS = [
  { href: '/reception', label: 'Dashboard' },
  { href: '/reception/appointments', label: "Today's appointments" },
  { href: '/reception/walk-in', label: 'Register walk-in' },
  { href: '/reception/queue', label: 'Queue' },
]

export function ReceptionNav() {
  const pathname = usePathname()

  return (
    <nav className="flex items-center gap-1 border-b border-border pb-3">
      {LINKS.map((link) => {
        const isActive = link.href === '/reception' ? pathname === link.href : pathname.startsWith(link.href)
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
              isActive ? 'bg-primary-50 text-primary-700' : 'text-muted hover:bg-subtle'
            }`}
          >
            {link.label}
          </Link>
        )
      })}
    </nav>
  )
}
