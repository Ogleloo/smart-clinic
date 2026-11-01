import { CircleAlert } from 'lucide-react'
import { LinkButton } from '@/components/ui/LinkButton'
import { describeMissingFields, type MissingProfileField } from '@/lib/profileCompleteness'

/**
 * "Complete your profile" — shown on the patient Profile page while the date of birth and/or the
 * ID or passport number is missing, and not at all once both are present.
 *
 * It receives only the names of the missing fields (see lib/profileCompleteness.ts), so it cannot
 * display an ID or passport number. It is static server-rendered content, so it is a labelled
 * region rather than a live alert: it does not interrupt a screen reader, but it can be found by
 * landmark navigation and is read in page order, straight after the page title.
 */
export function ProfileCompletionNotice({ missing }: { missing: MissingProfileField[] }) {
  if (missing.length === 0) return null

  return (
    <section
      aria-labelledby="profile-completion-title"
      className="mx-auto flex w-full max-w-xl flex-col gap-4 rounded-lg border border-warning bg-warning-bg p-6"
    >
      <div className="flex items-start gap-3">
        <CircleAlert size={24} className="mt-0.5 shrink-0 text-warning" aria-hidden />
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id="profile-completion-title" className="font-display text-[22px] font-semibold text-ink">
            Complete your profile
          </h2>
          <p className="break-words text-base text-ink">
            Your {describeMissingFields(missing)} {missing.length > 1 ? 'are' : 'is'} missing. You already have an
            account, so there&rsquo;s no need to register again &mdash; add the missing{' '}
            {missing.length > 1 ? 'details' : 'detail'} in your profile settings.
          </p>
        </div>
      </div>
      <LinkButton href="/profile/settings" fullWidth>
        Complete profile
      </LinkButton>
    </section>
  )
}
