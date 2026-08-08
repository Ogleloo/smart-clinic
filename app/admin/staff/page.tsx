import { createClient } from '@/lib/supabase/server'
import { StaffRow } from '@/components/admin/StaffRow'

export default async function AdminStaffPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { data: staff, error } = await supabase
    .from('profiles')
    .select('*')
    .in('role', ['receptionist', 'nurse', 'admin'])
    .order('full_name')

  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-display text-lg font-semibold text-ink">Staff</h2>
      <p className="text-sm text-muted">
        Set each staff member&rsquo;s role and whether they can sign in. Staff accounts themselves are
        created outside this app — creating a login requires elevated access this interface intentionally
        never holds.
      </p>

      {error ? (
        <p className="text-sm text-danger">Couldn&rsquo;t load staff. Try refreshing.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {(staff ?? []).map((member) => (
            <StaffRow key={member.id} staff={member} isSelf={member.auth_user_id === user?.id} />
          ))}
        </div>
      )}
    </div>
  )
}
