import { forwardRef } from 'react'
import type { SelectHTMLAttributes } from 'react'

// Shared dropdown look — catalan design tokens, custom chevron (native <select>
// chrome renders inconsistently across the app otherwise), truncates a long
// selected label instead of clipping it mid-character. Width is entirely
// caller-controlled via className (e.g. "w-full" or "w-auto min-w-[140px]"),
// same as a bare <select> — this is meant as a drop-in swap.
const BASE =
  'appearance-none truncate pr-8 pl-3 py-2 text-sm rounded-lg border ' +
  'border-catalan-border bg-catalan-bg text-catalan-text ' +
  'focus:outline-none focus:ring-2 focus:ring-catalan-primary disabled:opacity-50 disabled:cursor-not-allowed'

type Props = SelectHTMLAttributes<HTMLSelectElement> & {
  wrapperClassName?: string
}

const Select = forwardRef<HTMLSelectElement, Props>(function Select(
  { className = '', wrapperClassName = '', ...rest },
  ref,
) {
  return (
    <div className={`relative ${wrapperClassName}`.trim()}>
      <select ref={ref} className={`${BASE} ${className}`.trim()} {...rest} />
      <svg
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-catalan-textMuted"
        viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </div>
  )
})

export default Select
