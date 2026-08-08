import { createClient } from '@/lib/supabase/server'
import { SettingsForm } from '@/components/admin/SettingsForm'

export default async function AdminSettingsPage() {
  const supabase = await createClient()
  const { data: settings, error } = await supabase.from('clinic_settings').select('*').maybeSingle()

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
