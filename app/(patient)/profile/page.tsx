import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { logout } from '@/app/actions/auth'
import { Button } from '@/components/ui/Button'

/** Minimal for now — the bottom nav needs a real destination for its fourth tab, not a dead link. */
export default async function ProfilePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, phone')
    .eq('auth_user_id', user.id)
    .single()

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 px-4 py-6">
      <h1 className="font-display text-[22px] font-bold text-ink">Profile</h1>

      <section className="rounded-lg border border-border bg-surface p-5">
        <dl className="flex flex-col gap-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted">Name</dt>
            <dd className="font-semibold text-ink">{profile?.full_name ?? '—'}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">Email</dt>
            <dd className="font-semibold text-ink">{user.email}</dd>
          </div>
          {profile?.phone && (
            <div className="flex justify-between">
              <dt className="text-muted">Phone</dt>
              <dd className="font-semibold text-ink">{profile.phone}</dd>
            </div>
          )}
        </dl>
      </section>

      <form action={logout}>
        <Button type="submit" variant="tertiary" fullWidth>
          Log out
        </Button>
      </form>
    </main>
  )
}
