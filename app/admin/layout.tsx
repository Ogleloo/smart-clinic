import { requireRole } from '@/lib/auth/requireRole'
import { AdminNav } from '@/components/admin/AdminNav'
import { LogoutButton } from '@/components/ui/LogoutButton'

/** Admin area (Slice 7). Desktop-first, same shell pattern as reception/nurse. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireRole('admin')

  return (
    <main className="mx-auto flex min-h-dvh max-w-[820px] flex-col gap-5 px-6 py-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-ink">Admin</h1>
        <LogoutButton />
      </div>
      <AdminNav />
      {children}
    </main>
  )
}
