'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { NURSE_WORKSPACE_HREF } from '@/components/nurse/v3/navItems'

/**
 * Error boundary for the Nurse V3 screens. It renders inside the V3 shell, so the sidebar, mobile navigation and
 * Sign Out remain usable. A failed page load otherwise fell through to the framework's generic error page with no
 * way onward. Offers a retry and the classic nurse screen (a separate, working fallback).
 */
export default function NurseV3Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <main className="mx-auto flex w-full max-w-[1176px] flex-col gap-4 px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
      <h1 className="font-display text-[40px] font-bold leading-[44px] text-ink">Something went wrong</h1>
      <p role="alert" className="rounded-md border border-border bg-danger-bg p-4 text-sm font-semibold text-[#B42318]">
        We couldn’t load this screen.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => retry()}
          className="inline-flex min-h-11 items-center justify-center rounded-sm bg-[#037F74] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#026B62]"
        >
          Try again
        </button>
        <Link
          href={NURSE_WORKSPACE_HREF}
          className="inline-flex min-h-11 items-center justify-center rounded-sm border-[1.2px] border-[#037F74] bg-surface px-5 text-sm font-semibold text-[#037F74] hover:bg-primary-50"
        >
          Open the classic nurse screen
        </Link>
      </div>
    </main>
  )
}
