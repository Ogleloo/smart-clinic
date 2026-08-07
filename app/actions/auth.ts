'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import type { UserRole } from '@/lib/types/database.types'

export type ActionState = { error?: string; success?: string }

/** Where each role lands after logging in (RBAC — FR-1.4). */
function homeForRole(role: UserRole): string {
  switch (role) {
    case 'admin':        return '/admin'
    case 'nurse':        return '/nurse'
    case 'receptionist': return '/reception'
    default:             return '/dashboard'
  }
}

export async function register(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const fullName = String(formData.get('full_name') ?? '').trim()
  const email = String(formData.get('email') ?? '').trim()
  const phone = String(formData.get('phone') ?? '').trim()
  const password = String(formData.get('password') ?? '')

  if (!fullName) return { error: 'Enter your full name.' }
  if (!email) return { error: 'Enter your email address.' }
  if (password.length < 8) return { error: 'Password must be at least 8 characters.' }

  const supabase = await createClient()

  // NOTE: the profile row is created by the database trigger
  // (handle_new_user), which forces role = 'patient'. Nothing sent
  // from here can grant staff access (BR-1, FR-1.2).
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName, phone } },
  })

  if (error) return { error: error.message }

  revalidatePath('/', 'layout')
  redirect('/dashboard')
}

export async function login(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const email = String(formData.get('email') ?? '').trim()
  const password = String(formData.get('password') ?? '')

  if (!email || !password) return { error: 'Enter your email and password.' }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })

  // Deliberately vague: revealing whether the email exists helps
  // attackers enumerate accounts.
  if (error) return { error: 'Those details don\u2019t match an account.' }

  // Read the role to route the user to the right home.
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, is_active')
    .single()

  if (profile && !profile.is_active) {
    await supabase.auth.signOut()
    return { error: 'This account has been deactivated. Please contact the clinic.' }
  }

  revalidatePath('/', 'layout')
  redirect(homeForRole(profile?.role ?? 'patient'))
}

export async function logout() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  revalidatePath('/', 'layout')
  redirect('/login')
}

export async function requestPasswordReset(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const email = String(formData.get('email') ?? '').trim()
  if (!email) return { error: 'Enter your email address.' }

  const supabase = await createClient()
  const origin = (await headers()).get('origin') ?? ''

  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/callback?next=/reset-password`,
  })

  // Always report success, even if no such account exists — otherwise
  // this endpoint becomes an account-enumeration oracle.
  return { success: 'If that email is registered, a reset link is on its way.' }
}

export async function updatePassword(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const password = String(formData.get('password') ?? '')
  const confirm = String(formData.get('confirm') ?? '')

  if (password.length < 8) return { error: 'Password must be at least 8 characters.' }
  if (password !== confirm) return { error: 'Those passwords don\u2019t match.' }

  const supabase = await createClient()
  const { error } = await supabase.auth.updateUser({ password })
  if (error) return { error: error.message }

  redirect('/dashboard')
}
