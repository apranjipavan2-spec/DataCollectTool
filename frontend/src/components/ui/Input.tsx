import React from 'react'

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  hint?: string
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, className = '', ...props }, ref) => {
    return (
      <div className="w-full">
        {label && (
          <label className="label">{label}</label>
        )}
        <input
          ref={ref}
          className={`
            input-field
            ${error ? 'border-catalan-error ring-catalan-error' : ''}
            ${className}
          `}
          {...props}
        />
        {error && (
          <p className="text-xs text-catalan-error mt-1">{error}</p>
        )}
        {hint && !error && (
          <p className="text-xs text-catalan-textMuted mt-1">{hint}</p>
        )}
      </div>
    )
  }
)

Input.displayName = 'Input'

export default Input
