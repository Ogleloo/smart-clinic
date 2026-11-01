/**
 * Smart Clinic — assisted nurse allocation research MVP (synthetic only).
 *
 * This module intentionally has NO database imports, personnel identifiers, authentication,
 * network access, or actions. A simulation step never changes the nurse roster.
 *
 * The advisor is a deterministic backlog snapshot, NOT the standalone WANR v0.1
 * discrete-event simulator. It omits future arrivals, room constraints, breaks,
 * shift boundaries, fatigue, patient abandonment, approval delays, and calibrated
 * residual times. Thresholds here are explanatory choices, not clinical policy.
 */

export type ServiceKey = 'general' | 'chronic'
export type PolicyKey = 'current' | 'count' | 'workload' | 'next-free'

export interface SyntheticService {
  id: ServiceKey
  name: string
  waiting: number
  /** Number of the waiting patients already marked priority (served first). */
  priorityWaiting: number
  nurses: number
  /** Busy nurses are assumed to finish after half of this service's mean duration. */
  busyNurses: number
  meanConsultationMinutes: number
  /** Synthetic floor for immediate donor coverage, not a clinic-approved rule. */
  minimumNurses: number
}

export interface SyntheticScenario {
  id: string
  title: string
  description: string
  services: [SyntheticService, SyntheticService]
  /** Hypothetical assumption only; never inferred from real staff records. */
  crossQualifiedIdleHelper: boolean
  transferMinutes: number
}

export interface Move {
  from: ServiceKey
  to: ServiceKey
}

export interface ServiceOutcome {
  id: ServiceKey
  name: string
  nurses: number
  waiting: number
  unserved: number
  meanStartWaitMinutes: number | null
  priorityMeanStartWaitMinutes: number | null
  maxStartWaitMinutes: number | null
  workloadPressureMinutes: number
}

export interface Forecast {
  move: Move | null
  patientsWaiting: number
  patientsUnserved: number
  /** Null if any service has waiting patients and no assigned nurse. */
  overallMeanStartWaitMinutes: number | null
  overallP90StartWaitMinutes: number | null
  services: [ServiceOutcome, ServiceOutcome]
}

export interface PolicyResult {
  key: PolicyKey
  title: string
  forecast: Forecast
  explanation: string
  /** Difference from the current assignment; null if either forecast is unserved. */
  meanWaitChangeMinutes: number | null
}

export interface AdvisorReport {
  baseline: PolicyResult
  comparisons: [PolicyResult, PolicyResult, PolicyResult]
  eligibleMoves: Move[]
  /** This is a model outcome, NOT authorization to reassign clinical staff. */
  modelFinding: 'lower-modeled-wait' | 'no-supported-move' | 'insufficient-capacity'
  modelFindingText: string
  assumptions: string[]
}

