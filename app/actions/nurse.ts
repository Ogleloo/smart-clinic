'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export type LongDecision = 'record' | 'break'

// next_patient/undo_next_patient/end_shift all return `jsonb`, which
// Supabase's generator can only type as `Json` — these are the actual
// shapes, read directly off the migration 0028-0031 function bodies
// (backend is frozen; these are documentation of what it does, not a
// contract this file gets to redefine).
export type CalledResult = {
  status: 'called'
  token: string
  patient_name: string
  priority: number
  consultation_id: string
  queue_entry_id: string
  ended_token: string | null
  ended_minutes: number | null
  ended_excluded: boolean
  service_average: number | null
  confidence: string | null
  undo_window_seconds: number
  replayed?: boolean
}

export type QueueEmptyResult = {
  status: 'queue_empty'
  ended_consultation_id: string | null
  ended_token: string | null
  ended_excluded: boolean
  replayed?: boolean
}

export type LongConsultationResult = {
  status: 'long_consultation'
  queue_entry_id: string
  duration_minutes: number
  threshold_minutes: number
  replayed?: boolean
}

export type NextPatientResult = CalledResult | QueueEmptyResult | LongConsultationResult

export type EndShiftResult =
  | { status: 'shift_ended'; closed_consultation: boolean; closed_token: string | null; closed_minutes: number | null; excluded: boolean }
  | { status: 'long_consultation'; duration_minutes: number; threshold_minutes: number }

export type UndoResult = { status: 'undone'; restored_token: string | null }

/**
 * The nurse's *current* state, read directly off the tables — never
 * derived from an RPC call. Used both for the initial server-rendered
 * page (crash-mid-call recovery: if a consultation is already open,
 * show it — do not auto-call) and for client-side reconciliation
 * (window focus, after undo) where a second tab may have moved the
 * queue forward without this tab's knowledge.
 */
export type NurseCurrentEntry = {
  queueEntryId: string
  consultationId: string
  token: string
  patientName: string
  priority: number
  startedAt: string
}

export async function getNurseCurrentState(): Promise<{ entry: NurseCurrentEntry | null; error?: string }> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { entry: null, error: 'Not signed in.' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('auth_user_id', user.id)
    .single()
  if (!profile) return { entry: null, error: 'Could not load your profile.' }

  // An open consultation (ended_at is null) is the one source of truth
  // for "is something in progress right now" — not is_on_duty, which
  // end_shift already keeps in sync, and not a client-held flag, which
  // a crash or a second tab could make stale.
  const { data: consultation, error } = await supabase
    .from('consultations')
    .select(
      'id, started_at, queue_entry:queue_entries!consultations_queue_entry_id_fkey(id, token, priority, patient:profiles!queue_entries_patient_id_fkey(full_name))'
    )
    .eq('nurse_id', profile.id)
    .is('ended_at', null)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) return { entry: null, error: error.message }
  if (!consultation) return { entry: null }

  return {
    entry: {
      queueEntryId: consultation.queue_entry.id,
      consultationId: consultation.id,
      token: consultation.queue_entry.token,
      patientName: consultation.queue_entry.patient?.full_name ?? 'Unknown patient',
      priority: consultation.queue_entry.priority,
      startedAt: consultation.started_at,
    },
  }
}

/**
 * p_action_id is generated ONCE per button press on the client
 * (crypto.randomUUID()) and reused on every retry of that same press —
 * see ADR (nurse workflow) for why. This function is a plain async
 * function, not a useActionState-shaped action: the caller needs to
 * pass a dynamically generated id and an optional decision on a second
 * call, which doesn't fit the (prevState, formData) form.
 */
export async function nextPatient(
  actionId: string,
  longDecision?: LongDecision
): Promise<{ data?: NextPatientResult; error?: string }> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('next_patient', {
    p_action_id: actionId,
    p_long_decision: longDecision,
  })
  if (error) return { error: error.message }

  revalidatePath('/nurse')
  return { data: data as NextPatientResult }
}

/** Undo targets one specific action_id — the one that produced the result currently on screen, not "whatever was last." */
export async function undoAction(actionId: string): Promise<{ data?: UndoResult; error?: string }> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('undo_next_patient', { p_action_id: actionId })
  if (error) return { error: error.message }

  revalidatePath('/nurse')
  return { data: data as UndoResult }
}

/**
 * No action_id: end_shift isn't part of the nurse_actions ledger. It
 * doesn't need to be — its own guard (only close a consultation whose
 * ended_at is still null) already makes a duplicate call a safe no-op.
 */
export async function endShift(longDecision?: LongDecision): Promise<{ data?: EndShiftResult; error?: string }> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('end_shift', { p_long_decision: longDecision })
  if (error) return { error: error.message }

  revalidatePath('/nurse')
  return { data: data as EndShiftResult }
}

export type DutyState = { error?: string }

export async function setDuty(_prev: DutyState, formData: FormData): Promise<DutyState> {
  const onDuty = formData.get('on_duty') === 'true'
  const serviceId = String(formData.get('service_id') ?? '')
  if (onDuty && !serviceId) return { error: 'Pick a service first.' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('set_duty', {
    p_on_duty: onDuty,
    p_service_id: serviceId || undefined,
  })
  if (error) return { error: error.message }

  revalidatePath('/nurse')
  return {}
}

export type SkipState = { error?: string; skipped?: boolean }

export async function skipPatient(_prev: SkipState, formData: FormData): Promise<SkipState> {
  const queueEntryId = String(formData.get('queue_entry_id') ?? '')
  if (!queueEntryId) return { error: 'Missing queue entry.' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('skip_patient', { p_queue_entry_id: queueEntryId })
  if (error) return { error: error.message }

  revalidatePath('/nurse')
  return { skipped: true }
}

export type EmergencyState = { error?: string; success?: boolean }

export async function setEmergencyPriority(
  _prev: EmergencyState,
  formData: FormData
): Promise<EmergencyState> {
  const queueEntryId = String(formData.get('queue_entry_id') ?? '')
  const emergency = formData.get('emergency') === 'true'
  if (!queueEntryId) return { error: 'Missing queue entry.' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('set_emergency_priority', {
    p_queue_entry_id: queueEntryId,
    p_emergency: emergency,
  })
  if (error) return { error: error.message }

  revalidatePath('/nurse')
  return { success: true }
}
