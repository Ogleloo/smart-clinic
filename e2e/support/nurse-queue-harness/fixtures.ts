import { todayInClinicTimezone } from '../../../lib/clinicTime'
import type { CompletedConsultationRow, QueueSnapshot } from '../../../lib/nurseQueue'
import type { NurseCurrentEntry, CalledResult } from '../../../app/actions/nurse'
import type { MyQueueViewProps } from '../../../components/nurse/v3/MyQueueView'
import type { HarnessResponse } from './mocks/state'

/**
 * Synthetic data only — never read from or written to the shared project. Names are deliberately not the Figma
 * example patients. Times are built on today's clinic-calendar date so "completed today" applies: 07:12Z is
 * 09:12 in Africa/Johannesburg.
 */
export const TODAY = todayInClinicTimezone()
export const at = (hhmmUtc: string) => `${TODAY}T${hhmmUtc}:00Z`
/** An ISO time `minutes` ago — for a consultation that has been open a realistic while. */
export const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()

export const SERVICE_ID = '00000000-0000-4000-8000-000000000001'
export const OTHER_SERVICE_ID = '00000000-0000-4000-8000-000000000002'

export const ID = {
  current: 'aaaaaaaa-0000-4000-8000-000000000001',
  emergency: 'aaaaaaaa-0000-4000-8000-000000000002',
  first: 'aaaaaaaa-0000-4000-8000-000000000003',
  second: 'aaaaaaaa-0000-4000-8000-000000000004',
  otherNurse: 'aaaaaaaa-0000-4000-8000-000000000005',
  unknownWait: 'aaaaaaaa-0000-4000-8000-000000000006',
  completedQ: 'aaaaaaaa-0000-4000-8000-000000000007',
  breakQ: 'aaaaaaaa-0000-4000-8000-000000000008',
  skippedQ: 'aaaaaaaa-0000-4000-8000-000000000009',
  newCheckIn: 'aaaaaaaa-0000-4000-8000-000000000010',
}

type QueueRpcRow = QueueSnapshot['queue'][number]
const q = (id: string, token: string, name: string, status: 'waiting' | 'in_progress', priority: number, checkedIn: string, mins: number | null): QueueRpcRow => ({
  queue_entry_id: id,
  queue_position: 0,
  token,
  patient_name: name,
  priority,
  status,
  checked_in_at: checkedIn,
  waiting_minutes: mins as number,
})

export const CURRENT: NurseCurrentEntry = {
  queueEntryId: ID.current,
  consultationId: 'cccccccc-0000-4000-8000-000000000001',
  serviceId: SERVICE_ID,
  token: 'GC-101',
  patientName: 'Harness Current',
  priority: 0,
  startedAt: minutesAgo(12),
  checkedInAt: at('07:05'),
  isWalkIn: true,
}

/** Database order: get_service_queue sorts emergency first, then check-in time. */
export const QUEUE: QueueRpcRow[] = [
  q(ID.current, 'GC-101', 'Harness Current', 'in_progress', 0, at('07:05'), 40),
  q(ID.emergency, 'GC-107', 'Harness Emergency', 'waiting', 1, at('07:40'), 3),
  q(ID.first, 'GC-102', 'Harness First', 'waiting', 0, at('07:12'), 25),
  q(ID.otherNurse, 'GC-103', 'Harness Other Nurse', 'in_progress', 0, at('07:14'), 30),
  q(ID.second, 'GC-104', 'Harness Second', 'waiting', 0, at('07:18'), 19),
  q(ID.unknownWait, 'GC-105', 'Harness Unknown Wait', 'waiting', 0, at('07:21'), null),
]

const cons = (id: string, qid: string, token: string, name: string, started: string, ended: string | null, reason: string | null, serviceId = SERVICE_ID): CompletedConsultationRow => ({
  id,
  started_at: started,
  ended_at: ended,
  exclusion_reason: reason,
  service_id: serviceId,
  queue_entry: { id: qid, token, checked_in_at: started, patient: { full_name: name } },
})

export const COMPLETED: CompletedConsultationRow[] = [
  cons('dddddddd-0000-4000-8000-000000000001', ID.completedQ, 'GC-090', 'Harness Done', at('06:30'), at('06:45'), null),
  cons('dddddddd-0000-4000-8000-000000000002', ID.breakQ, 'IM-004', 'Harness Break', at('06:50'), at('07:25'), 'staff_break', OTHER_SERVICE_ID),
  cons('dddddddd-0000-4000-8000-000000000003', ID.skippedQ, 'GC-091', 'Harness Skipped', at('06:46'), at('06:47'), 'patient_skipped'),
]

export const ESTIMATES: Record<string, number | null> = { [ID.emergency]: 4, [ID.first]: 7, [ID.second]: null, [ID.unknownWait]: 12 }

export const snapshot = (over: Partial<QueueSnapshot> = {}): QueueSnapshot => ({ queue: QUEUE, estimates: ESTIMATES, completed: COMPLETED, errors: {}, ...over })

export function queueProps(over: Partial<MyQueueViewProps> = {}): MyQueueViewProps {
  return {
    nurse: { profileId: 'nnnnnnnn-0000-4000-8000-000000000001', fullName: 'Harness Nurse', clinicName: 'Test Clinic', isOnDuty: true, serviceId: SERVICE_ID, serviceName: 'General Consultation' },
    services: [
      { id: SERVICE_ID, name: 'General Consultation' },
      { id: OTHER_SERVICE_ID, name: 'Immunisation' },
    ],
    serviceNames: { [SERVICE_ID]: 'General Consultation', [OTHER_SERVICE_ID]: 'Immunisation' },
    initialSnapshot: snapshot(),
    initialEntry: CURRENT,
    undoWindowSeconds: 60,
    serviceAverageMinutes: 11,
    ...over,
  }
}

/** Read responses that make the client's own refreshes return the same data as the first paint. */
export function readDefaults(snap: QueueSnapshot = snapshot(), entry: NurseCurrentEntry | null = CURRENT): Record<string, HarnessResponse> {
  return {
    'rpc:get_service_queue': { value: { data: snap.queue, error: null } },
    'rpc:get_wait_estimate': { value: { data: { estimated_wait_minutes: 7 }, error: null } },
    'from:consultations': { value: { data: snap.completed, error: null } },
    getNurseCurrentState: { value: { entry } },
    checkEndSessionImpact: { value: { impact: null } },
  }
}

export const NEXT_IN_ROOM: NurseCurrentEntry = {
  ...CURRENT,
  queueEntryId: ID.emergency,
  consultationId: 'cccccccc-0000-4000-8000-000000000002',
  token: 'GC-107',
  patientName: 'Harness Emergency',
  priority: 1,
  startedAt: at('08:00'),
  checkedInAt: at('07:40'),
}

export const CALLED: CalledResult = {
  status: 'called',
  token: 'GC-107',
  patient_name: 'Harness Emergency',
  priority: 1,
  consultation_id: NEXT_IN_ROOM.consultationId,
  queue_entry_id: ID.emergency,
  ended_token: 'GC-101',
  ended_minutes: 30,
  ended_counted: true,
  ended_exclusion_reason: null,
  service_average: 11,
  confidence: 'high',
  undo_window_seconds: 60,
}
