'use client'

import { useActionState, useEffect, useRef } from 'react'
import { createService, type ServiceFormState } from '@/app/actions/admin'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'

export function NewServiceForm() {
  const formRef = useRef<HTMLFormElement>(null)
  const [state, formAction, pending] = useActionState<ServiceFormState, FormData>(createService, {})

  useEffect(() => {
    // Depends on the whole `state` object, not state.success — see
    // ServiceRow for why keying on the boolean would miss every add
    // after the first.
    if (state.success) formRef.current?.reset()
  }, [state])

  return (
    <form
      ref={formRef}
      action={formAction}
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
    >
      <p className="text-xs font-semibold tracking-wide text-muted">ADD SERVICE</p>
      <Input label="Name" name="name" required />
      <Input label="Token prefix" name="token_prefix" required />
      <Input label="Default consultation minutes" name="default_consultation_minutes" type="number" min={1} required />
      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
      <Button type="submit" variant="primary" loading={pending}>
        Add service
      </Button>
    </form>
  )
}
