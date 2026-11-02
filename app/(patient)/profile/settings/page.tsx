import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Info } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { ProfileSettingsForm, QuickActions } from '@/components/profile/ProfileSettingsForm'
import { PAGE_CLASS, PageHeader, TYPE } from '@/components/patient/PageHeader'
import { getPatientClinic } from '@/lib/patientClinic'
import { todayInClinicTimezone } from '@/lib/clinicTime'
import { initials } from '@/lib/initials'

const CARD = 'flex flex-col gap-5 rounded-lg border border-border bg-surface p-6 shadow-[0_8px_20px_rgba(5,48,46,0.05)]'
const PANEL_CARD = 'flex flex-col gap-4 rounded-lg border border-border bg-surface p-5 shadow-[0_12px_32px_rgba(5,48,46,0.08)]'

/**
 * Profile settings — V3 (Figma 222:2091). Editable details on the
 * left; avatar preview, a note on the photo/initials fallback, and
 * quick actions (Change Password, Sign Out) in the side panel.
 *
 * No avatar upload: docs/PROPOSAL_profile_photos.md is a proposal
 * only, not approved or applied — there's no photo column or storage
 * bucket behind it, so the preview is the initials the rest of the
 * app shows, same as /profile.
 */
export default async function ProfileSettingsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: profile, error }, clinic] = await Promise.all([
    supabase.from('profiles').select('full_name, phone, date_of_birth, id_number').eq('auth_user_id', user.id).single(),
    getPatientClinic(),
  ])

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

      <PageHeader title="Profile Settings" subtitle="Manage your personal information and avatar settings." />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_416px]">
        <section className={CARD} aria-labelledby="profile-information">
          <div className="flex flex-col gap-1">
            <h2 id="profile-information" className={TYPE.section}>
              Profile Information
            </h2>
            <p className="text-base text-muted">Update your personal details and contact information.</p>
          </div>
          <ProfileSettingsForm
            fullName={profile.full_name}
            phone={profile.phone}
            dateOfBirth={profile.date_of_birth}
            idNumber={profile.id_number}
            email={user.email ?? ''}
            roleLabel="Patient"
            clinicName={clinic?.name ?? null}
            today={todayInClinicTimezone()}
          />
        </section>

        <aside className="flex flex-col gap-4">
          <section className={`${PANEL_CARD} items-center text-center`} aria-labelledby="avatar-preview">
            <div className="flex w-full flex-col gap-1 text-left">
              <h2 id="avatar-preview" className="text-base leading-6 text-ink">
                Avatar Preview
              </h2>
              <p className="text-xs leading-[18px] text-muted">How your avatar appears across the system.</p>
            </div>
            <div className="h-px w-full bg-border" />
            <span
              className="flex size-[120px] items-center justify-center rounded-[24px] bg-primary-700 font-display text-[22px] font-semibold text-white"
              aria-hidden
            >
              {initials(profile.full_name) || '–'}
            </span>
            <p className="max-w-full break-words text-base leading-6 text-ink">{profile.full_name}</p>
            <p className="-mt-1 max-w-full break-words text-xs leading-[18px] text-muted">
              Patient{profile.id_number ? <> &bull; <span className="font-mono">{profile.id_number}</span></> : null}
            </p>
            <span className="rounded-[12px] bg-primary-50 px-4 py-1 text-xs leading-[18px] text-primary-700">
              Initials: {initials(profile.full_name) || '–'}
            </span>
          </section>

          <section className={`${PANEL_CARD} bg-primary-50`} aria-labelledby="photo-and-initials">
            <div className="flex items-center gap-3">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface text-primary-700">
                <Info size={22} aria-hidden />
              </span>
              <h2 id="photo-and-initials" className="text-base leading-6 text-ink">
                Photo and initials
              </h2>
            </div>
            <div className="h-px bg-border" />
            <p className="text-xs leading-[18px] text-muted">
              Your photo appears on your profile. If you remove it, we&rsquo;ll show your initials.
            </p>
          </section>

          <section className={PANEL_CARD} aria-labelledby="quick-actions">
            <h2 id="quick-actions" className="text-base leading-6 text-ink">
              Quick Actions
            </h2>
            <div className="h-px bg-border" />
            <QuickActions />
          </section>
        </aside>
      </div>
    </main>
  )
}
