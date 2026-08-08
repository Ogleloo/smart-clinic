'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { StatusChip } from '@/components/ui/StatusChip'

interface Result {
  id: string
  full_name: string
  phone: string | null
  role: string
  auth_user_id: string | null
}

const DEBOUNCE_MS = 300
const MIN_QUERY_LENGTH = 2

export function PatientSearch() {
  const [supabase] = useState(() => createClient())
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Result[] | null>(null)
  const [searching, setSearching] = useState(false)

  const trimmed = query.trim()

  useEffect(() => {
    if (trimmed.length < MIN_QUERY_LENGTH) return
    const timer = setTimeout(async () => {
      // Strip characters that have meaning in a PostgREST filter string
      // (comma separates conditions, % is the ilike wildcard) so the
      // query can't reshape the filter it's being interpolated into.
      const safe = trimmed.replace(/[,%]/g, '')
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, phone, role, auth_user_id')
        .or(`full_name.ilike.%${safe}%,phone.ilike.%${safe}%`)
        .order('full_name')
        .limit(20)
      if (!error) setResults(data)
      setSearching(false)
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [supabase, trimmed])

  function handleChange(value: string) {
    setQuery(value)
    setSearching(value.trim().length >= MIN_QUERY_LENGTH)
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <label htmlFor="patient-search" className="text-sm font-semibold text-ink">
        Search patients
      </label>
      <input
        id="patient-search"
        type="text"
        placeholder="Name or phone…"
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        className="min-h-11 rounded-lg border border-border bg-surface px-3 text-[15px] text-ink"
      />
      {trimmed.length >= MIN_QUERY_LENGTH && (
        <div className="flex flex-col gap-1">
          {searching ? (
            <p className="text-sm text-muted">Searching…</p>
          ) : results && results.length > 0 ? (
            results.map((r) => (
              <div key={r.id} className="flex items-center justify-between rounded-md border border-border p-2">
                <div>
                  <p className="text-sm font-semibold text-ink">{r.full_name}</p>
                  <p className="text-xs text-muted">{r.phone ?? 'No phone'}</p>
                </div>
                <StatusChip status={r.auth_user_id ? 'booked' : 'cancelled'} label={r.auth_user_id ? 'Has login' : 'No login'} />
              </div>
            ))
          ) : (
            <p className="text-sm text-muted">No matches.</p>
          )}
        </div>
      )}
    </section>
  )
}
