'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

async function requireAdminClinicId(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('profiles').select('clinic_id').eq('auth_user_id', user.id).single()
  return data?.clinic_id ?? null
}

export type ServiceFormState = { error?: string; success?: boolean }

export async function createService(_prev: ServiceFormState, formData: FormData): Promise<ServiceFormState> {
  const name = String(formData.get('name') ?? '').trim()
  const tokenPrefix = String(formData.get('token_prefix') ?? '')
    .trim()
    .toUpperCase()
  const defaultMinutes = Number(formData.get('default_consultation_minutes'))

  if (!name) return { error: 'Enter a service name.' }
  if (!tokenPrefix) return { error: 'Enter a token prefix.' }
  if (!Number.isFinite(defaultMinutes) || defaultMinutes <= 0) {
    return { error: 'Enter a valid default duration in minutes.' }
  }

  const supabase = await createClient()
  const clinicId = await requireAdminClinicId(supabase)
  if (!clinicId) return { error: 'Could not determine your clinic.' }

  const { error } = await supabase.from('services').insert({
    clinic_id: clinicId,
    name,
    token_prefix: tokenPrefix,
    default_consultation_minutes: defaultMinutes,
  })
  if (error) return { error: error.message }

  revalidatePath('/admin/services')
  return { success: true }
}

