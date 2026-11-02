'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { profileEditInputFrom, validateProfileEdit, PROFILE_EDIT_FIELD_ORDER, type ProfileEditErrors } from '@/lib/profileEditValidation'
import { todayInClinicTimezone } from '@/lib/clinicTime'
import { validatePassword } from '@/lib/passwordValidation'

export type ActionState = { error?: string; success?: string; fieldErrors?: ProfileEditErrors }

/**
 * Patient edits their own profile. profiles_update_own scopes the write
 * to the caller's row, and column grants (migration 20261006151206)
 * limit it to full_name, phone, date_of_birth and id_number — role,
 * clinic_id and is_active can't be touched from here whatever is sent.
 *
 * The explicit .eq('auth_user_id') isn't redundant with that policy: it
 * makes "exactly this one row" the query's own invariant, and .select()
 * lets a silently-filtered update (zero rows) surface as an error
 * instead of a false "saved".
 *
 * date_of_birth and id_number are read back first (`current`) so
 * validateProfileEdit can tell an edited value from an untouched one —
 * an existing value saved under an older, looser rule is written back
 * exactly as it already was, not re-validated and not blanked, unless
 * the person actually changes it.
 */
export async function updateProfile(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Your session has expired. Log in again.' }

  const { data: current, error: fetchError } = await supabase
    .from('profiles')
    .select('id_number, date_of_birth')
    .eq('auth_user_id', user.id)
    .single()
  if (fetchError || !current) return { error: 'Couldn’t load your current details. Try again.' }

  const { errors, values } = validateProfileEdit(profileEditInputFrom(formData), current, todayInClinicTimezone())
  if (!values) {
    const first = PROFILE_EDIT_FIELD_ORDER.find((f) => errors[f])
    return { error: first ? errors[first] : 'Check your details and try again.', fieldErrors: errors }
  }

  const { data, error } = await supabase
    .from('profiles')
    .update({
      full_name: values.fullName,
      phone: values.phone,
      date_of_birth: values.dateOfBirth,
      id_number: values.idNumber,
    })
    .eq('auth_user_id', user.id)
    .select('id')

  if (error) return { error: 'Couldn’t save your details. Try again.' }
  if (!data || data.length !== 1) return { error: 'Couldn’t save your details. Try again.' }

  revalidatePath('/profile')
  revalidatePath('/profile/settings')
  revalidatePath('/dashboard')
  return { success: 'Your details have been saved.' }
}

/**
 * Re-authenticates with the current password before changing it, so an
 * unattended signed-in session (a shared clinic device) can't be used
 * to take over the account by setting a new password.
 */
export async function changePassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const current = String(formData.get('current_password') ?? '')
  const next = String(formData.get('new_password') ?? '')
  const confirm = String(formData.get('confirm_password') ?? '')

  if (!current) return { error: 'Enter your current password.' }
  // Judged exactly as typed — never trimmed. See lib/passwordValidation.ts.
  const strength = validatePassword(next, { label: 'New password' })
  if (!strength.ok) return { error: strength.error }
  if (next !== confirm) return { error: 'Those passwords don’t match.' }
  if (next === current) return { error: 'Choose a password different from your current one.' }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.email) return { error: 'Your session has expired. Log in again.' }

  const { error: reauthError } = await supabase.auth.signInWithPassword({ email: user.email, password: current })
  if (reauthError) return { error: 'Your current password is incorrect.' }

  const { error } = await supabase.auth.updateUser({ password: next })
  if (error) return { error: error.message }

  return { success: 'Password changed.' }
}
