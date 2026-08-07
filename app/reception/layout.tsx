import { requireRole } from '@/lib/auth/requireRole'
import { ReceptionNav } from '@/components/reception/ReceptionNav'

/**
 * Reception area (Slice 4). Desktop-first (820px reference in Figma) —
 * unlike the mobile patient screens, so no bottom nav / max-w-md here.
 */
export default async function ReceptionLayout({ children }: { children: React.ReactNode }) {
  await requireRole('receptionist')

  return (
    <main className="mx-auto flex min-h-dvh max-w-[820px] flex-col gap-5 px-6 py-6">
      <h1 className="font-display text-2xl font-bold text-ink">Reception</h1>
      <ReceptionNav />
      {children}
    </main>
  )
}
