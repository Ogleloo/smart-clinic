import { redirect } from 'next/navigation'
import { requireRole } from '@/lib/auth/requireRole'
import { updateStaffProfile, changeStaffPassword } from '@/app/actions/receptionProfile'
import { ProfileChip } from '@/components/reception/ProfileChip'
import { ProfileSettingsView } from '@/components/reception/ProfileSettingsView'
import { TYPE } from '@/components/reception/PageHeader'

/**
 * Reception V3 Phase 4 — Profile Settings (Figma frame 222:1755).
 * The account is always the signed-in user's: the profile row is looked up by
 * their own auth_user_id, never by an id from the browser. Role and clinic are
 * shown read-only; the database refuses writes to them regardless.
 */
export default async function ReceptionProfileSettingsPage() {
  const { supabase, user } = await requireRole('receptionist')

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('full_name, phone, role, clinic_id')
    .eq('auth_user_id', user.id)
    .single()
  if (!profile && !error) redirect('/login')

  const mainClass = 'mx-auto flex w-full max-w-[1176px] flex-col gap-4 px-4 pb-10 pt-4 md:gap-3.5 md:px-7 md:pt-3.5'

  if (error || !profile) {
    return (
      <main className={mainClass}>
        <h1 className={TYPE.pageTitle}>Profile Settings</h1>
        <div role="alert" className="rounded-lg border border-border bg-surface p-6">
          <p className="text-base font-semibold text-ink">Couldn&rsquo;t load your profile</p>
          <p className="text-base text-muted">Please refresh the page. If this keeps happening, contact your clinic administrator.</p>
        </div>
      </main>
    )
  }

  let clinicName: string | null = null
  if (profile.clinic_id) {
    const { data: clinic } = await supabase.from('clinics').select('name').eq('id', profile.clinic_id).maybeSingle()
    clinicName = clinic?.name ?? null
  }

  return (
    <main className={mainClass}>
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between lg:px-[6px]">
        <div className="flex flex-col lg:pt-2">
          <h1 className={TYPE.pageTitle}>Profile Settings</h1>
          <p className="text-base text-muted">Manage your personal information and avatar settings.</p>
        </div>
        <div className="w-full lg:max-w-[336px]">
          <ProfileChip fullName={profile.full_name} clinicName={clinicName} current />
        </div>
      </header>

      <ProfileSettingsView
        fullName={profile.full_name}
        phone={profile.phone}
        roleLabel="Receptionist"
        clinicName={clinicName}
        email={user.email ?? ''}
        saveAction={updateStaffProfile}
        passwordAction={changeStaffPassword}
        photoUploadAvailable={false}
      />
    </main>
  )
}
