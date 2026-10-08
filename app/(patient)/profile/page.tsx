import { redirect } from 'next/navigation'
import { Pencil } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { LinkButton } from '@/components/ui/LinkButton'
import { PAGE_CLASS, PageHeader } from '@/components/patient/PageHeader'
import { formatCalendarDate } from '@/lib/clinicTime'
import { initials } from '@/lib/initials'

/**
 * Profile — V3 (Figma), read-only. Editing lives on /profile/settings.
 *
 * Filtered by auth_user_id explicitly: RLS would already scope a patient
 * to their own row, but "exactly one row" is this query's own invariant
 * (see the dashboard's profile query for why that matters).
 *
 * There's no profile photo in the schema, so the avatar is always the
 * patient's initials.
 */
export default async function ProfilePage() {
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

  const fields: { label: string; value: string | null; mono?: boolean }[] = [
    { label: 'Full name', value: profile.full_name },
    { label: 'ID or passport number', value: profile.id_number, mono: true },
    { label: 'Date of birth', value: profile.date_of_birth ? formatCalendarDate(profile.date_of_birth) : null },
    { label: 'Phone', value: profile.phone },
    { label: 'Email', value: user.email ?? null },
  ]

  return (
    <main className={PAGE_CLASS}>
      <PageHeader title="Profile" />

      <section className="mx-auto flex w-full max-w-xl flex-col items-center gap-6 rounded-lg border border-border bg-surface p-9">
        <div className="flex flex-col items-center gap-3 text-center">
          <span
            className="flex h-24 w-24 items-center justify-center rounded-full bg-primary-700 font-display text-[22px] font-semibold text-white"
            aria-hidden
          >
            {initials(profile.full_name)}
          </span>
          <p className="font-display text-[22px] font-semibold text-ink">{profile.full_name}</p>
          <p className="text-xs text-muted">
            Patient{profile.id_number ? <> &bull; <span className="font-mono">{profile.id_number}</span></> : null}
          </p>
        </div>

        <dl className="flex w-full flex-col">
          {fields.map(({ label, value, mono }) => (
            <div key={label} className="flex flex-col gap-1 border-b border-border py-4 last:border-b-0">
              <dt className="text-xs text-muted">{label}</dt>
              <dd className={`break-words text-base ${value ? 'text-ink' : 'text-muted'} ${mono && value ? 'font-mono' : ''}`}>
                {value ?? 'Not provided'}
              </dd>
            </div>
          ))}
        </dl>

        <LinkButton href="/profile/settings" variant="secondary" fullWidth>
          <Pencil size={20} className="mr-2" aria-hidden />
          Edit profile
        </LinkButton>
      </section>
    </main>
  )
}
