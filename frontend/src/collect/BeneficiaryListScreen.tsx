import React from 'react'

export interface RosterEntry {
  id: string
  name: string
  phone: string | null
  address: string | null
  scheduled_date: string | null
  notes: string | null
  extra_data: Record<string, string>
  collected: boolean
  submission_id: string | null
  status: string
}

interface Props {
  formTitle: string
  entries: RosterEntry[]
  onSelect: (entry: RosterEntry) => void
  onBack: () => void
}

export default function BeneficiaryListScreen({ formTitle, entries, onSelect, onBack }: Props) {
  const pending = entries.filter(e => !e.collected)
  const collected = entries.filter(e => e.collected)

  return (
    <div className="flex flex-col h-screen bg-catalan-bg">
      <div className="bg-catalan-surface border-b border-catalan-border sticky top-0 z-10">
        <div className="px-4 sm:px-6 py-3 flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center justify-center w-9 h-9 rounded-lg bg-catalan-hover text-catalan-textMuted hover:text-catalan-primary hover:bg-catalan-primary/10 transition-all flex-shrink-0"
          >
            &larr;
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-bold text-catalan-text truncate">{formTitle}</h1>
            <p className="text-xs text-catalan-textMuted">
              {pending.length} pending · {collected.length} collected
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-2">
        {entries.length === 0 && (
          <div className="text-center py-16 text-catalan-textMuted text-sm">No beneficiaries assigned</div>
        )}

        {entries.map(entry => (
          <button
            key={entry.id}
            onClick={() => onSelect(entry)}
            className={`w-full text-left p-4 rounded-xl border transition-all duration-150 ${
              entry.collected
                ? 'bg-catalan-surface border-catalan-border opacity-70'
                : 'bg-catalan-surface border-catalan-border hover:border-catalan-primary hover:bg-catalan-primary/5 active:scale-[0.99]'
            }`}
          >
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 mt-0.5">
                {entry.collected ? (
                  <span className="text-catalan-success text-lg">✅</span>
                ) : (
                  <span className="text-catalan-textMuted text-lg">⏳</span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-catalan-text text-sm truncate">{entry.name}</div>
                {entry.phone && (
                  <div className="text-xs text-catalan-textMuted font-mono mt-0.5">{entry.phone}</div>
                )}
                {entry.address && (
                  <div className="text-xs text-catalan-textMuted mt-0.5 truncate">{entry.address}</div>
                )}
                {entry.scheduled_date && (
                  <div className="text-xs text-catalan-textMuted mt-0.5">📅 {entry.scheduled_date}</div>
                )}
              </div>
              <div className="flex-shrink-0">
                {entry.collected ? (
                  <span className="text-xs text-catalan-success font-medium">Collected</span>
                ) : (
                  <span className="text-xs text-catalan-primary font-medium">Tap to start →</span>
                )}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