export const PRESETS: readonly SyntheticScenario[] = [
  {
    id: 'counts-vs-work', title: 'More patients is not more workload',
    description: 'General has more patients, but Chronic Care requires longer consultations. This challenges patient-count-only allocation.',
    services: [
      { id: 'general', name: 'General Consultation', waiting: 12, priorityWaiting: 0, nurses: 3, busyNurses: 0, meanConsultationMinutes: 5, minimumNurses: 1 },
      { id: 'chronic', name: 'Chronic Care', waiting: 5, priorityWaiting: 0, nurses: 1, busyNurses: 0, meanConsultationMinutes: 20, minimumNurses: 1 },
    ], crossQualifiedIdleHelper: true, transferMinutes: 5,
  },
  {
    id: 'sustained-surge', title: 'Uneven demand / sustained surge',
    description: 'An overloaded service has one nurse and a longer queue. A helper may improve the modeled overall wait but harm the donor.',
    services: [
      { id: 'general', name: 'General Consultation', waiting: 4, priorityWaiting: 0, nurses: 3, busyNurses: 1, meanConsultationMinutes: 20, minimumNurses: 1 },
      { id: 'chronic', name: 'Chronic Care', waiting: 14, priorityWaiting: 0, nurses: 1, busyNurses: 1, meanConsultationMinutes: 30, minimumNurses: 1 },
    ], crossQualifiedIdleHelper: true, transferMinutes: 5,
  },
  {
    id: 'no-eligibility', title: 'No cross-service qualification',
    description: 'Even an obvious workload difference cannot justify moving a nurse when competency is not established.',
    services: [
      { id: 'general', name: 'General Consultation', waiting: 4, priorityWaiting: 0, nurses: 3, busyNurses: 0, meanConsultationMinutes: 20, minimumNurses: 1 },
      { id: 'chronic', name: 'Chronic Care', waiting: 12, priorityWaiting: 0, nurses: 1, busyNurses: 0, meanConsultationMinutes: 30, minimumNurses: 1 },
    ], crossQualifiedIdleHelper: false, transferMinutes: 5,
  },
  {
    id: 'all-busy', title: 'All staff in consultation',
    description: 'A nurse cannot be transferred immediately while consulting with a patient.',
    services: [
      { id: 'general', name: 'General Consultation', waiting: 3, priorityWaiting: 0, nurses: 3, busyNurses: 3, meanConsultationMinutes: 20, minimumNurses: 1 },
      { id: 'chronic', name: 'Chronic Care', waiting: 12, priorityWaiting: 0, nurses: 1, busyNurses: 1, meanConsultationMinutes: 30, minimumNurses: 1 },
    ], crossQualifiedIdleHelper: true, transferMinutes: 5,
  },
  {
    id: 'priority-donor', title: 'Priority patients at donor service',
    description: 'A donor with waiting priority patients is excluded from immediate transfer in this research model.',
    services: [
      { id: 'general', name: 'General Consultation', waiting: 4, priorityWaiting: 2, nurses: 3, busyNurses: 0, meanConsultationMinutes: 20, minimumNurses: 1 },
      { id: 'chronic', name: 'Chronic Care', waiting: 12, priorityWaiting: 0, nurses: 1, busyNurses: 0, meanConsultationMinutes: 30, minimumNurses: 1 },
    ], crossQualifiedIdleHelper: true, transferMinutes: 5,
  },
  {
    id: 'uncovered-service', title: 'Uncovered service',
    description: 'An uncovered service cannot provide a finite wait forecast. A synthetic helper can restore capacity if the modeled donor is protected.',
    services: [
      { id: 'general', name: 'General Consultation', waiting: 8, priorityWaiting: 0, nurses: 4, busyNurses: 0, meanConsultationMinutes: 15, minimumNurses: 1 },
      { id: 'chronic', name: 'Chronic Care', waiting: 6, priorityWaiting: 0, nurses: 0, busyNurses: 0, meanConsultationMinutes: 20, minimumNurses: 1 },
    ], crossQualifiedIdleHelper: true, transferMinutes: 5,
  },
]

const isIntegerIn = (n: number, min: number, max: number) => Number.isInteger(n) && n >= min && n <= max

/** Reject invalid user input instead of generating misleading numbers. */
export function validateScenario(s: SyntheticScenario): void {
  if (!Array.isArray(s.services) || s.services.length !== 2 || s.services[0].id === s.services[1].id ||
      !['general', 'chronic'].includes(s.services[0].id) || !['general', 'chronic'].includes(s.services[1].id)) {
    throw new Error('The model needs exactly two distinct services.')
  }
  if (typeof s.crossQualifiedIdleHelper !== 'boolean' || !isIntegerIn(s.transferMinutes, 0, 60)) {
    throw new Error('Invalid cross-qualification assumption or transfer duration.')
  }
  for (const v of s.services) {
    if (!isIntegerIn(v.waiting, 0, 100) || !isIntegerIn(v.priorityWaiting, 0, v.waiting) ||
        !isIntegerIn(v.nurses, 0, 12) || !isIntegerIn(v.busyNurses, 0, v.nurses) ||
        !isIntegerIn(v.minimumNurses, 0, 12) || !isIntegerIn(v.meanConsultationMinutes, 1, 120)) {
      throw new Error(`Invalid synthetic inputs for ${v.name}.`)
    }
  }
  if (s.services[0].nurses + s.services[1].nurses > 12) throw new Error('Model supports at most 12 nurses.')
}

