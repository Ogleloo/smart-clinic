'use client'

import { type InputHTMLAttributes, type ReactNode, useId } from 'react'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  error?: string
  helper?: string
  /** Control shown inside the field's right edge (e.g. PasswordInput's show/hide button). */
  trailing?: ReactNode
}

/**
 * Design System: Input.
 * The label is always present (never placeholder-only) and the error is
 * programmatically associated with the field — both accessibility
 * requirements from §12.
 */
export function Input({ label, error, helper, trailing, id, className = '', ...props }: InputProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const describedBy = error ? `${inputId}-error` : helper ? `${inputId}-helper` : undefined

  const field = (extraClass: string) => (
    <input
      {...props}
      id={inputId}
      aria-invalid={!!error}
      aria-describedby={describedBy}
      className={`min-h-11 rounded-lg border bg-surface px-3 text-[15px] text-ink
        placeholder:text-muted/60 disabled:bg-subtle disabled:text-muted
        ${error ? 'border-[1.5px] border-danger' : 'border-border'} ${extraClass}`}
    />
  )

  return (
    <div className="flex w-full flex-col gap-1.5">
      <label htmlFor={inputId} className="text-[13px] font-semibold text-muted">
        {label}
      </label>
      {trailing ? (
        <div className="relative">
          {field(`w-full pr-12 ${className}`)}
          <div className="absolute inset-y-0 right-0 flex items-center pr-1">{trailing}</div>
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
