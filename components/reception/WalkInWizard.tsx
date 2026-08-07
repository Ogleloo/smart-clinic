'use client'

import { useActionState, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  createWalkinPatient,
  checkInPatient,
  type CreatePatientState,
  type CheckInState,
} from '@/app/actions/reception'
import { ServicePicker, type Service } from '@/components/booking/ServicePicker'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { QueueToken } from '@/components/ui/QueueToken'
import { EmptyState } from '@/components/ui/EmptyState'

interface SearchResult {
  id: string
  full_name: string
  phone: string
  has_account: boolean
}

interface SelectedPatient {
  id: string
  full_name: string
}

const SEARCH_DEBOUNCE_MS = 300
const MIN_QUERY_LENGTH = 2

export function WalkInWizard({ services }: { services: Service[] }) {
  const [supabase] = useState(() => createClient())
  const [serviceId, setServiceId] = useState<string | null>(null)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [selectedPatient, setSelectedPatient] = useState<SelectedPatient | null>(null)

  const [createState, createAction, creating] = useActionState<CreatePatientState, FormData>(
    createWalkinPatient,
    {}
  )
  const [checkInState, checkInAction, checkingIn] = useActionState<CheckInState, FormData>(
    checkInPatient,
    {}
  )

  const trimmedQuery = query.trim()

  // Debounced search — the trailing setState calls all happen inside the
  // timeout callback, not synchronously in the effect body.
  useEffect(() => {
    if (trimmedQuery.length < MIN_QUERY_LENGTH) return
    const timer = setTimeout(async () => {
      setSearching(true)
      setSearchError(null)
      const { data, error } = await supabase.rpc('search_patients', { p_query: trimmedQuery })
      if (error) {
        setSearchError(error.message)
        setResults(null)
      } else {
        setResults(data)
      }
      setSearching(false)
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [supabase, trimmedQuery])

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

  function reset() {
    setServiceId(null)
    setQuery('')
    setResults(null)
    setShowAddForm(false)
    setSelectedPatient(null)
  }

  if (checkInState.token) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-lg border border-border bg-surface p-8 text-center">
        <p className="text-sm font-semibold text-muted">Checked in</p>
        <QueueToken token={checkInState.token} size="lg" />
        <p className="text-sm text-ink">Tell the patient their number.</p>
        <Button variant="primary" onClick={reset}>
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
              <Input
                label="Search by name or phone"
                placeholder="Type at least 2 characters…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />

              {trimmedQuery.length < MIN_QUERY_LENGTH ? null : searching ? (
                <p className="text-sm text-muted">Searching…</p>
              ) : searchError ? (
                <p className="text-sm text-danger">Couldn&rsquo;t search patients. Try again.</p>
              ) : results && results.length > 0 ? (
                <ul className="flex flex-col gap-2">
                  {results.map((result) => (
                    <li key={result.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedPatient(result)}
                        className="flex w-full items-center justify-between rounded-lg border border-border bg-surface px-4 py-3 text-left hover:bg-subtle"
                      >
                        <span>
                          <span className="block text-sm font-semibold text-ink">
                            {result.full_name}
                          </span>
                          <span className="block text-xs text-muted">{result.phone}</span>
                        </span>
                        <span className="text-xs text-muted">
                          {result.has_account ? 'Registered account' : 'No account'}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                // A receptionist can only see patients who already have an
                // appointment or queue entry at this clinic (ADR-021) — a
                // genuinely new walk-in is correctly absent here, not an
                // error, so this offers "add", not "not found".
                <EmptyState
                  headline="No matching patient"
                  body="They may be new to the clinic."
                  action={
                    <Button variant="secondary" onClick={() => setShowAddForm(true)}>
                      Add new patient
                    </Button>
                  }
                  fullWidth
                />
              )}

              {!showAddForm && trimmedQuery.length >= MIN_QUERY_LENGTH && results && results.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowAddForm(true)}
                  className="self-start text-sm font-semibold text-primary-700 underline"
                >
                  None of these — add new patient
                </button>
              )}

              {showAddForm && (
                <form
                  action={createAction}
                  className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
                >
                  <Input label="Full name" name="full_name" required />
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
