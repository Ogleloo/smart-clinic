'use client'

import { useActionState, useEffect, useState } from 'react'
import {
  createWalkinPatient,
  checkInPatient,
  type CreatePatientState,
  type CheckInState,
} from '@/app/actions/reception'
import { ServicePicker, type Service } from '@/components/booking/ServicePicker'
import { PatientSearchBox, type PatientSearchResult } from '@/components/reception/PatientSearchBox'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { QueueToken } from '@/components/ui/QueueToken'

interface SelectedPatient {
  id: string
  full_name: string
}

interface WalkInWizardProps {
  services: Service[]
  /** Handed off from a search on /reception itself — skips re-searching here. */
  initialSelectedPatient?: SelectedPatient
  /** Handed off when that search came back empty and reception chose "Add new patient". */
  initialNewPatientName?: string
}

export function WalkInWizard({ services, initialSelectedPatient, initialNewPatientName }: WalkInWizardProps) {
  // Keying on a counter forces a full remount on reset, which is the only
  // way to clear useActionState's internal state (createState.patient,
  // checkInState.token) — there's no imperative reset for that hook, and
  // without this the "Checked in" screen never goes away after the first
  // walk-in of the day.
  const [instanceKey, setInstanceKey] = useState(0)
  return (
    <WalkInWizardInner
      key={instanceKey}
      services={services}
      initialSelectedPatient={instanceKey === 0 ? initialSelectedPatient : undefined}
      initialNewPatientName={instanceKey === 0 ? initialNewPatientName : undefined}
      onReset={() => setInstanceKey((k) => k + 1)}
    />
  )
}

function WalkInWizardInner({
  services,
  initialSelectedPatient,
  initialNewPatientName,
  onReset,
}: WalkInWizardProps & { onReset: () => void }) {
  const [serviceId, setServiceId] = useState<string | null>(null)

  const [showAddForm, setShowAddForm] = useState(!!initialNewPatientName)
  const [newPatientNamePrefill] = useState(initialNewPatientName ?? '')
  const [selectedPatient, setSelectedPatient] = useState<SelectedPatient | null>(
    initialSelectedPatient ?? null
  )

  const [createState, createAction, creating] = useActionState<CreatePatientState, FormData>(
    createWalkinPatient,
    {}
  )
  const [checkInState, checkInAction, checkingIn] = useActionState<CheckInState, FormData>(
    checkInPatient,
    {}
  )

  function handlePatientSelected(patient: PatientSearchResult) {
    setSelectedPatient(patient)
  }

  function handleAddNew() {
    setShowAddForm(true)
  }

  // A new walk-in patient was just created — select them and move on.
  // Reacting to the server action's result, not a user event, so an
  // effect is the correct place for this.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (createState.patient) {
      setSelectedPatient(createState.patient)
      setShowAddForm(false)
    }
  }, [createState.patient])
  /* eslint-enable react-hooks/set-state-in-effect */

  if (checkInState.token) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-lg border border-border bg-surface p-8 text-center">
        <p className="text-sm font-semibold text-muted">Checked in</p>
        <QueueToken token={checkInState.token} size="lg" />
        <p className="text-sm text-ink">Tell the patient their number.</p>
        <Button variant="primary" onClick={onReset}>
          Register another walk-in
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2">
        <p className="text-xs font-semibold tracking-wide text-muted">1. SERVICE</p>
        <ServicePicker services={services} selectedId={serviceId} onSelect={setServiceId} />
      </section>

      {serviceId && (
        <section className="flex flex-col gap-3">
          <p className="text-xs font-semibold tracking-wide text-muted">2. PATIENT</p>

          {selectedPatient ? (
            <div className="flex items-center justify-between rounded-lg border border-primary-700 bg-primary-50 px-4 py-3">
              <span className="text-sm font-semibold text-primary-700">
                {selectedPatient.full_name}
              </span>
              <button
                type="button"
                onClick={() => setSelectedPatient(null)}
                className="text-xs font-semibold text-primary-700 underline"
              >
                Change
              </button>
            </div>
          ) : (
            <>
              <PatientSearchBox onSelect={handlePatientSelected} onAddNew={handleAddNew} />

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
                    <Button
                      type="button"
                      variant="tertiary"
                      fullWidth
                      onClick={() => setShowAddForm(false)}
                    >
                      Cancel
                    </Button>
                    <Button type="submit" variant="primary" fullWidth loading={creating}>
                      Add patient
                    </Button>
                  </div>
                </form>
              )}
            </>
          )}
        </section>
      )}

      {serviceId && selectedPatient && (
        <form action={checkInAction} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
          <input type="hidden" name="service_id" value={serviceId} />
          <input type="hidden" name="patient_id" value={selectedPatient.id} />
          <p className="text-sm text-muted">
            Checking in <span className="font-semibold text-ink">{selectedPatient.full_name}</span>
          </p>
          {checkInState.error && (
            <p role="alert" className="text-sm font-semibold text-danger">
              {checkInState.error}
            </p>
          )}
          <Button type="submit" variant="primary" fullWidth loading={checkingIn}>
            Check in
          </Button>
        </form>
      )}
    </div>
  )
}
