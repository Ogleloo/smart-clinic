import { redirect } from 'next/navigation'
import { Cake, IdCard, Mail, Pencil, Phone, User, type LucideIcon } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { LinkButton } from '@/components/ui/LinkButton'
import { PAGE_CLASS, PageHeader } from '@/components/patient/PageHeader'
import { formatCalendarDate } from '@/lib/clinicTime'

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('')
}

/**
 * Profile — V3, read-only. Editing lives on /profile/settings.
 *
 * Filtered by auth_user_id explicitly: RLS would already scope a patient
 * to their own row, but "exactly one row" is this query's own invariant
 * (see the dashboard's profile query for why that matters).
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
        <p className="text-sm font-semibold text-ink">Couldn&rsquo;t load your profile</p>
        <p className="text-sm text-muted">Please refresh the page.</p>
      </main>
    )
  }

  const fields: { label: string; value: string | null; icon: LucideIcon; mono?: boolean }[] = [
    { label: 'Full name', value: profile.full_name, icon: User },
    { label: 'ID or passport number', value: profile.id_number, icon: IdCard, mono: true },
    { label: 'Date of birth', value: profile.date_of_birth ? formatCalendarDate(profile.date_of_birth) : null, icon: Cake },
    { label: 'Phone', value: profile.phone, icon: Phone },
    { label: 'Email', value: user.email ?? null, icon: Mail },
  ]

  return (
    <main className={PAGE_CLASS}>
      <PageHeader
        title="Profile"
        action={
          <LinkButton href="/profile/settings" variant="secondary">
            <Pencil size={16} className="mr-2" aria-hidden />
            Edit profile
          </LinkButton>
        }
      />

      <section className="w-full max-w-3xl rounded-lg border border-border bg-surface">
        <div className="flex items-center gap-4 border-b border-border p-5">
          <span
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary-700 font-display text-lg font-bold text-white"
            aria-hidden
          >
            {initials(profile.full_name)}
          </span>
          <div>
            <p className="font-display text-lg font-semibold text-ink">{profile.full_name}</p>
            <p className="text-sm text-muted">Patient</p>
          </div>
        </div>
        <dl className="grid grid-cols-1 divide-y divide-border sm:grid-cols-2 sm:divide-y-0">
          {fields.map(({ label, value, icon: Icon, mono }) => (
            <div key={label} className="flex items-start gap-3 p-5 sm:border-b sm:border-border sm:last:col-span-2 sm:last:border-b-0">
              <Icon size={18} className="mt-0.5 shrink-0 text-muted" aria-hidden />
              <div className="min-w-0">
                <dt className="text-xs font-semibold tracking-wide text-muted">{label.toUpperCase()}</dt>
                <dd
                  className={`mt-0.5 break-words text-sm ${value ? 'font-semibold text-ink' : 'text-muted'} ${mono && value ? 'font-mono' : ''}`}
                >
                  {value ?? 'Not provided'}
                </dd>
              </div>
            </div>
          ))}
        </dl>
      </section>
    </main>
  )
}
