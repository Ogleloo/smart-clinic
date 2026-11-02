'use client'

import { type InputHTMLAttributes, type ReactNode, useId } from 'react'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  error?: string
  helper?: string
  /** Decorative icon shown inside the field's left edge (Patient V3 auth screens). */
  leading?: ReactNode
  /** Control shown inside the field's right edge (e.g. PasswordInput's show/hide button). */
  trailing?: ReactNode
  /**
   * 'auth' is the Patient V3 authentication treatment (Figma 33:49): a 16px ink label above a 52px field with a
   * 12px radius and 16px text. Every other screen keeps 'default'; the two differ only in size and weight, not in
   * behaviour, so this stays one Input rather than a second one.
   */
  variant?: 'default' | 'auth'
}

const LABEL = {
  default: 'text-[13px] font-semibold text-muted',
  auth: 'text-base leading-6 text-ink',
} as const

const FIELD = {
  default: 'min-h-11 rounded-lg px-3 text-[15px] placeholder:text-muted/60',
  auth: 'min-h-[52px] rounded-[12px] px-4 text-base placeholder:text-muted',
} as const

/**
 * Design System: Input.
 * The label is always present (never placeholder-only) and the error is
 * programmatically associated with the field — both accessibility
 * requirements from §12.
 */
export function Input({
  label,
  error,
  helper,
  leading,
  trailing,
  variant = 'default',
  id,
  className = '',
  ...props
}: InputProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const describedBy = error ? `${inputId}-error` : helper ? `${inputId}-helper` : undefined

  const field = (extraClass: string) => (
    <input
      {...props}
      id={inputId}
      aria-invalid={!!error}
      aria-describedby={describedBy}
      className={`border bg-surface text-ink disabled:bg-subtle disabled:text-muted
        ${FIELD[variant]}
        ${error ? 'border-[1.5px] border-danger' : 'border-border'} ${extraClass}`}
    />
  )

  // The icon sits 16px in and is 20px wide, so the text starts 48px from the edge (Figma 33:74).
  const padded = `${leading ? 'pl-12 ' : ''}${trailing ? 'pr-12 ' : ''}`

  return (
    <div className="flex w-full flex-col gap-1.5">
      <label htmlFor={inputId} className={LABEL[variant]}>
        {label}
      </label>
      {leading || trailing ? (
        <div className="relative">
          {field(`w-full ${padded}${className}`)}
          {leading && (
            <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-muted">
              {leading}
            </div>
          )}
          {trailing && <div className="absolute inset-y-0 right-0 flex items-center pr-1">{trailing}</div>}
        </div>
      ) : (
        field(className)
      )}
      {error && (
        <p id={`${inputId}-error`} className="text-xs text-danger">
          {error}
        </p>
      )}
      {!error && helper && (
        <p id={`${inputId}-helper`} className="text-xs text-muted">
          {helper}
        </p>
      )}
    </div>
  )
}
