'use client'

import { useActionState, useEffect, useState } from 'react'
import { mergePatientProfiles, type MergeState } from '@/app/actions/admin'
import { Button } from '@/components/ui/Button'

interface DuplicatePair {
  profile_a: string
  name_a: string
  phone_a: string | null
  has_login_a: boolean
  history_a: number
  profile_b: string
  name_b: string
  phone_b: string | null
  has_login_b: boolean
  history_b: number
  match_reason: string
}

function ProfileSummary({
  name,
  phone,
  hasLogin,
  history,
}: {
  name: string
  phone: string | null
  hasLogin: boolean
  history: number
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-3">
      <p className="text-sm font-semibold text-ink">{name}</p>
      <p className="text-xs text-muted">{phone ?? 'No phone on file'}</p>
      <p className="text-xs text-muted">{hasLogin ? 'Has a login' : 'No login (walk-in only)'}</p>
      <p className="text-xs text-muted">{history} queue/appointment record{history === 1 ? '' : 's'}</p>
    </div>
  )
}

/** Admin only chooses "keep A" or "keep B" — find_duplicate_patients() already excludes pairs where both sides have a login, so every pair shown here is safe to merge (merge_patient_profiles' own guard is the hard backstop, not this UI). */
export function MergePairCard({ pair, onMerged }: { pair: DuplicatePair; onMerged: () => void }) {
  const [choice, setChoice] = useState<'a' | 'b' | null>(null)
  const [state, formAction, pending] = useActionState<MergeState, FormData>(mergePatientProfiles, {})

  useEffect(() => {
    // Depends on the whole `state` object — see ServiceRow for why
    // keying on a field that can repeat (here, `result` would differ
    // per merge, but staying consistent with the rest of the app).
    if (state.result) onMerged()
  }, [state, onMerged])

  if (state.result) {
    return (
      <div className="rounded-lg border border-success bg-success-bg p-4 text-sm text-success">
        Merged: {state.result.queueEntriesMoved} queue entr{state.result.queueEntriesMoved === 1 ? 'y' : 'ies'},{' '}
        {state.result.appointmentsMoved} appointment{state.result.appointmentsMoved === 1 ? '' : 's'},{' '}
        {state.result.notificationsMoved} notification{state.result.notificationsMoved === 1 ? '' : 's'} moved.
      </div>
    )
  }

  const keepName = choice === 'a' ? pair.name_a : pair.name_b
  const mergeName = choice === 'a' ? pair.name_b : pair.name_a
  const keepId = choice === 'a' ? pair.profile_a : pair.profile_b
  const mergeId = choice === 'a' ? pair.profile_b : pair.profile_a

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <p className="text-xs font-semibold tracking-wide text-muted">
        LIKELY DUPLICATE — {pair.match_reason}
      </p>
      <div className="grid grid-cols-2 gap-3">
        <ProfileSummary name={pair.name_a} phone={pair.phone_a} hasLogin={pair.has_login_a} history={pair.history_a} />
        <ProfileSummary name={pair.name_b} phone={pair.phone_b} hasLogin={pair.has_login_b} history={pair.history_b} />
      </div>

      {choice === null ? (
        <div className="grid grid-cols-2 gap-3">
          <Button variant="secondary" onClick={() => setChoice('a')}>
            Keep this one
          </Button>
          <Button variant="secondary" onClick={() => setChoice('b')}>
            Keep this one
          </Button>
        </div>
      ) : (
        <form action={formAction} className="flex flex-col gap-2 rounded-lg border border-danger bg-danger-bg p-3">
          <input type="hidden" name="keep_id" value={keepId} />
          <input type="hidden" name="merge_id" value={mergeId} />
          <p className="text-sm font-semibold text-ink">
            Merge &ldquo;{mergeName}&rdquo; into &ldquo;{keepName}&rdquo;? Their history moves across and
            &ldquo;{mergeName}&rdquo; is deleted. This cannot be undone.
          </p>
          {state.error && (
            <p role="alert" className="text-sm text-danger">
              {state.error}
            </p>
          )}
          <div className="flex gap-2">
            <Button type="button" variant="tertiary" fullWidth onClick={() => setChoice(null)}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" fullWidth loading={pending}>
              Confirm merge
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
