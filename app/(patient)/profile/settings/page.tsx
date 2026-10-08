import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, KeyRound, LogOut } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { logout } from '@/app/actions/auth'
import { ChangePasswordForm, ProfileSettingsForm } from '@/components/profile/ProfileSettingsForm'
import { PAGE_CLASS, PageHeader, TYPE } from '@/components/patient/PageHeader'
import { todayInClinicTimezone } from '@/lib/clinicTime'
import { initials } from '@/lib/initials'

const CARD = 'flex flex-col gap-5 rounded-lg border border-border bg-surface p-6'

/**
 * Profile settings — V3 (Figma). Editable details and password on the
 * left; avatar preview and quick actions (Change Password, Sign Out) in
 * the side panel.
 *
 * No avatar upload: there's no photo column or storage bucket behind
 * it, so the preview is the initials the rest of the app shows.
 */
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
        <p className="text-base font-semibold text-ink">Couldn&rsquo;t load your profile</p>
        <p className="text-base text-muted">Please refresh the page.</p>
      </main>
    )
  }

  return (
    <main className={PAGE_CLASS}>
      <Link href="/profile" className="inline-flex w-fit items-center gap-2 text-sm font-semibold text-primary-700">
        <ArrowLeft size={20} aria-hidden />
        Back to profile
      </Link>

      <PageHeader title="Profile settings" />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <section className={CARD} aria-labelledby="personal-details">
            <h2 id="personal-details" className={TYPE.section}>
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

          <section id="password" className={`${CARD} scroll-mt-6`} aria-labelledby="change-password">
            <h2 id="change-password" className={TYPE.section}>
              Change password
            </h2>
            <ChangePasswordForm />
          </section>
        </div>

        <aside className="flex h-fit flex-col gap-6">
          <section className={`${CARD} items-center text-center`} aria-labelledby="avatar-preview">
            <h2 id="avatar-preview" className={`${TYPE.section} self-start`}>
              Avatar Preview
            </h2>
            <span
              className="flex h-24 w-24 items-center justify-center rounded-full bg-primary-700 font-display text-[22px] font-semibold text-white"
              aria-hidden
            >
              {initials(profile.full_name)}
            </span>
            <span className="rounded-full bg-card-mint px-3 py-1 text-sm font-semibold text-primary-700">
              {initials(profile.full_name)}
            </span>
            <p className="text-xs text-muted">Your initials are shown wherever your photo would appear.</p>
          </section>

          <section className={CARD} aria-labelledby="quick-actions">
            <h2 id="quick-actions" className={TYPE.section}>
              Quick actions
            </h2>
            <a
              href="#password"
              className="inline-flex min-h-11 items-center gap-3 rounded-md border border-border px-4 text-sm font-semibold text-ink hover:border-primary-700 hover:text-primary-700"
            >
              <KeyRound size={20} aria-hidden />
              Change Password
            </a>
            <form action={logout}>
              <button
                type="submit"
                className="inline-flex min-h-11 w-full items-center gap-3 rounded-md border-[1.5px] border-danger px-4 text-sm font-semibold text-danger hover:bg-danger-bg"
              >
                <LogOut size={20} aria-hidden />
                Sign Out
              </button>
            </form>
          </section>
        </aside>
      </div>
    </main>
  )
}
