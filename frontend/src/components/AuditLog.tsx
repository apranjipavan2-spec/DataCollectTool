import React, { useState, useEffect } from 'react'
import api from '@/lib/api'

interface AuditEntry {
  id: string
  action: string
  changed_by: string
  changed_by_name: string
  note: string | null
  created_at: string
}

interface Props {
  submissionId: string
}

const ACTION_CONFIG: Record<string, { icon: string; label: string; cls: string }> = {
  created:  { icon: '\u{1F4DD}', label: 'Created',  cls: 'text-catalan-primary' },
  flagged:  { icon: '\u{1F6A9}', label: 'Flagged',  cls: 'text-catalan-warning' },
  approved: { icon: '\u2705',    label: 'Approved', cls: 'text-catalan-success' },
  rejected: { icon: '\u274C',    label: 'Rejected', cls: 'text-catalan-error' },
  updated:  { icon: '\u270F\uFE0F', label: 'Updated',  cls: 'text-catalan-textSecondary' },
}

export default function AuditLog({ submissionId }: Props) {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    setLoading(true)
    api.get(`/history/${submissionId}`)
      .then(({ data }) => setEntries(data))
      .catch(err => setError(err.response?.data?.detail ?? 'Failed to load audit log'))
      .finally(() => setLoading(false))
  }, [submissionId])

  if (loading) return (
    <div className="flex items-center gap-2 py-2 text-xs text-catalan-textMuted">
      <div className="w-3 h-3 border border-catalan-primary border-t-transparent rounded-full animate-spin" />
      Loading history…
    </div>
  )

  if (error) return (
    <div className="text-xs text-catalan-error py-2">{error}</div>
  )

  if (entries.length === 0) return (
    <div className="text-xs text-catalan-textMuted py-2">No audit history yet</div>
  )

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-xs text-catalan-primary hover:underline flex items-center gap-1"
      >
        <span>{expanded ? '\u25BE' : '\u25B8'}</span>
        Audit Log ({entries.length} event{entries.length !== 1 ? 's' : ''})
      </button>

      {expanded && (
        <div className="mt-2 space-y-0 relative">
          {entries.map((entry, i) => {
            const cfg = ACTION_CONFIG[entry.action] ?? ACTION_CONFIG.updated
            return (
              <div key={entry.id} className="flex gap-3 items-start py-2 relative">
                {/* Timeline connector */}
                {i < entries.length - 1 && (
                  <div className="absolute left-[9px] top-8 w-0.5 h-full bg-catalan-border" />
                )}
                {/* Dot */}
                <div className="w-[18px] h-[18px] flex-shrink-0 rounded-full bg-catalan-surface border-2 border-catalan-border flex items-center justify-center text-[10px] mt-0.5 z-10">
                  {cfg.icon}
                </div>
                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-xs font-medium ${cfg.cls}`}>{cfg.label}</span>
                    <span className="text-[11px] text-catalan-textMuted">by {entry.changed_by_name}</span>
                    <span className="text-[11px] text-catalan-textMuted ml-auto">
                      {new Date(entry.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                    </span>
                  </div>
                  {entry.note && (
                    <p className="text-xs text-catalan-textMuted mt-0.5 leading-snug">{entry.note}</p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
