import { PAGE_CLASS } from '@/components/patient/PageHeader'

export default function DashboardLoading() {
  return (
    <main className={`${PAGE_CLASS} animate-pulse`}>
      <div className="h-9 w-64 rounded bg-subtle" aria-hidden />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="h-24 rounded-lg bg-subtle" aria-hidden />
        <div className="h-24 rounded-lg bg-subtle" aria-hidden />
        <div className="h-24 rounded-lg bg-subtle" aria-hidden />
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="h-40 rounded-lg bg-subtle" aria-hidden />
        <div className="h-40 rounded-lg bg-subtle" aria-hidden />
      </div>
      <div className="h-36 rounded-lg bg-subtle" aria-hidden />
    </main>
  )
}
