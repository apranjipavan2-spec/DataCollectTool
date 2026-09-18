
interface PaginationProps {
  /** Current page number (1-indexed) */
  page: number
  pageSize: number
  total: number
  onChange: (page: number) => void
  className?: string
}

export default function Pagination({
  page,
  pageSize,
  total,
  onChange,
  className = '',
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  if (totalPages <= 1 && total > 0) return null

  const start = total === 0 ? 0 : (page - 1) * pageSize + 1
  const end   = Math.min(page * pageSize, total)

  // Build page button list: first, last, current ±1, ellipsis
  const pages: (number | '...')[] = []
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i)
  } else {
    pages.push(1)
    if (page > 3) pages.push('...')
    const lo = Math.max(2, page - 1)
    const hi = Math.min(totalPages - 1, page + 1)
    for (let i = lo; i <= hi; i++) pages.push(i)
    if (page < totalPages - 2) pages.push('...')
    pages.push(totalPages)
  }

  const btnBase =
    'min-w-[28px] h-7 px-1 rounded text-xs transition-colors disabled:opacity-30 disabled:cursor-not-allowed'
  const btnInactive =
    'text-catalan-textMuted hover:text-catalan-text hover:bg-catalan-hover'
  const btnActive =
    'bg-catalan-primary text-catalan-bg font-semibold'

  return (
    <div className={`flex items-center justify-between mt-3 ${className}`}>
      {/* Range label */}
      <span className="text-xs text-catalan-textMuted">
        {total === 0 ? 'No results' : `${start}–${end} of ${total}`}
      </span>

      {/* Buttons */}
      <div className="flex items-center gap-0.5">
        <button
          onClick={() => onChange(page - 1)}
          disabled={page <= 1}
          className={`${btnBase} ${btnInactive}`}
          aria-label="Previous page"
        >
          ←
        </button>

        {pages.map((p, i) =>
          p === '...' ? (
            <span key={`ell-${i}`} className="px-1 text-xs text-catalan-textMuted select-none">
              …
            </span>
          ) : (
            <button
              key={p}
              onClick={() => onChange(p as number)}
              className={`${btnBase} ${p === page ? btnActive : btnInactive}`}
              aria-current={p === page ? 'page' : undefined}
            >
              {p}
            </button>
          )
        )}

        <button
          onClick={() => onChange(page + 1)}
          disabled={page >= totalPages}
          className={`${btnBase} ${btnInactive}`}
          aria-label="Next page"
        >
          →
        </button>
      </div>
    </div>
  )
}
