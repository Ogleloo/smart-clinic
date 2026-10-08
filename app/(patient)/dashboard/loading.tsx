import { PAGE_CLASS } from '@/components/patient/PageHeader'

export default function DashboardLoading() {
  return (
    <main className={`${PAGE_CLASS} animate-pulse`}>
      <div className="h-12 w-80 rounded-sm bg-subtle" aria-hidden />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="h-[200px] rounded-lg bg-subtle" aria-hidden />
        <div className="h-[200px] rounded-lg bg-subtle" aria-hidden />
        <div className="h-[200px] rounded-lg bg-subtle" aria-hidden />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="h-56 rounded-lg bg-subtle" aria-hidden />
        <div className="h-56 rounded-lg bg-subtle" aria-hidden />
      </div>
      <div className="h-36 rounded-lg bg-subtle" aria-hidden />
    </main>
  )
}
