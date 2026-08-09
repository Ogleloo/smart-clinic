import { createClient } from '@/lib/supabase/server'
import { SettingsForm } from '@/components/admin/SettingsForm'

export default async function AdminSettingsPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { data: profile } = await supabase
    .from('profiles')
    .select('clinic_id')
    .eq('auth_user_id', user?.id ?? '')
    .single()

  // settings_read grants an admin caller RLS visibility into every
  // clinic's settings row (clinic_id = auth_clinic_id() OR role =
  // 'admin'), not just their own — an unfiltered .maybeSingle() here
  // only "works" today because this system has exactly one clinic. The
  // filter is this query's own invariant ("my clinic's settings"), not
  // a duplicate of RLS — same fix as the dashboard profile query.
  const { data: settings, error } = await supabase
    .from('clinic_settings')
    .select('*')
    .eq('clinic_id', profile?.clinic_id ?? '')
    .maybeSingle()

  return (
    <div className="flex max-w-md flex-col gap-4">
      <h2 className="font-display text-lg font-semibold text-ink">Settings</h2>
      <p className="text-sm text-muted">
        These tune the wait-time prediction engine directly. Each field explains what it does — read it
        before changing the number.
      </p>

      {error || !settings ? (
        <p className="text-sm text-danger">Couldn&rsquo;t load clinic settings. Try refreshing.</p>
      ) : (
        <SettingsForm settings={settings} />
      )}
    </div>
  )
}
