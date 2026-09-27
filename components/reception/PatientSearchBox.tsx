'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { EmptyState } from '@/components/ui/EmptyState'

export interface PatientSearchResult {
  id: string
  full_name: string
  phone: string
  has_account: boolean
}

const SEARCH_DEBOUNCE_MS = 300
const MIN_QUERY_LENGTH = 2

/**
 * Patient search — the receptionist's most common action, and previously
 * only reachable inside the walk-in wizard. Extracted so it can also sit
 * directly on /reception, without the wizard's service/check-in state.
 *
 * `searching` is flipped on synchronously in handleQueryChange, not
 * inside the debounce timeout — 300ms later would leave a window, on
 * every qualifying keystroke, where searching is still false and results
 * still holds the previous query's answer, which reads as a false
 * "No matching patient" before the new search has even run.
 */
export function PatientSearchBox({
  onSelect,
  onAddNew,
}: {
  onSelect: (patient: PatientSearchResult) => void
  onAddNew: (query: string) => void
}) {
  const [supabase] = useState(() => createClient())
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PatientSearchResult[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)

  const trimmedQuery = query.trim()

  useEffect(() => {
    if (trimmedQuery.length < MIN_QUERY_LENGTH) return
    const timer = setTimeout(async () => {
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

  function handleQueryChange(value: string) {
    setQuery(value)
    setSearching(value.trim().length >= MIN_QUERY_LENGTH)
  }

  return (
    <div className="flex flex-col gap-3">
      <Input
        label="Search by name or phone"
        placeholder="Type at least 2 characters…"
        value={query}
        onChange={(e) => handleQueryChange(e.target.value)}
      />

      {trimmedQuery.length < MIN_QUERY_LENGTH ? null : searching ? (
        <p className="text-sm text-muted">Searching…</p>
      ) : searchError ? (
        <p className="text-sm text-danger">Couldn&rsquo;t search patients. Try again.</p>
      ) : results && results.length > 0 ? (
        <>
          <ul className="flex flex-col gap-2">
            {results.map((result) => (
              <li key={result.id}>
                <button
                  type="button"
                  onClick={() => onSelect(result)}
                  className="flex w-full items-center justify-between rounded-lg border border-border bg-surface px-4 py-3 text-left hover:bg-subtle"
                >
                  <span>
                    <span className="block text-sm font-semibold text-ink">{result.full_name}</span>
                    <span className="block text-xs text-muted">{result.phone}</span>
                  </span>
                  <span className="text-xs text-muted">
                    {result.has_account ? 'Registered account' : 'No account'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => onAddNew(trimmedQuery)}
            className="self-start text-sm font-semibold text-primary-700 underline"
          >
            None of these — add new patient
          </button>
        </>
      ) : (
        // A receptionist can only see patients who already have an
        // appointment or queue entry at this clinic (ADR-021) — a
        // genuinely new walk-in is correctly absent here, not an error,
        // so this offers "add", not "not found".
        <EmptyState
          headline="No matching patient"
          body="They may be new to the clinic."
          action={
            <Button variant="secondary" onClick={() => onAddNew(trimmedQuery)}>
              Add new patient
            </Button>
          }
          fullWidth
        />
      )}
    </div>
  )
}
