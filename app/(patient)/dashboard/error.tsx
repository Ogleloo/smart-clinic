'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/Button'

export default function DashboardError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-sm font-semibold text-ink">Something went wrong</p>
      <p className="text-sm text-muted">We couldn&rsquo;t load your dashboard.</p>
      <Button variant="secondary" onClick={retry}>
        Try again
      </Button>
    </main>
  )
}
