'use client'

import { useCallback, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { MergePairCard } from './MergePairCard'
import { EmptyState } from '@/components/ui/EmptyState'
import type { Database } from '@/lib/types/database.types'

type DuplicatePair = Database['public']['Functions']['find_duplicate_patients']['Returns'][number]

export function DuplicatePatients({ initialPairs }: { initialPairs: DuplicatePair[] }) {
  const [supabase] = useState(() => createClient())
  const [pairs, setPairs] = useState<DuplicatePair[]>(initialPairs)

  const refresh = useCallback(async () => {
    const { data, error } = await supabase.rpc('find_duplicate_patients')
    if (!error && data) setPairs(data)
  }, [supabase])

  if (pairs.length === 0) {
    return (
      <EmptyState
        headline="No likely duplicates found"
        body="Matches on same phone, or same name where at most one profile has a login."
        fullWidth
      />
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {pairs.map((pair) => (
        <MergePairCard key={`${pair.profile_a}-${pair.profile_b}`} pair={pair} onMerged={refresh} />
      ))}
    </div>
  )
}
