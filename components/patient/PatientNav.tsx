'use client'

import { useUnreadCount } from '@/lib/hooks/useUnreadCount'
import { Sidebar } from './Sidebar'
import { BottomNav } from './BottomNav'

interface PatientNavProps {
  initialUnreadCount: number
  clinicName: string | null
  clinicPhone: string | null
}

/** Owns the single unread-count subscription that both navs display. */
export function PatientNav({ initialUnreadCount, clinicName, clinicPhone }: PatientNavProps) {
  const unreadCount = useUnreadCount(initialUnreadCount)
  return (
    <>
      <Sidebar unreadCount={unreadCount} clinicName={clinicName} clinicPhone={clinicPhone} />
      <BottomNav unreadCount={unreadCount} />
    </>
  )
}
