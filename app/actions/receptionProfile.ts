'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { parsePhone, parseStaffName } from '@/lib/profileValidation'
import { changePassword, type ActionState } from '@/app/actions/profile'

export type StaffProfileState = {
  error?: string
  success?: string
  saved?: { fullName: string; phone: string }
}

/**
 * A staff member edits their own name and phone — nothing else. The patient
 * action (updateProfile) also writes date_of_birth and id_number, which this
 * form doesn't show, so reusing it would silently blank them.
 *
 * Authorization is the database's, not this function's: profiles_update_own
 * limits the write to the caller's own row and the column grants (migration
 * 20261006151206) allow only full_name, phone, date_of_birth and id_number —
 * role, clinic_id, is_active and the rest can't be written whatever is sent.
 * No profile id is accepted from the browser; the row is found by the
 * authenticated user's own auth_user_id, and .select() turns a silently
 * filtered (zero-row) update into an error instead of a false "saved".
 */
export async function updateStaffProfile(_prev: StaffProfileState, formData: FormData): Promise<StaffProfileState> {
  const name = parseStaffName(String(formData.get('full_name') ?? ''))
  if (name.error) return { error: name.error }
  const phone = parsePhone(String(formData.get('phone') ?? ''))
  if (phone.error) return { error: phone.error }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Your session has expired. Log in again.' }

  const { data, error } = await supabase
    .from('profiles')
    .update({ full_name: name.value as string, phone: phone.value })
    .eq('auth_user_id', user.id)
    .select('full_name, phone')

  if (error || !data || data.length !== 1) return { error: 'Couldn’t save your details. Try again.' }

  revalidatePath('/reception', 'layout')
  return {
    success: 'Your details have been saved.',
    saved: { fullName: data[0].full_name, phone: data[0].phone ?? '' },
  }
}

/**
 * Same re-authenticating password change patients use (current password is
 * checked first, so an unattended signed-in session can't be used to take the
 * account over), plus one staff-specific step: sign out every OTHER session.
 * Clinic computers are shared.
 *
 * What signOut({ scope: 'others' }) actually does: it revokes the other
 * sessions' refresh tokens, so they can't renew. An access token already issued
 * to another device stays valid until it expires (the project's JWT expiry —
 * Supabase's default is one hour). The messages say that, rather than
 * implying the other devices are cut off this instant.
 */
export async function changeStaffPassword(prev: ActionState, formData: FormData): Promise<ActionState> {
  const result = await changePassword(prev, formData)
  if (!result.success) return result

  const supabase = await createClient()
  const { error } = await supabase.auth.signOut({ scope: 'others' })
  if (error) {
    return {
      success:
        'Password changed. We couldn’t end your sessions on other devices — sign out on any shared computer you used.',
    }
  }
  return {
    success:
      'Password changed. Other devices can no longer renew their sign-in and will be signed out when their current session expires. To be sure, sign out on any shared computer you used.',
  }
}
