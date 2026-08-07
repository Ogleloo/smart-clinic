'use client'

import { type InputHTMLAttributes, useId } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  error?: string
  helper?: string
}

/**
 * Design System: Input.
 * The label is always present (never placeholder-only) and the error is
 * programmatically associated with the field — both accessibility
 * requirements from §12.
 */
export function Input({ label, error, helper, id, className = '', ...props }: InputProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const describedBy = error ? `${inputId}-error` : helper ? `${inputId}-helper` : undefined

  return (
    <div className="flex w-full flex-col gap-1.5">
      <label htmlFor={inputId} className="text-[13px] font-semibold text-muted">
        {label}
      </label>
      <input
        {...props}
        id={inputId}
        aria-invalid={!!error}
        aria-describedby={describedBy}
        className={`min-h-11 rounded-lg border bg-surface px-3 text-[15px] text-ink
          placeholder:text-muted/60 disabled:bg-subtle disabled:text-muted
          ${error ? 'border-[1.5px] border-danger' : 'border-border'} ${className}`}
      />
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
