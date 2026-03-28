import React from 'react'

// ── Base animated block ──────────────────────────────────────────────────────

export function SkeletonBlock({ className = '' }: { className?: string }) {
  return (
    <div className={`animate-pulse bg-catalan-hover rounded ${className}`} />
  )
}

// ── Stat card grid skeleton (4 cards) ───────────────────────────────────────

export function StatCardsSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="bg-catalan-surface border border-catalan-border rounded-xl p-5 border-l-4">
          <SkeletonBlock className="h-4 w-28 mb-2" />
          <SkeletonBlock className="h-3 w-36 mb-5" />
          <SkeletonBlock className="h-9 w-14" />
        </div>
      ))}
    </div>
  )
}

// ── Table rows skeleton ──────────────────────────────────────────────────────

export function TableRowsSkeleton({
  rows = 6,
  cols = 5,
}: {
  rows?: number
  cols?: number
}) {
  const widths = ['w-16', 'flex-1', 'flex-1', 'w-20', 'w-24']
  return (
    <div>
      {/* Header row */}
      <div className="flex gap-4 px-3 py-2 border-b border-catalan-border mb-1">
        {[...Array(cols)].map((_, j) => (
          <SkeletonBlock key={j} className={`h-3 ${widths[j] ?? 'flex-1'}`} />
        ))}
      </div>
      {/* Data rows */}
      {[...Array(rows)].map((_, i) => (
        <div
          key={i}
          className="flex gap-4 px-3 py-3.5 border-b border-catalan-border/50"
          style={{ opacity: 1 - i * 0.08 }}
        >
          {[...Array(cols)].map((_, j) => (
            <SkeletonBlock key={j} className={`h-4 ${widths[j] ?? 'flex-1'}`} />
          ))}
        </div>
      ))}
    </div>
  )
}

// ── Tab pills skeleton ───────────────────────────────────────────────────────

export function TabsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="flex gap-1 bg-catalan-surface rounded-lg p-1 w-fit">
      {[...Array(count)].map((_, i) => (
        <SkeletonBlock key={i} className="h-8 w-24 rounded-lg" />
      ))}
    </div>
  )
}

// ── Card with table skeleton ─────────────────────────────────────────────────

export function CardTableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="bg-catalan-surface border border-catalan-border rounded-xl p-5">
      <TableRowsSkeleton rows={rows} cols={cols} />
    </div>
  )
}

// ── Full Dashboard skeleton (replaces fullscreen spinner) ───────────────────

export function DashboardSkeleton() {
  return (
    <div className="flex-1 p-6 space-y-6">
      <StatCardsSkeleton />
      <TabsSkeleton />
      <CardTableSkeleton rows={8} cols={5} />
    </div>
  )
}
