import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import {
  PRESETS, validateScenario, eligibleMoves, simulateSnapshot, evaluateScenario,
  type SyntheticScenario,
} from '../lib/research/nurseAllocationAdvisor'

/** Pure, deterministic offline research tests. Never opens the app or touches Supabase. */
const clone = (s: SyntheticScenario): SyntheticScenario => structuredClone(s)
const source = (p: string) => readFileSync(p, 'utf8')

test.describe('synthetic allocation advisor — model safety', () => {
  test('deterministic repeat: same input produces the same output', () => {
    const s = PRESETS[0]
    expect(evaluateScenario(s)).toEqual(evaluateScenario(s))
  })

  test('count-only cannot see a worse workload with fewer patients', () => {
    const result = evaluateScenario(PRESETS[0])
    expect(result.comparisons[0].forecast.move).toBeNull()
    expect(result.comparisons[1].forecast.move).toEqual({ from: 'general', to: 'chronic' })
    expect(result.comparisons[2].forecast.move).toEqual({ from: 'general', to: 'chronic' })
    expect(result.comparisons[2].meanWaitChangeMinutes).toBeLessThan(0)
  })

  test('transferred nurse stays unavailable for transfer duration', () => {
    const a = clone(PRESETS[0])
    const b = clone(PRESETS[0])
    a.transferMinutes = 0
    b.transferMinutes = 20
    const m = { from: 'general' as const, to: 'chronic' as const }
    const fast = simulateSnapshot(a, m)
    const slow = simulateSnapshot(b, m)
    expect(slow.overallMeanStartWaitMinutes).toBeGreaterThanOrEqual(fast.overallMeanStartWaitMinutes!)
  })

  test('never move without explicit synthetic cross-qualification', () => {
    const s = clone(PRESETS[1])
    s.crossQualifiedIdleHelper = false
    expect(eligibleMoves(s)).toEqual([])
    expect(evaluateScenario(s).comparisons.every((x) => !x.forecast.move)).toBe(true)
  })

  test('never interrupt a busy nurse', () => {
    expect(eligibleMoves(PRESETS.find((p) => p.id === 'all-busy')!)).toEqual([])
  })

  test('do not draw an idle helper away from waiting priority patients', () => {
    const s = PRESETS.find((p) => p.id === 'priority-donor')!
    expect(eligibleMoves(s)).toEqual([])
  })

  test('donor minimum-coverage floor prevents transferring the only nurse', () => {
    const s = clone(PRESETS[0])
    expect(eligibleMoves(s).some((m) => m.from === 'chronic')).toBe(false)
    expect(() => simulateSnapshot(s, { from: 'chronic', to: 'general' })).toThrow(/violates/)
  })

  test('uncovered service is reported as unserved, not falsely zero waiting', () => {
    const s = PRESETS.find((p) => p.id === 'uncovered-service')!
    const baseline = simulateSnapshot(s)
    expect(baseline.patientsUnserved).toBe(6)
    expect(baseline.overallMeanStartWaitMinutes).toBeNull()
    const assisted = evaluateScenario(s).comparisons[2].forecast
    expect(assisted.patientsUnserved).toBe(0)
    expect(assisted.overallMeanStartWaitMinutes).not.toBeNull()
  })

  test('count-only can make overall waiting worse; next-free abstains', () => {
    const s = clone(PRESETS[0])
    s.services[0].waiting = 3
    s.services[0].meanConsultationMinutes = 40
    s.services[1].waiting = 5
    s.services[1].meanConsultationMinutes = 5
    const r = evaluateScenario(s)
    expect(r.comparisons[0].forecast.move).not.toBeNull()
    expect(r.comparisons[0].meanWaitChangeMinutes).toBeGreaterThan(0)
    expect(r.comparisons[2].forecast.move).toBeNull()
    expect(r.modelFinding).toBe('no-supported-move')
  })

  test('keeps all nurses accounted for in every eligible counterfactual', () => {
    for (const s of PRESETS) {
      const expected = s.services.reduce((n, a) => n + a.nurses, 0)
      for (const m of [null, ...eligibleMoves(s)]) {
        const f = simulateSnapshot(s, m)
        expect(f.services.reduce((n, a) => n + a.nurses, 0)).toBe(expected)
        expect(f.patientsWaiting).toBe(s.services.reduce((n, a) => n + a.waiting, 0))
      }
    }
  })

  test('no demand returns zero waiting, no invented benefit', () => {
    const s = clone(PRESETS[0])
    for (const v of s.services) v.waiting = 0
    const r = evaluateScenario(s)
    expect(r.baseline.forecast.overallMeanStartWaitMinutes).toBe(0)
    expect(r.comparisons[2].forecast.move).toBeNull()
  })

  test('invalid inputs are rejected, never silently fixed inside model', () => {
    const s = clone(PRESETS[0])
    s.services[0].waiting = -1
    expect(() => validateScenario(s)).toThrow(/Invalid synthetic/)
    s.services[0].waiting = 1
    s.services[0].priorityWaiting = 2
    expect(() => validateScenario(s)).toThrow(/Invalid synthetic/)
    s.services[0].priorityWaiting = 0
    s.services[0].busyNurses = s.services[0].nurses + 1
    expect(() => validateScenario(s)).toThrow(/Invalid synthetic/)
  })

  test('all preset scenarios validate and use synthetic-only labels', () => {
    for (const s of PRESETS) {
      expect(() => validateScenario(s)).not.toThrow()
      const r = evaluateScenario(s)
      expect(r.assumptions.length).toBeGreaterThan(4)
      expect(r.comparisons).toHaveLength(3)
    }
  })
})

test.describe('implementation contracts', () => {
  test('page is guarded as admin and only passes aggregate service data', () => {
    const s = source('app/admin/allocation-advisor/page.tsx')
    expect(s).toContain("requireRole('admin')")
    expect(s).toContain('getAdminDashboardData(supabase)')
    expect(s).not.toMatch(/patientName|full_name|id_number|nurse_id/)
  })
  test('the advisor has no mutation paths, server actions or database client', () => {
    for (const p of [
      'lib/research/nurseAllocationAdvisor.ts',
      'components/admin/v3/AllocationAdvisorView.tsx',
      'app/admin/allocation-advisor/page.tsx',
    ]) {
      const s = source(p)
      expect(s).not.toMatch(/\.(?:insert|update|delete|upsert)\s*\(/)
      expect(s).not.toMatch(/\.rpc\s*\(|createClient\s*\(|reset_demo_state|set_duty\s*\(|setDuty\s*\(/)
    }
  })
  test('offline test is classified and the V3 Admin navigation advertises the real route', () => {
    expect(source('e2e/support/e2e-safety.ts')).toContain("'nurse-allocation-advisor'")
    expect(source('components/admin/v3/navItems.ts')).toContain("'/admin/allocation-advisor'")
    expect(source('components/admin/v3/AdminContentFrame.tsx')).toContain("'/admin/allocation-advisor'")
  })
})
