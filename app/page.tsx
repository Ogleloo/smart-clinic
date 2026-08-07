import Link from 'next/link'

export default function LandingPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="h-16 w-16 rounded-full bg-primary-700" aria-hidden />
      <h1 className="font-display text-[34px] font-bold leading-tight text-ink">
        Know where you stand
      </h1>
      <p className="text-[15px] text-muted">
        Book appointments, skip the queue, and see your real wait time.
      </p>

      <Link href="/register" className="w-full">
        <span className="flex min-h-11 w-full items-center justify-center rounded-[10px] bg-primary-700 px-5 font-semibold text-white">
          Get started
        </span>
      </Link>
      <Link href="/login" className="w-full">
        <span className="flex min-h-11 w-full items-center justify-center rounded-[10px] border-[1.5px] border-primary-700 bg-surface px-5 font-semibold text-primary-700">
          Log in
        </span>
      </Link>

      <ul className="mt-4 w-full space-y-2.5 text-left">
        {['Live queue position', 'Honest wait estimates', 'In-app updates'].map((f) => (
          <li key={f} className="flex items-center gap-2.5">
            <span className="h-5 w-5 rounded-full bg-primary-50" aria-hidden />
            <span className="text-sm font-semibold text-ink">{f}</span>
          </li>
        ))}
      </ul>
    </main>
  )
}
