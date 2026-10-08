import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, KeyRound, LogOut, User } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { logout } from '@/app/actions/auth'
import { Button } from '@/components/ui/Button'
import { ChangePasswordForm, ProfileSettingsForm } from '@/components/profile/ProfileSettingsForm'
import { PAGE_CLASS, PageHeader } from '@/components/patient/PageHeader'
import { todayInClinicTimezone } from '@/lib/clinicTime'

/** Profile settings — V3. Editable details, password change, sign out. */
export default async function ProfileSettingsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('full_name, phone, date_of_birth, id_number')
    .eq('auth_user_id', user.id)
    .single()

  if (error || !profile) {
    return (
      <main className={PAGE_CLASS}>
        <p className="text-sm font-semibold text-ink">Couldn&rsquo;t load your profile</p>
        <p className="text-sm text-muted">Please refresh the page.</p>
      </main>
    )
  }

  return (
    <main className={PAGE_CLASS}>
      <Link href="/profile" className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-primary-700">
        <ArrowLeft size={16} aria-hidden />
        Back to profile
      </Link>

      <PageHeader title="Profile settings" />

      <section className="flex w-full max-w-3xl flex-col gap-4 rounded-lg border border-border bg-surface p-5">
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-ink">
          <User size={18} aria-hidden />
          Personal details
        </h2>
        <ProfileSettingsForm
          fullName={profile.full_name}
          phone={profile.phone}
          dateOfBirth={profile.date_of_birth}
          idNumber={profile.id_number}
          email={user.email ?? ''}
          today={todayInClinicTimezone()}
        />
      </section>

      <section
        id="password"
        className="flex w-full max-w-3xl scroll-mt-6 flex-col gap-4 rounded-lg border border-border bg-surface p-5"
      >
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-ink">
          <KeyRound size={18} aria-hidden />
          Change password
        </h2>
        <ChangePasswordForm />
      </section>

      <section className="flex w-full max-w-3xl flex-col gap-3 rounded-lg border border-border bg-surface p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-lg font-semibold text-ink">Sign out</h2>
          <p className="text-sm text-muted">Always sign out on a shared or clinic device.</p>
        </div>
        <form action={logout}>
          <Button type="submit" variant="secondary">
            <LogOut size={16} className="mr-2" aria-hidden />
            Sign out
          </Button>
        </form>
      </section>
    </main>
  )
}
