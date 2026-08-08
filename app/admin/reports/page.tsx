import { createClient } from '@/lib/supabase/server'
import { CLINIC_TIMEZONE, isoNDaysAgo } from '@/lib/clinicTime'
import { ReportsTabs, type ServiceVolume, type ThroughputDay, type WaitAccuracyStats } from '@/components/admin/ReportsTabs'

const DAYS = 14

function clinicDateLabel(iso: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: CLINIC_TIMEZONE }).format(new Date(iso))
}

/**
 * Every aggregation here runs over a small, bounded, admin-only dataset
 * (one clinic's last 14 days) computed in this Server Component, not a
 * client-side recomputation of anything patient-facing — ADR-009 is
 * about not re-deriving queue *logic* (position, live wait) on the
 * client; reporting arithmetic over historical rows is a different
 * concern.
 */
export default async function AdminReportsPage() {
  const supabase = await createClient()
  const since = isoNDaysAgo(DAYS)

  const [{ data: consultations }, { data: services }, { data: waitRows }] = await Promise.all([
    supabase
      .from('consultations')
      .select('id, service_id, started_at, ended_at')
      .gte('started_at', since),
    supabase.from('services').select('id, name'),
    supabase
      .from('consultations')
      .select('started_at, queue_entries(checked_in_at)')
      .gte('started_at', since),
  ])

  // --- Throughput: consultations per day, last 14 days (including empty days) ---
  const dayBuckets = new Map<string, number>()
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = clinicDateLabel(isoNDaysAgo(i))
    dayBuckets.set(d, 0)
  }
  for (const c of consultations ?? []) {
    const day = clinicDateLabel(c.started_at)
    if (dayBuckets.has(day)) dayBuckets.set(day, (dayBuckets.get(day) ?? 0) + 1)
  }
  const throughput: ThroughputDay[] = [...dayBuckets.entries()].map(([date, count]) => ({
    date,
    label: date.slice(5).replace('-', '/'),
    count,
  }))

  // --- By service: volume + average duration ---
  const serviceNameById = new Map((services ?? []).map((s) => [s.id, s.name]))
  const byServiceMap = new Map<string, { count: number; totalMinutes: number; withDuration: number }>()
  for (const c of consultations ?? []) {
    const entry = byServiceMap.get(c.service_id) ?? { count: 0, totalMinutes: 0, withDuration: 0 }
    entry.count += 1
    if (c.ended_at) {
      const minutes = (new Date(c.ended_at).getTime() - new Date(c.started_at).getTime()) / 60000
      entry.totalMinutes += minutes
      entry.withDuration += 1
    }
    byServiceMap.set(c.service_id, entry)
  }
  const byService: ServiceVolume[] = [...byServiceMap.entries()]
    .map(([serviceId, v]) => ({
      serviceId,
      name: serviceNameById.get(serviceId) ?? 'Unknown service',
      count: v.count,
      avgDurationMinutes: v.withDuration > 0 ? Math.round(v.totalMinutes / v.withDuration) : null,
    }))
    .sort((a, b) => b.count - a.count)

  // --- Wait accuracy: actual wait only (see ReportsTabs for why "predicted" isn't available) ---
  const actualWaits = (waitRows ?? [])
    .filter((r) => r.queue_entries?.checked_in_at)
    .map((r) => (new Date(r.started_at).getTime() - new Date(r.queue_entries!.checked_in_at).getTime()) / 60000)
    .filter((minutes) => minutes >= 0)

  const waitAccuracy: WaitAccuracyStats = {
    sampleCount: actualWaits.length,
    avgActualWaitMinutes:
      actualWaits.length > 0 ? Math.round(actualWaits.reduce((a, b) => a + b, 0) / actualWaits.length) : null,
    minActualWaitMinutes: actualWaits.length > 0 ? Math.round(Math.min(...actualWaits)) : null,
    maxActualWaitMinutes: actualWaits.length > 0 ? Math.round(Math.max(...actualWaits)) : null,
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-display text-lg font-semibold text-ink">Reports</h2>
      <ReportsTabs throughput={throughput} byService={byService} waitAccuracy={waitAccuracy} />
    </div>
  )
}
