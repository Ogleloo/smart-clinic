import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { homeForRole } from '@/lib/auth/homeForRole'
import { LinkButton } from '@/components/ui/LinkButton'
import type { PublicQueueDisplay, UserRole } from '@/lib/types/database.types'

const HOW_IT_WORKS = [
  {
    title: 'Book online or walk in',
    body: 'Reserve a slot ahead of time, or arrive and register at reception.',
  },
  {
    title: 'Check in at reception',
    body: 'Arriving lets the queue know you’re here, whether you booked or walked in.',
  },
  {
    title: 'Follow your position live',
    body: 'Your token, position and estimated wait update as the queue moves.',
  },
] as const

/**
 * get_public_queue_display(), called with no argument, now returns one row
 * per active service directly (migration 0051) — no need to enumerate
 * services first, which anon couldn't do anyway (services_read is
 * authenticated-only). Anything that fails here degrades to an empty strip
 * rather than blocking the page: this section is the point of the page,
 * but it is not load-bearing for the rest of it.
 */
async function getQueueStrip(): Promise<PublicQueueDisplay[]> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.rpc('get_public_queue_display')
    return error || !data ? [] : data
  } catch {
    return []
  }
}

export default async function LandingPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('auth_user_id', user.id)
      .single()
    redirect(homeForRole((profile?.role ?? 'patient') as UserRole))
  }

  const queueStrip = await getQueueStrip()

  return (
    <main className="flex min-h-dvh flex-col">
      {/* 1. Hero */}
      <section className="mx-auto flex w-full max-w-md flex-col items-center gap-4 px-6 py-12 text-center">
        <div className="h-16 w-16 rounded-full bg-primary-700" aria-hidden />
        <h1 className="font-display text-[34px] font-bold leading-tight text-ink">
          Riverside Clinic
        </h1>
        <p className="text-[15px] text-muted">
          Book, check in, and see how long you&rsquo;ll wait.
        </p>
        <div className="flex w-full flex-col gap-2.5">
          <LinkButton href="/register" variant="primary" fullWidth>
            Book an appointment
          </LinkButton>
          <LinkButton href="/login" variant="secondary" fullWidth>
            Sign in
          </LinkButton>
        </div>
      </section>

      {/* 2. Live queue strip — the point of the page */}
      {queueStrip.length > 0 && (
        <section className="mx-auto w-full max-w-md px-6 pb-10">
          <p className="mb-3 text-xs font-semibold tracking-wide text-muted">
            RIGHT NOW AT THE CLINIC
          </p>
          <div className="flex flex-col gap-2">
            {queueStrip.map((row) => (
              <div
                key={row.service_id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3"
              >
                <div>
                  <p className="font-semibold text-ink">{row.service_name}</p>
                  <p className="text-sm text-muted">{row.waiting_count} waiting</p>
                </div>
                {row.is_being_served && row.estimated_wait_minutes !== null ? (
                  <p className="shrink-0 font-mono text-lg font-semibold tabular-nums text-primary-700">
                    ~{row.estimated_wait_minutes} min
                  </p>
                ) : (
                  <p className="shrink-0 text-sm font-semibold text-muted">
                    Not currently being served
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 3. How it works */}
      <section className="mx-auto w-full max-w-md px-6 pb-10">
        <h2 className="mb-4 font-display text-xl font-bold text-ink">How it works</h2>
        <ol className="flex flex-col gap-4">
          {HOW_IT_WORKS.map((step, i) => (
            <li key={step.title} className="flex gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-50 font-display font-bold text-primary-700">
                {i + 1}
              </span>
              <div>
                <p className="font-semibold text-ink">{step.title}</p>
                <p className="text-sm text-muted">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* 4. No smartphone? — an accessibility feature of the system, not a footnote */}
      <section className="mx-auto w-full max-w-md px-6 pb-10">
        <div className="rounded-lg border border-border bg-surface p-5">
          <h2 className="mb-2 font-display text-lg font-bold text-ink">No smartphone?</h2>
          <p className="text-sm text-muted">
            Walk-in patients are registered at reception and can follow their position on the
            waiting-room screen &mdash; no phone or app needed.
          </p>
          {queueStrip.length > 0 && (
            <div className="mt-3 flex flex-col gap-1.5">
              {queueStrip.map((row) => (
                <Link
                  key={row.service_id}
                  href={`/display/${row.service_id}`}
                  className="text-sm font-semibold text-primary-700"
                >
                  {row.service_name} waiting-room display &rarr;
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* 5. Footer */}
      <footer className="mt-auto border-t border-border px-6 py-6 text-center text-xs text-muted">
        <p className="font-semibold text-ink">Riverside Clinic</p>
        <p>123 Main Road, Riverside &middot; Mon&ndash;Fri 08:00&ndash;17:00</p>
      </footer>
    </main>
  )
}
