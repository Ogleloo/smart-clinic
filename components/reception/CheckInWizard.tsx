'use client'

import { useActionState, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  checkInAppointment,
  checkInPatient,
  createWalkinPatient,
  type CheckInState,
  type CreatePatientState,
} from '@/app/actions/reception'
import { PatientSearchBox, type PatientSearchResult } from '@/components/reception/PatientSearchBox'
import { ServicePicker, type Service } from '@/components/booking/ServicePicker'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { QueueToken } from '@/components/ui/QueueToken'
import { LinkButton } from '@/components/ui/LinkButton'
import { initials } from '@/lib/initials'
import { todayInClinicTimezone, formatClinicTime } from '@/lib/clinicTime'

type Step = 'search' | 'confirm' | 'queue'

interface PatientRecord {
  id: string
  full_name: string
  phone: string | null
  date_of_birth: string | null
  id_number: string | null
}

interface EligibleAppointment {
  id: string
  scheduled_time: string
  service_id: string
  service_name: string
}

interface CheckInWizardProps {
  services: Service[]
  /** From a handoff elsewhere in reception — re-verified through RLS below, never trusted as-is. */
  initialPatientId?: string
  initialNewPatientName?: string
}

const STEPS: { key: Step; label: string }[] = [
  { key: 'search', label: '1. Find patient' },
  { key: 'confirm', label: '2. Confirm details' },
  { key: 'queue', label: '3. Add to queue' },
]

/**
 * Figma frames 111:183 / 111:342 / 111:487 / 112:302 (page "04 · Reception
 * V3"). Consolidates the old WalkInWizard + CheckInAppointmentButton into
 * one flow: appointment check-in and walk-in registration are the same
 * wizard, branching at step 2 on a REAL lookup of the patient's bookings
 * for today — never a cosmetic toggle, and an appointment_id is only ever
 * read off that lookup's result, never typed in or assumed.
 *
 * No Notes field: neither check_in_appointment nor check_in_patient
 * accepts one. No predicted-token preview on the "Add to queue" step,
 * unlike Figma — the real queue token only exists after the RPC call
 * actually succeeds, and showing a guess ahead of that would be exactly
 * the kind of unjustified number this project's rules forbid.
 */
export function CheckInWizard(props: CheckInWizardProps) {
  // Keying on a counter forces a full remount on reset — the only way to
  // clear useActionState's internal result state, same pattern WalkInWizard
  // used this for.
  const [instanceKey, setInstanceKey] = useState(0)
  return (
    <CheckInWizardInner
      key={instanceKey}
      services={props.services}
      initialPatientId={instanceKey === 0 ? props.initialPatientId : undefined}
      initialNewPatientName={instanceKey === 0 ? props.initialNewPatientName : undefined}
      onReset={() => setInstanceKey((k) => k + 1)}
    />
  )
}

