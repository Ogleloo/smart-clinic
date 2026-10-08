'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { parseDateOfBirth, parseIdNumber } from '@/lib/profileValidation'
import { todayInClinicTimezone } from '@/lib/clinicTime'

export type ActionState = { error?: string; success?: string }

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
 */
export async function updateProfile(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const fullName = String(formData.get('full_name') ?? '').trim()
  const phone = String(formData.get('phone') ?? '').trim()
  const dob = parseDateOfBirth(String(formData.get('date_of_birth') ?? ''), todayInClinicTimezone())
  const idNumber = parseIdNumber(String(formData.get('id_number') ?? ''))

  if (!fullName) return { error: 'Enter your full name.' }
  if (fullName.length > 120) return { error: 'Full name is too long.' }
  if (phone.length > 30) return { error: 'Phone number is too long.' }
  if (dob.error) return { error: dob.error }
  if (idNumber.error) return { error: idNumber.error }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Your session has expired. Log in again.' }

  const { data, error } = await supabase
    .from('profiles')
    .update({
      full_name: fullName,
      phone: phone || null,
      date_of_birth: dob.value,
      id_number: idNumber.value,
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
  if (next.length < 8) return { error: 'New password must be at least 8 characters.' }
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