export async function updateService(_prev: ServiceFormState, formData: FormData): Promise<ServiceFormState> {
  const id = String(formData.get('id') ?? '')
  const name = String(formData.get('name') ?? '').trim()
  const tokenPrefix = String(formData.get('token_prefix') ?? '')
    .trim()
    .toUpperCase()
  const defaultMinutes = Number(formData.get('default_consultation_minutes'))
  const isActive = formData.get('is_active') === 'true'

  if (!id) return { error: 'Missing service.' }
  if (!name) return { error: 'Enter a service name.' }
  if (!tokenPrefix) return { error: 'Enter a token prefix.' }
  if (!Number.isFinite(defaultMinutes) || defaultMinutes <= 0) {
    return { error: 'Enter a valid default duration in minutes.' }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('services')
    .update({
      name,
      token_prefix: tokenPrefix,
      default_consultation_minutes: defaultMinutes,
      is_active: isActive,
    })
    .eq('id', id)
  if (error) return { error: error.message }

  revalidatePath('/admin/services')
  revalidatePath('/book')
  return { success: true }
}

export type SettingsFormState = { error?: string; success?: boolean }

export async function updateClinicSettings(
  _prev: SettingsFormState,
  formData: FormData
): Promise<SettingsFormState> {
  const supabase = await createClient()
  const clinicId = await requireAdminClinicId(supabase)
  if (!clinicId) return { error: 'Could not determine your clinic.' }

  const fieldLabels: Record<string, string> = {
    confidence_min_count_floor: 'minimum sample size',
    confidence_high_min_count: 'high-confidence sample size',
    confidence_consistent_stddev_minutes: 'consistent variation threshold',
    confidence_inconsistent_stddev_minutes: 'inconsistent variation threshold',
    capacity_threshold: 'capacity threshold',
    min_plausible_consultation_minutes: 'minimum plausible duration',
    max_plausible_consultation_minutes: 'maximum plausible duration',
    no_show_grace_minutes: 'no-show grace period',
    min_booking_lead_minutes: 'minimum booking lead time',
  }

  function readField(name: string): number | { error: string } {
    const raw = Number(formData.get(name))
    if (!Number.isFinite(raw) || raw < 0) return { error: `Enter a valid value for ${fieldLabels[name]}.` }
    return raw
  }

  const confidenceMinCountFloor = readField('confidence_min_count_floor')
  if (typeof confidenceMinCountFloor !== 'number') return confidenceMinCountFloor
  const confidenceHighMinCount = readField('confidence_high_min_count')
  if (typeof confidenceHighMinCount !== 'number') return confidenceHighMinCount
  const confidenceConsistentStddevMinutes = readField('confidence_consistent_stddev_minutes')
  if (typeof confidenceConsistentStddevMinutes !== 'number') return confidenceConsistentStddevMinutes
  const confidenceInconsistentStddevMinutes = readField('confidence_inconsistent_stddev_minutes')
  if (typeof confidenceInconsistentStddevMinutes !== 'number') return confidenceInconsistentStddevMinutes
  const capacityThreshold = readField('capacity_threshold')
  if (typeof capacityThreshold !== 'number') return capacityThreshold
  const minPlausibleConsultationMinutes = readField('min_plausible_consultation_minutes')
  if (typeof minPlausibleConsultationMinutes !== 'number') return minPlausibleConsultationMinutes
  const maxPlausibleConsultationMinutes = readField('max_plausible_consultation_minutes')
  if (typeof maxPlausibleConsultationMinutes !== 'number') return maxPlausibleConsultationMinutes
  const noShowGraceMinutes = readField('no_show_grace_minutes')
  if (typeof noShowGraceMinutes !== 'number') return noShowGraceMinutes
  const minBookingLeadMinutes = readField('min_booking_lead_minutes')
  if (typeof minBookingLeadMinutes !== 'number') return minBookingLeadMinutes

  if (minPlausibleConsultationMinutes >= maxPlausibleConsultationMinutes) {
    return { error: 'The minimum plausible duration must be less than the maximum.' }
  }
  if (confidenceMinCountFloor > confidenceHighMinCount) {
    return { error: 'The high-confidence sample size must be at least the minimum floor.' }
  }

  const { error } = await supabase
    .from('clinic_settings')
    .update({
      confidence_min_count_floor: confidenceMinCountFloor,
      confidence_high_min_count: confidenceHighMinCount,
      confidence_consistent_stddev_minutes: confidenceConsistentStddevMinutes,
      confidence_inconsistent_stddev_minutes: confidenceInconsistentStddevMinutes,
      capacity_threshold: capacityThreshold,
      min_plausible_consultation_minutes: minPlausibleConsultationMinutes,
      max_plausible_consultation_minutes: maxPlausibleConsultationMinutes,
      no_show_grace_minutes: noShowGraceMinutes,
      min_booking_lead_minutes: minBookingLeadMinutes,
    })
    .eq('clinic_id', clinicId)
  if (error) return { error: error.message }

  revalidatePath('/admin/settings')
  return { success: true }
}

export type StaffFormState = { error?: string; success?: boolean }

const STAFF_ROLES = ['receptionist', 'nurse', 'admin'] as const

export async function updateStaffMember(_prev: StaffFormState, formData: FormData): Promise<StaffFormState> {
  const id = String(formData.get('id') ?? '')
  const role = String(formData.get('role') ?? '')
  const isActive = formData.get('is_active') === 'true'

  if (!id) return { error: 'Missing staff member.' }
  if (!STAFF_ROLES.includes(role as (typeof STAFF_ROLES)[number])) return { error: 'Invalid role.' }

  const supabase = await createClient()

  // A staff member can't deactivate or demote themselves out of admin —
  // that would leave the clinic with no one able to undo the change.
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { data: self } = await supabase.from('profiles').select('id').eq('auth_user_id', user?.id ?? '').single()
  if (self?.id === id && (!isActive || role !== 'admin')) {
    return { error: 'You cannot deactivate or demote your own account.' }
  }

  const { error } = await supabase
    .from('profiles')
    .update({ role: role as (typeof STAFF_ROLES)[number], is_active: isActive })
    .eq('id', id)
  if (error) return { error: error.message }

  revalidatePath('/admin/staff')
  return { success: true }
}

export type MergeState = { error?: string; result?: { queueEntriesMoved: number; appointmentsMoved: number; notificationsMoved: number; auditRefsMoved: number } }

export async function mergePatientProfiles(_prev: MergeState, formData: FormData): Promise<MergeState> {
  const keepId = String(formData.get('keep_id') ?? '')
  const mergeId = String(formData.get('merge_id') ?? '')
  if (!keepId || !mergeId) return { error: 'Missing profile ids.' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .rpc('merge_patient_profiles', { p_keep_id: keepId, p_merge_id: mergeId })
    .single()
  if (error) return { error: error.message }

  revalidatePath('/admin/patients')
  return {
    result: {
      queueEntriesMoved: data.queue_entries_moved,
      appointmentsMoved: data.appointments_moved,
      notificationsMoved: data.notifications_moved,
      auditRefsMoved: data.audit_refs_moved,
    },
  }
}