function CheckInWizardInner({
  services,
  initialPatientId,
  initialNewPatientName,
  onReset,
}: CheckInWizardProps & { onReset: () => void }) {
  const [supabase] = useState(() => createClient())
  const [step, setStep] = useState<Step>('search')

  const [showAddForm, setShowAddForm] = useState(!!initialNewPatientName)
  const [newPatientNamePrefill] = useState(initialNewPatientName ?? '')

  const [patient, setPatient] = useState<PatientRecord | null>(null)
  const [patientLoadError, setPatientLoadError] = useState<string | null>(null)
  const [loadingPatient, setLoadingPatient] = useState(false)

  const [appointments, setAppointments] = useState<EligibleAppointment[] | null>(null)
  const [checkInMode, setCheckInMode] = useState<'appointment' | 'walkin'>('walkin')
  const [selectedAppointmentId, setSelectedAppointmentId] = useState<string | null>(null)
  const [walkinServiceId, setWalkinServiceId] = useState<string | null>(null)

  const [createState, createAction, creating] = useActionState<CreatePatientState, FormData>(
    createWalkinPatient,
    {}
  )
  const [apptCheckInState, apptCheckInAction, apptCheckingIn] = useActionState<CheckInState, FormData>(
    checkInAppointment,
    {}
  )
  const [walkinCheckInState, walkinCheckInAction, walkinCheckingIn] = useActionState<CheckInState, FormData>(
    checkInPatient,
    {}
  )

  /**
   * The one place a patient id turns into a patient on screen. Whether it
   * came from a search result, a newly created walk-in, or a URL param
   * handed off from elsewhere, it is re-read here through the same
   * RLS-scoped query every time — a name or id arriving from outside this
   * function is never displayed or submitted on its own say-so.
   */
  async function loadPatient(id: string) {
    setLoadingPatient(true)
    setPatientLoadError(null)
    setPatient(null)
    setAppointments(null)
    setSelectedAppointmentId(null)
    setWalkinServiceId(null)

    const [{ data: profile, error: profileError }, { data: appts, error: apptError }] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, full_name, phone, date_of_birth, id_number')
        .eq('id', id)
        .maybeSingle(),
      supabase
        .from('appointments')
        .select('id, scheduled_time, service:services(id, name)')
        .eq('patient_id', id)
        .eq('scheduled_date', todayInClinicTimezone())
        .eq('status', 'booked')
        .order('scheduled_time'),
    ])

    setLoadingPatient(false)

    if (profileError || !profile) {
      setPatientLoadError('Couldn’t verify this patient. Search again.')
      return
    }

    setPatient(profile)

    if (!apptError && appts) {
      const eligible: EligibleAppointment[] = appts
        .filter((a) => a.service !== null)
        .map((a) => ({
          id: a.id,
          scheduled_time: a.scheduled_time,
          service_id: a.service!.id,
          service_name: a.service!.name,
        }))
      setAppointments(eligible)
      if (eligible.length > 0) {
        setCheckInMode('appointment')
        setSelectedAppointmentId(eligible[0].id)
      } else {
        setCheckInMode('walkin')
      }
    } else {
      setAppointments([])
      setCheckInMode('walkin')
    }

    setStep('confirm')
  }

  function handlePatientSelected(result: PatientSearchResult) {
    void loadPatient(result.id)
  }

  // Only ever runs once, for the id this instance mounted with.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (initialPatientId) void loadPatient(initialPatientId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  /* eslint-enable react-hooks/set-state-in-effect */

  /**
   * A patient `createWalkinPatient` just created is NOT re-read through
   * `loadPatient`'s profiles query: `profiles_staff_read_clinic_patients`
   * only grants read access once a patient has an appointment or queue
   * entry (or shares the staff member's clinic_id) — a profile that is
   * seconds old has none of those yet, so that select would legitimately
   * return nothing. The create RPC's own return value, run server-side
   * under this receptionist's authenticated+role-checked session, IS the
   * authorized read here; a genuinely new patient cannot have an existing
   * appointment, so the walk-in path is the only option.
   */
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (createState.patient) {
      setShowAddForm(false)
      setPatientLoadError(null)
      setPatient({
        id: createState.patient.id,
        full_name: createState.patient.full_name,
        phone: createState.patient.phone,
        date_of_birth: null,
        id_number: null,
      })
      setAppointments([])
      setCheckInMode('walkin')
      setStep('confirm')
    }
  }, [createState.patient])
  /* eslint-enable react-hooks/set-state-in-effect */

  function handleChangePatient() {
    setPatient(null)
    setAppointments(null)
    setSelectedAppointmentId(null)
    setWalkinServiceId(null)
    setStep('search')
  }

  const selectedAppointment = appointments?.find((a) => a.id === selectedAppointmentId) ?? null
  const walkinService = services.find((s) => s.id === walkinServiceId) ?? null
  const canConfirm = checkInMode === 'appointment' ? !!selectedAppointment : !!walkinServiceId

  const token = apptCheckInState.token ?? walkinCheckInState.token
  const submitError = checkInMode === 'appointment' ? apptCheckInState.error : walkinCheckInState.error
  const submitting = apptCheckingIn || walkinCheckingIn
  const queuedServiceName = checkInMode === 'appointment' ? selectedAppointment?.service_name : walkinService?.name

  if (token) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-lg border border-border bg-surface p-8 text-center">
        <p className="text-sm font-semibold text-success">Patient checked in successfully!</p>
        {patient && queuedServiceName && (
          <p className="text-sm text-muted">
            <span className="font-semibold text-ink">{patient.full_name}</span> has been added to the{' '}
            {queuedServiceName} queue.
          </p>
        )}
        <div className="flex flex-col items-center gap-1 rounded-lg bg-primary-50 px-6 py-4">
          <p className="text-xs font-semibold tracking-wide text-muted">QUEUE TOKEN</p>
          <QueueToken token={token} size="lg" />
        </div>
        <div className="flex gap-2">
          <Button variant="primary" onClick={onReset}>
            Check in another patient
          </Button>
          <LinkButton href="/reception/queue" variant="secondary">
            View queue
          </LinkButton>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <ol className="flex items-center gap-2 text-xs font-semibold text-muted">
        {STEPS.map((s, i) => (
          <li key={s.key} className="flex items-center gap-2">
            {i > 0 && <span aria-hidden>&mdash;</span>}
            <span className={step === s.key ? 'text-primary-700' : ''}>{s.label}</span>
          </li>
        ))}
      </ol>

      {step === 'search' && (
        <section className="flex flex-col gap-3">
          <PatientSearchBox onSelect={handlePatientSelected} onAddNew={() => setShowAddForm(true)} />
          {loadingPatient && <p className="text-sm text-muted">Loading patient…</p>}
          {patientLoadError && (
            <p role="alert" className="text-sm text-danger">
              {patientLoadError}
            </p>
          )}

          {showAddForm && (
            <form
              action={createAction}
              className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
            >
              <Input label="Full name" name="full_name" defaultValue={newPatientNamePrefill} required />
              <Input label="Phone (optional)" name="phone" type="tel" />
              {createState.error && (
                <p role="alert" className="text-sm text-danger">
                  {createState.error}
                </p>
              )}
              <div className="flex gap-2">
                <Button type="button" variant="tertiary" fullWidth onClick={() => setShowAddForm(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" fullWidth loading={creating}>
                  Add patient
                </Button>
              </div>
            </form>
          )}
        </section>
      )}

      {step === 'confirm' && patient && (
        <section className="flex flex-col gap-4">
          <PatientSummaryCard patient={patient} onChange={handleChangePatient} />

          <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
            <p className="text-sm font-semibold text-muted">Visit details</p>

            {appointments && appointments.length > 0 ? (
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 text-sm text-ink">
                  <input
                    type="radio"
                    checked={checkInMode === 'appointment'}
                    onChange={() => setCheckInMode('appointment')}
                  />
                  Yes, has an appointment
                </label>
                {checkInMode === 'appointment' && (
                  <div className="flex flex-col gap-2 pl-6">
                    {appointments.map((appt) => (
                      <label
                        key={appt.id}
                        className={`flex items-center justify-between rounded-md border px-3 py-2 text-sm ${
                          selectedAppointmentId === appt.id
                            ? 'border-primary-700 bg-primary-50'
                            : 'border-border'
                        }`}
                      >
                        <span className="flex items-center gap-2 text-ink">
                          <input
                            type="radio"
                            checked={selectedAppointmentId === appt.id}
                            onChange={() => setSelectedAppointmentId(appt.id)}
                          />
                          {appt.service_name}
                        </span>
                        <span className="font-mono text-xs tabular-nums text-muted">
                          {formatClinicTime(appt.scheduled_time)}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
                <label className="flex items-center gap-2 text-sm text-ink">
                  <input
                    type="radio"
                    checked={checkInMode === 'walkin'}
                    onChange={() => setCheckInMode('walkin')}
                  />
                  No, walk-in patient
                </label>
              </div>
            ) : (
              <p className="text-xs text-muted">No booked appointment today — checking in as a walk-in.</p>
            )}

            {checkInMode === 'walkin' && (
              <div className="flex flex-col gap-2">
                <p className="text-xs font-semibold tracking-wide text-muted">SERVICE</p>
                <ServicePicker services={services} selectedId={walkinServiceId} onSelect={setWalkinServiceId} />
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <Button type="button" variant="tertiary" fullWidth onClick={handleChangePatient}>
              Back
            </Button>
            <Button type="button" variant="primary" fullWidth disabled={!canConfirm} onClick={() => setStep('queue')}>
              Continue
            </Button>
          </div>
        </section>
      )}

      {step === 'queue' && patient && canConfirm && (
        <section className="flex flex-col gap-4">
          <PatientSummaryCard patient={patient} onChange={handleChangePatient} />

          <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
            <p className="text-sm font-semibold text-muted">Queue entry</p>
            <p className="text-sm text-ink">
              Service: <span className="font-semibold">{queuedServiceName}</span>
            </p>
            {checkInMode === 'appointment' && selectedAppointment && (
              <p className="text-sm text-ink">
                Appointment: <span className="font-semibold">{formatClinicTime(selectedAppointment.scheduled_time)}</span>
              </p>
            )}
            <p className="text-xs text-muted">
              This will add the patient to the live queue. The patient will be able to see their queue token and
              estimated wait.
            </p>
          </div>

          {submitError && (
            <p role="alert" className="text-sm font-semibold text-danger">
              {submitError}
            </p>
          )}

          <div className="flex gap-2">
            <Button type="button" variant="tertiary" fullWidth onClick={() => setStep('confirm')} disabled={submitting}>
              Back
            </Button>
            {checkInMode === 'appointment' && selectedAppointment ? (
              <form action={apptCheckInAction} className="w-full">
                <input type="hidden" name="appointment_id" value={selectedAppointment.id} />
                <Button type="submit" variant="primary" fullWidth loading={submitting}>
                  Confirm check-in
                </Button>
              </form>
            ) : (
              <form action={walkinCheckInAction} className="w-full">
                <input type="hidden" name="service_id" value={walkinServiceId ?? ''} />
                <input type="hidden" name="patient_id" value={patient.id} />
                <Button type="submit" variant="primary" fullWidth loading={submitting}>
                  Confirm check-in
                </Button>
              </form>
            )}
          </div>
        </section>
      )}
    </div>
  )
}

function PatientSummaryCard({ patient, onChange }: { patient: PatientRecord; onChange: () => void }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-muted">Patient details</p>
        <button type="button" onClick={onChange} className="text-xs font-semibold text-primary-700 underline">
          Change
        </button>
      </div>
      <div className="flex items-center gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary-100 text-sm font-semibold text-primary-700">
          {initials(patient.full_name)}
        </span>
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-ink">{patient.full_name}</span>
          {patient.phone && <span className="text-xs text-muted">{patient.phone}</span>}
        </div>
      </div>
      {(patient.date_of_birth || patient.id_number) && (
        <dl className="grid grid-cols-2 gap-2 text-xs">
          {patient.date_of_birth && (
            <div>
              <dt className="text-muted">Date of birth</dt>
              <dd className="font-semibold text-ink">{patient.date_of_birth}</dd>
            </div>
          )}
          {patient.id_number && (
            <div>
              <dt className="text-muted">ID number</dt>
              <dd className="font-semibold text-ink">{patient.id_number}</dd>
            </div>
          )}
        </dl>
      )}
    </div>
  )
}
