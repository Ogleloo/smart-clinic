import { createClient } from '@/lib/supabase/server'
import { CLINIC_TIMEZONE, todayInClinicTimezone } from '@/lib/clinicTime'
import { StatusChip } from '@/components/ui/StatusChip'
import { APPOINTMENT_STATUS_TO_CHIP } from '@/components/ui/AppointmentCard'
import { CheckInAppointmentButton } from '@/components/reception/CheckInAppointmentButton'
import { EmptyState } from '@/components/ui/EmptyState'

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: CLINIC_TIMEZONE,
  })
}

/**
 * appointments has two FKs to profiles (patient_id, cancelled_by), so
 * the embed must be disambiguated with the relationship name or
 * PostgREST rejects the query as ambiguous (PGRST201).
 */
export default async function ReceptionAppointmentsPage() {
  const supabase = await createClient()
  const today = todayInClinicTimezone()

  const { data: appointments, error } = await supabase
    .from('appointments')
    .select(
      'id, scheduled_time, status, patient:profiles!appointments_patient_id_fkey(full_name), service:services(name)'
    )
    .eq('scheduled_date', today)
    .order('scheduled_time')

  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-display text-lg font-semibold text-ink">Today&rsquo;s appointments</h2>

      {error ? (
        <p className="text-sm text-danger">Couldn&rsquo;t load appointments. Try refreshing.</p>
      ) : !appointments || appointments.length === 0 ? (
        <EmptyState headline="No appointments today" fullWidth />
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs font-semibold tracking-wide text-muted">
              <th className="py-2 font-semibold">Patient</th>
              <th className="py-2 font-semibold">Service</th>
              <th className="py-2 font-semibold">Time</th>
              <th className="py-2 font-semibold">Status</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {appointments.map((appointment) => (
              <tr key={appointment.id} className="border-b border-border">
                <td className="py-3 font-semibold text-ink">
                  {appointment.patient?.full_name ?? 'Unknown patient'}
                </td>
                <td className="py-3 text-ink">{appointment.service?.name ?? '—'}</td>
                <td className="py-3 font-mono tabular-nums text-ink">
                  {formatTime(appointment.scheduled_time)}
                </td>
                <td className="py-3">
                  <StatusChip status={APPOINTMENT_STATUS_TO_CHIP[appointment.status]} />
                </td>
                <td className="py-3 text-right">
                  {appointment.status === 'booked' && (
                    <CheckInAppointmentButton appointmentId={appointment.id} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
