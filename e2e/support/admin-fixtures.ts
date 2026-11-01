/**
 * Synthetic raw reads for the admin dashboard tests and the render script. Everything is made up: no real names,
 * tokens, clinics or numbers. Used with assembleAdminDashboard(), so tests go through the real assembly code.
 */
import type { Read, RawAdminReads, TodayEntry } from '../../lib/adminDashboard'

export const failed = <T>(): Read<T> => ({ data: null, error: { message: 'boom' } })
export const ok = <T>(data: T): Read<T> => ({ data, error: null })

const T = (hhmm: string) => `2026-11-02T${hhmm}:00+02:00`
const entry = (id: string, token: string, service_id: string, status: string, at: string, over: Partial<TodayEntry> = {}): TodayEntry => ({
  id, token, service_id, status, checked_in_at: at, called_at: null, completed_at: null, appointment_id: null, ...over,
})

export const ENTRIES: TodayEntry[] = [
  entry('e1', 'GC-001', 's1', 'done', T('08:05'), { called_at: T('08:20'), completed_at: T('08:35'), appointment_id: 'a1' }),
  entry('e2', 'GC-002', 's1', 'in_progress', T('08:15'), { called_at: T('08:40') }),
  entry('e3', 'GC-003', 's1', 'waiting', T('08:30')),
  entry('e4', 'IM-001', 's2', 'waiting', T('08:45'), { appointment_id: 'a2' }),
  entry('e5', 'GC-004', 's1', 'skipped', T('08:10'), { completed_at: T('08:25') }),
  entry('e6', 'GC-005', 's1', 'no_show', T('08:12'), { completed_at: T('08:50') }),
]

const cov = (service_id: string, service_name: string, over: Record<string, unknown>) => ({
  service_id, service_name, confidence: 'high', estimated_wait_minutes: 8, is_being_served: true, next_token: '', now_serving_token: '', updated_at: '', waiting_count: 0, ...over,
})

/** A fully healthy set of reads. `attention: true` leaves Pharmacy uncovered with three people waiting. */
export function baseReads({ attention = false }: { attention?: boolean } = {}): RawAdminReads {
  return {
    services: ok([{ id: 's1', name: 'General Consultation' }, { id: 's2', name: 'Immunisation' }, { id: 's3', name: 'Pharmacy' }]),
    nurses: ok([{ is_on_duty: true }, { is_on_duty: true }, { is_on_duty: false }]),
    entries: ok(ENTRIES),
    coverage: ok([
      cov('s1', 'General Consultation', { waiting_count: 1, estimated_wait_minutes: 8 }),
      cov('s2', 'Immunisation', { waiting_count: 1, estimated_wait_minutes: null, confidence: 'low' }),
      cov('s3', 'Pharmacy', { waiting_count: attention ? 3 : 0, is_being_served: false, estimated_wait_minutes: null, confidence: 'low' }),
    ]) as RawAdminReads['coverage'],
    consultations: ok([
      { started_at: T('07:00'), ended_at: T('07:12'), exclude_from_prediction: false, exclusion_reason: null },
      { started_at: T('07:20'), ended_at: T('07:32'), exclude_from_prediction: false, exclusion_reason: null },
      { started_at: T('07:40'), ended_at: T('07:41'), exclude_from_prediction: false, exclusion_reason: null },
      { started_at: T('07:45'), ended_at: T('08:00'), exclude_from_prediction: true, exclusion_reason: 'break' },
    ]),
    settings: ok({ min_plausible_consultation_minutes: 5, max_plausible_consultation_minutes: 90 }) as RawAdminReads['settings'],
    appointmentsCount: { count: 9, error: null },
    perService: {
      s1: { nurses: ok(2), stats: ok({ sample_count: 14 }) },
      s2: { nurses: ok(1), stats: ok({ sample_count: 2 }) },
      s3: { nurses: ok(0), stats: ok({ sample_count: 0 }) },
    },
  }
}
