import React from 'react'

export interface Column<T> {
  key: keyof T | string
  label: string
  render?: (value: any, row: T) => React.ReactNode
  width?: string
  /** Enable click-to-sort on this column header */
  sortable?: boolean
}

export interface TableProps<T> {
  columns: Column<T>[]
  data: T[]
  keyExtractor: (row: T, index: number) => string | number
  loading?: boolean
  emptyMessage?: string
  emptyIcon?: string
  onRowClick?: (row: T) => void
  actions?: (row: T) => React.ReactNode
  className?: string

  // ── Sorting (controlled) ──────────────────────────────────────────────────
  /** Key of the currently sorted column */
  sortKey?: string | null
  /** Current sort direction */
  sortDir?: 'asc' | 'desc'
  /** Called when a sortable column header is clicked */
  onSort?: (key: string) => void
}

function SortIcon({ active, dir }: { active: boolean; dir: 'asc' | 'desc' }) {
  return (
    <span className={`ml-1 text-xs transition-colors ${active ? 'text-catalan-primary' : 'text-catalan-textMuted/40'}`}>
      {active ? (dir === 'asc' ? '↑' : '↓') : '↕'}
    </span>
  )
}

const Table = React.forwardRef<HTMLDivElement, TableProps<any>>(
  (
    {
      columns,
      data,
      keyExtractor,
      loading = false,
      emptyMessage = 'No data found',
      emptyIcon,
      onRowClick,
      actions,
      className = '',
      sortKey = null,
      sortDir = 'asc',
      onSort,
    },
    ref
  ) => {
    // ── Loading skeleton ────────────────────────────────────────────────────
    if (loading) {
      return (
        <div className={`card overflow-x-auto ${className}`} ref={ref}>
          <table className="table w-full">
            <thead>
              <tr className="border-b border-catalan-border">
                {columns.map((col) => (
                  <th
                    key={String(col.key)}
                    style={{ width: col.width }}
                    className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-catalan-textMuted/50"
                  >
                    {col.label}
                  </th>
                ))}
                {actions && <th className="px-4 py-2" />}
              </tr>
            </thead>
            <tbody>
              {[...Array(5)].map((_, i) => (
                <tr key={i} className="border-b border-catalan-border/50">
                  {columns.map((col) => (
                    <td key={String(col.key)} className="px-4 py-3">
                      <div
                        className="h-4 animate-pulse bg-catalan-hover rounded"
                        style={{ opacity: 1 - i * 0.12, width: col.width ?? '70%' }}
                      />
                    </td>
                  ))}
                  {actions && <td className="px-4 py-3"><div className="h-4 w-12 animate-pulse bg-catalan-hover rounded ml-auto" /></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    }

    // ── Empty state ─────────────────────────────────────────────────────────
    if (data.length === 0) {
      return (
        <div className={`card text-center py-10 ${className}`} ref={ref}>
          {emptyIcon && <div className="text-4xl mb-3">{emptyIcon}</div>}
          <p className="text-catalan-textMuted text-sm">{emptyMessage}</p>
        </div>
      )
    }

    // ── Normal table ────────────────────────────────────────────────────────
    return (
      <div className={`card overflow-x-auto ${className}`} ref={ref}>
        <table className="table w-full">
          <thead>
            <tr className="border-b border-catalan-border">
              {columns.map((col) => {
                const isSorted = sortKey === String(col.key)
                const canSort  = col.sortable && onSort
                return (
                  <th
                    key={String(col.key)}
                    style={{ width: col.width }}
                    onClick={canSort ? () => onSort!(String(col.key)) : undefined}
                    className={`px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider
                      text-catalan-textMuted select-none
                      ${canSort ? 'cursor-pointer hover:text-catalan-text transition-colors' : ''}`}
                  >
                    {col.label}
                    {canSort && <SortIcon active={isSorted} dir={sortDir ?? 'asc'} />}
                  </th>
                )
              })}
              {actions && (
                <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wider text-catalan-textMuted">
                  Actions
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {data.map((row, index) => (
              <tr
                key={keyExtractor(row, index)}
                onClick={() => onRowClick?.(row)}
                className={`border-b border-catalan-border hover:bg-catalan-hover transition-colors ${
                  onRowClick ? 'cursor-pointer' : ''
                }`}
              >
                {columns.map((col) => (
                  <td
                    key={`${keyExtractor(row, index)}-${String(col.key)}`}
                    className="px-4 py-3 text-sm text-catalan-text"
                  >
                    {col.render
                      ? col.render(row[col.key as keyof typeof row], row)
                      : String(row[col.key as keyof typeof row] ?? '')}
                  </td>
                ))}
                {actions && (
                  <td className="px-4 py-3 text-right">
                    {actions(row)}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }
)

Table.displayName = 'Table'

export default Table
