export default function DashboardLoading() {
  return (
    <main className="mx-auto min-h-dvh max-w-md animate-pulse">
      <header className="flex items-center justify-between bg-surface px-5 py-4">
        <span className="font-display text-lg font-semibold text-ink/40">Riverside Clinic</span>
        <div className="h-8 w-8 rounded-full bg-subtle" aria-hidden />
      </header>

      <div className="flex flex-col gap-4 px-4 py-5">
        <div className="h-8 w-40 rounded bg-subtle" aria-hidden />
        <div className="h-20 rounded-2xl bg-subtle" aria-hidden />
        <div className="h-32 rounded-lg bg-subtle" aria-hidden />
        <div className="h-11 rounded-[10px] bg-subtle" aria-hidden />
      </div>
    </main>
  )
}
