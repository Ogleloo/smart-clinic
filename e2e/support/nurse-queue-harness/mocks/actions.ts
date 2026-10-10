/**
 * Stand-in for app/actions/nurse.ts. Same exported names and call shapes; each call is recorded and answered
 * from the test's queue. No Server Action, no Supabase.
 */
import type {
  DutyState,
  EmergencyState,
  EndSessionImpact,
  EndShiftResult,
  LongDecision,
  NextPatientResult,
  NurseCurrentEntry,
  SkipState,
  UndoResult,
  WaitingSkipState,
} from '../../../../app/actions/nurse'
import { respond } from './state'

export type * from '../../../../app/actions/nurse'

const form = (fd: FormData) => Object.fromEntries(fd.entries())

export async function getNurseCurrentState() {
  return (await respond('getNurseCurrentState', [])) as { entry: NurseCurrentEntry | null; error?: string }
}
export async function nextPatient(actionId: string, longDecision?: LongDecision) {
  return (await respond('nextPatient', [actionId, longDecision ?? null])) as { data?: NextPatientResult; error?: string }
}
export async function undoAction(actionId: string) {
  return (await respond('undoAction', [actionId])) as { data?: UndoResult; error?: string }
}
export async function endShift(longDecision?: LongDecision) {
  return (await respond('endShift', [longDecision ?? null])) as { data?: EndShiftResult; error?: string }
}
export async function checkEndSessionImpact(serviceId: string) {
  return (await respond('checkEndSessionImpact', [serviceId])) as { impact: EndSessionImpact; error?: string }
}
export async function setDuty(_prev: DutyState, fd: FormData) {
  return (await respond('setDuty', [form(fd)])) as DutyState
}
export async function skipPatient(_prev: SkipState, fd: FormData) {
  return (await respond('skipPatient', [form(fd)])) as SkipState
}
export async function skipWaitingPatient(_prev: WaitingSkipState, fd: FormData) {
  return (await respond('skipWaitingPatient', [form(fd)])) as WaitingSkipState
}
export async function setEmergencyPriority(_prev: EmergencyState, fd: FormData) {
  return (await respond('setEmergencyPriority', [form(fd)])) as EmergencyState
}