/** A valid, hypothetical ONE-idle-nurse transfer. Not an assignment permission. */
export function eligibleMoves(s: SyntheticScenario): Move[] {
  validateScenario(s)
  if (!s.crossQualifiedIdleHelper) return []
  const moves: Move[] = []
  for (let i = 0; i < 2; i++) {
    const source = s.services[i]
    const target = s.services[1 - i]
    if (source.nurses - 1 < source.minimumNurses || source.nurses <= source.busyNurses || source.priorityWaiting > 0) continue
    moves.push({ from: source.id, to: target.id })
  }
  return moves
}

const sameMove = (a: Move | null, b: Move | null) => a?.from === b?.from && a?.to === b?.to

/** Snapshot workload proxy (minutes of work / assigned nurses), not a wait-time prediction. */
function pressure(s: SyntheticService, n: number): number {
  const work = s.waiting * s.meanConsultationMinutes + s.busyNurses * s.meanConsultationMinutes / 2
  return n === 0 ? (work > 0 ? Number.POSITIVE_INFINITY : 0) : work / n
}

function percentile90(values: number[]): number | null {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.ceil(0.9 * sorted.length) - 1]!
}

/**
 * Earliest-next-free-nurse assignment for the patients ALREADY WAITING at t=0.
 * Busy nurses have half of the mean consultation remaining (explicitly assumed).
 * A transferred idle nurse appears after transferMinutes. No future arrivals.
 */
export function simulateSnapshot(s: SyntheticScenario, move: Move | null = null): Forecast {
  validateScenario(s)
  if (move && !eligibleMoves(s).some((m) => sameMove(m, move))) {
    throw new Error('The synthetic move violates the eligibility, idle, priority, or minimum-coverage guard.')
  }

  const outcomes: ServiceOutcome[] = []
  const allWaits: number[] = []
  let unserved = 0

  for (const service of s.services) {
    const isDonor = move?.from === service.id
    const isReceiver = move?.to === service.id
    const assignedNurses = service.nurses - Number(isDonor) + Number(isReceiver)
    const ready: number[] = []
    // A nurse already consulting cannot move. Synthetic residual = 50% of mean.
    for (let i = 0; i < service.busyNurses; i++) ready.push(service.meanConsultationMinutes / 2)
    const idleNursesAfter = service.nurses - service.busyNurses - Number(isDonor)
    for (let i = 0; i < idleNursesAfter; i++) ready.push(0)
    if (isReceiver) ready.push(s.transferMinutes)

    if (ready.length !== assignedNurses) throw new Error('Internal nurse accounting mismatch.')
    if (ready.length === 0 && service.waiting > 0) {
      unserved += service.waiting
      outcomes.push({ id: service.id, name: service.name, nurses: assignedNurses, waiting: service.waiting,
        unserved: service.waiting, meanStartWaitMinutes: null, priorityMeanStartWaitMinutes: null,
        maxStartWaitMinutes: null, workloadPressureMinutes: pressure(service, assignedNurses) })
      continue
    }

    const waits: number[] = []
    for (let p = 0; p < service.waiting; p++) {
      // All queued patients are available at t=0. Priority patients are served first.
      let best = 0
      for (let i = 1; i < ready.length; i++) if (ready[i]! < ready[best]!) best = i
      const startsAt = ready[best]!
      waits.push(startsAt)
      ready[best] = startsAt + service.meanConsultationMinutes
    }
    allWaits.push(...waits)
    outcomes.push({ id: service.id, name: service.name, nurses: assignedNurses, waiting: service.waiting,
      unserved: 0,
      meanStartWaitMinutes: waits.length ? waits.reduce((sum, x) => sum + x, 0) / waits.length : 0,
      priorityMeanStartWaitMinutes: service.priorityWaiting ? waits.slice(0, service.priorityWaiting).reduce((sum, x) => sum + x, 0) / service.priorityWaiting : null,
      maxStartWaitMinutes: waits.length ? Math.max(...waits) : 0,
      workloadPressureMinutes: pressure(service, assignedNurses),
    })
  }
  const mean = allWaits.length ? allWaits.reduce((sum, v) => sum + v, 0) / allWaits.length : 0
  return {
    move,
    patientsWaiting: s.services[0].waiting + s.services[1].waiting,
    patientsUnserved: unserved,
    overallMeanStartWaitMinutes: unserved ? null : mean,
    overallP90StartWaitMinutes: unserved ? null : percentile90(allWaits),
    services: outcomes as [ServiceOutcome, ServiceOutcome],
  }
}

