'use client'

import { useId, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Input, type InputProps } from './Input'

/**
 * Design System: Input with a show/hide control for passwords.
 *
 * Only the field's `type` changes — the same <input> element stays mounted, so
 * the typed value, autocomplete hints (`autoComplete` passes straight through),
 * form submission and password-manager behaviour are untouched. The button is a
 * real <button type="button">: reachable by Tab, operated by Enter/Space, never
 * submits the form, and its accessible name says what pressing it will do.
 *
 * Edge adds its own reveal icon to password fields; it is hidden so there is one
 * control, not two.
 */
export function PasswordInput({ id, className = '', ...props }: Omit<InputProps, 'type' | 'trailing'>) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const [visible, setVisible] = useState(false)

  return (
    <Input
      {...props}
      id={inputId}
      type={visible ? 'text' : 'password'}
      className={`[&::-ms-reveal]:hidden [&::-ms-clear]:hidden ${className}`}
      trailing={
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-controls={inputId}
          className="inline-flex h-11 w-11 items-center justify-center rounded-md text-muted hover:text-ink"
        >
          {visible ? <EyeOff aria-hidden size={18} /> : <Eye aria-hidden size={18} />}
        </button>
      }
    />
  )
}
