'use client'

import { useEffect } from 'react'
import Link from 'next/link'

/**
 * Error boundary for the admin area. It renders inside the admin shell, so the sidebar, mobile navigation and Sign
 * Out remain usable (a failed page load used to fall through to the framework's generic error page with no way
 * onward). The buttons use fixed #037F74 (white on it is 4.89:1) because on the dashboard the shell's token for the
 * primary colour is the lighter Figma teal (3.76:1). `retry` is this Next.js version's recovery callback (the installed 16.3.6 docs and types).
 */
export default function AdminError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="flex flex-col gap-4 py-2">
      <h2 className="font-display text-2xl font-bold text-ink">Something went wrong</h2>
      <p role="alert" className="rounded-md border border-border bg-danger-bg p-4 text-sm font-semibold text-danger">
        We couldn’t load this page.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => retry()}
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-[#037F74] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#026B62]"
        >
          Try again
        </button>
        <Link
          href="/admin"
          className="inline-flex min-h-11 items-center justify-center rounded-md border-[1.5px] border-[#037F74] bg-surface px-5 text-sm font-semibold text-[#037F74] hover:bg-primary-50"
        >
          Back to the dashboard
        </Link>
      </div>
    </div>
  )
}