const service = (f: Forecast, id: ServiceKey) => f.services.find((v) => v.id === id)!
const nameOf = (s: SyntheticScenario, id: ServiceKey) => s.services.find((v) => v.id === id)!.name
const moveText = (s: SyntheticScenario, move: Move | null) => move
  ? `Hypothetical move: one idle nurse from ${nameOf(s, move.from)} to ${nameOf(s, move.to)}.`
  : 'Keep the current hypothetical distribution.'

/** Count-only comparator: greatest raw queue-length gap; no outcome-based guard. */
function countMove(s: SyntheticScenario, moves: Move[]): Move | null {
  return moves
    .map((m) => ({ move: m, gap: s.services.find((v) => v.id === m.to)!.waiting - s.services.find((v) => v.id === m.from)!.waiting }))
    .filter((m) => m.gap >= 2)
    .sort((a, b) => b.gap - a.gap || a.move.from.localeCompare(b.move.from))[0]?.move ?? null
}

/** WANR-inspired ONE-step pressure comparison, NOT the full WANR timing/approval algorithm. */
function workloadMove(s: SyntheticScenario, moves: Move[], baseline: Forecast): Move | null {
  const originalMax = Math.max(...baseline.services.map((v) => v.workloadPressureMinutes))
  const candidates = moves.map((m) => {
    const result = simulateSnapshot(s, m)
    const maxAfter = Math.max(...result.services.map((v) => v.workloadPressureMinutes))
    const originalDonor = service(baseline, m.from).workloadPressureMinutes
    const donorAfter = service(result, m.from).workloadPressureMinutes
    const drop = originalMax - maxAfter
    const dropPercent = originalMax === 0 ? 0 : (originalMax === Infinity && Number.isFinite(maxAfter) ? 100 : 100 * drop / originalMax)
    return { move: m, drop, dropPercent, donorIncrease: donorAfter - originalDonor }
  })
  return candidates
    .filter((c) => c.drop >= 10 && c.dropPercent >= 10 && c.donorIncrease <= 30)
    .sort((a, b) => b.drop - a.drop || a.move.from.localeCompare(b.move.from))[0]?.move ?? null
}

/**
 * Limited one-step comparison by simulated current-backlog wait; conservatively
 * abstains on small/uncertain benefits or high donor harm. Unvalidated thresholds.
 */
function nextFreeMove(s: SyntheticScenario, moves: Move[], baseline: Forecast): Move | null {
  const candidate = moves.map((move) => {
    const forecast = simulateSnapshot(s, move)
    const donorBefore = service(baseline, move.from).meanStartWaitMinutes
    const donorAfter = service(forecast, move.from).meanStartWaitMinutes
    const donorHarm = donorBefore === null || donorAfter === null ? Infinity : donorAfter - donorBefore
    const improvement = baseline.overallMeanStartWaitMinutes !== null && forecast.overallMeanStartWaitMinutes !== null
      ? baseline.overallMeanStartWaitMinutes - forecast.overallMeanStartWaitMinutes
      : null
    const share = improvement !== null && baseline.overallMeanStartWaitMinutes! > 0
      ? improvement / baseline.overallMeanStartWaitMinutes! : 0
    const restoresCoverage = forecast.patientsUnserved < baseline.patientsUnserved
    return { move, forecast, donorHarm, improvement, share, restoresCoverage }
  }).filter((c) => c.donorHarm <= 10 &&
    (c.restoresCoverage || (c.forecast.patientsUnserved <= baseline.patientsUnserved && c.improvement !== null && c.improvement >= 2 && c.share >= 0.1)))
  return candidate.sort((a, b) =>
    a.forecast.patientsUnserved - b.forecast.patientsUnserved ||
    (a.forecast.overallMeanStartWaitMinutes ?? Infinity) - (b.forecast.overallMeanStartWaitMinutes ?? Infinity) ||
    a.move.from.localeCompare(b.move.from)
  )[0]?.move ?? null
}

function policyResult(s: SyntheticScenario, key: PolicyKey, move: Move | null, baseline: Forecast, explanation: string): PolicyResult {
  const forecast = key === 'current' ? baseline : simulateSnapshot(s, move)
  const diff = baseline.overallMeanStartWaitMinutes === null || forecast.overallMeanStartWaitMinutes === null
    ? null : forecast.overallMeanStartWaitMinutes - baseline.overallMeanStartWaitMinutes
  const titles: Record<PolicyKey, string> = {
    current: 'Current distribution', count: 'Longest queue (count)',
    workload: 'WANR-inspired workload proxy', 'next-free': 'Next-free snapshot',
  }
  return { key, title: titles[key], forecast, meanWaitChangeMinutes: diff, explanation }
}

export function evaluateScenario(s: SyntheticScenario): AdvisorReport {
  validateScenario(s)
  const current = simulateSnapshot(s)
  const moves = eligibleMoves(s)
  const longest = countMove(s, moves)
  const workload = workloadMove(s, moves, current)
  const nextFree = nextFreeMove(s, moves, current)
  const comparisons: AdvisorReport['comparisons'] = [
    policyResult(s, 'count', longest, current, `${moveText(s, longest)} Compares raw patient counts, not consultation durations.`),
    policyResult(s, 'workload', workload, current, `${moveText(s, workload)} Uses work per nurse and illustrative WANR-inspired pressure guards.`),
    policyResult(s, 'next-free', nextFree, current, `${moveText(s, nextFree)} Minimizes simulated current-backlog wait only within an illustrative donor-harm limit.`),
  ]

  const finding: AdvisorReport['modelFinding'] = current.patientsUnserved > 0 && !nextFree
    ? 'insufficient-capacity'
    : nextFree ? 'lower-modeled-wait' : 'no-supported-move'
  let findingText = nextFree
    ? `A one-nurse move ${nameOf(s, nextFree.from)} → ${nameOf(s, nextFree.to)} passes this model's illustrative checks. This is NOT an approved staffing recommendation.`
    : moves.length === 0
      ? 'No immediate synthetic move is eligible. Keep assignments unchanged; verify competencies, priority demand, idle capacity and coverage.'
      : 'No move clears the illustrative next-free benefit and donor-harm checks. The model abstains.'
  if (finding === 'insufficient-capacity') findingText = 'Some modeled patients remain without a serving nurse, and no immediately eligible move passes the synthetic guards. Capacity or clinical supervision is needed.'

  return {
    baseline: policyResult(s, 'current', null, current, 'Current synthetic roster; no staffing change.'),
    comparisons, eligibleMoves: moves, modelFinding: finding, modelFindingText: findingText,
    assumptions: [
      'All patients in this snapshot are already waiting at time zero. There are no future arrivals.',
      'Each service uses one constant illustrative consultation duration, not calibrated clinical observations.',
      'Busy nurses finish after half the assumed mean duration; consultations are never interrupted.',
      'Cross-service nurse competency, idle status, one-nurse donor minimum and priority exclusions are synthetic assumptions, not live facts.',
      'One transfer takes the specified minutes; actual approval, acknowledgement, breaks and shift timing are not simulated.',
      'The 10-minute maximum donor mean-wait increase and 2-minute/10% improvement checks are research examples, not clinical policy.',
      'Outputs represent this deterministic snapshot only, not patient guarantees, an optimal all-day schedule or a validated reallocation decision.',
    ],
  }
}
