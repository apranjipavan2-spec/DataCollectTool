import { useState, useRef } from 'react'
import api from '../lib/api'
import { useToast } from '../lib/ToastContext'
import EmojiIcon from '@/components/EmojiIcon'

interface ColHeader { id: string; label: string; type: string; options: any[] }
// Single canonical definition lives in fgStorage — re-export so existing imports keep working.
import type { SavedTabulation } from '../lib/fgStorage'
export type { SavedTabulation }

type Status = 'pending' | 'running' | 'done' | 'error' | 'skipped'
interface RowState {
  id: string
  title: string
  status: Status
  newTitle?: string
  error?: string
}

interface Props {
  saved: SavedTabulation[]
  programId: string
  programName: string
  cols: ColHeader[]
  onClose: () => void
  onComplete: (updated: SavedTabulation[]) => void
}

export function BatchRenameModal({ saved, programId, programName, cols, onClose, onComplete }: Props) {
  const toast = useToast()
  const [rowStates, setRowStates] = useState<RowState[]>(saved.map(t => ({ id: t.id, title: t.title, status: 'pending' })))
  const [currentIdx, setCurrentIdx] = useState(0)
  const [phase, setPhase] = useState<'idle' | 'running' | 'cancelled' | 'done'>('idle')
  const cancelRef = useRef(false)
  const [skipRenamed, setSkipRenamed] = useState(true)
  const [delayMs, setDelayMs] = useState(1200)
  const [summary, setSummary] = useState({ done: 0, skipped: 0, error: 0 })

  const updateRow = (idx: number, updates: Partial<RowState>) => {
    setRowStates(prev => prev.map((r, i) => i === idx ? { ...r, ...updates } : r))
  }

  const runBatch = async () => {
    cancelRef.current = false
    localStorage.setItem(`fg_batch_rename_${programId}`, JSON.stringify({ ts: new Date().toISOString(), tables: saved }))

    const fieldLabels = Object.fromEntries(cols.map(c => [c.id, c.label]))
    const results = saved.map(t => ({ ...t }))
    let doneCount = 0, skippedCount = 0, errorCount = 0

    setPhase('running')

    for (let i = 0; i < rowStates.length; i++) {
      if (cancelRef.current) break

      const rs = rowStates[i]
      const tab = saved.find(t => t.id === rs.id)
      if (!tab) continue

      if (skipRenamed && tab.column_labels && Object.keys(tab.column_labels).length > 0) {
        updateRow(i, { status: 'skipped' })
        skippedCount++
        continue
      }

      setCurrentIdx(i)
      updateRow(i, { status: 'running' })

      try {
        const res = await api.post(`/fg/programs/${programId}/tabulate/polish`, {
          title: tab.title,
          groupby_field: tab.groupby_field,
          value_field: tab.value_field,
          aggregation: tab.aggregation,
          rows: tab.rows.slice(0, 30),
          is_cross_tab: tab.is_cross_tab ?? false,
          sub_keys: tab.sub_keys ?? [],
          program_context: programName,
          field_labels: fieldLabels,
        })

        const idx = results.findIndex(t => t.id === tab.id)
        if (idx >= 0) {
          results[idx] = {
            ...tab,
            title: res.data.title || tab.title,
            description: res.data.subtitle || tab.description,
            column_labels: res.data.column_labels || tab.column_labels,
          }
          await api.post(`/fg/programs/${programId}/analysis/tabulations`, results[idx])
        }

        updateRow(i, { status: 'done', newTitle: res.data.title || tab.title })
        doneCount++
      } catch (e: any) {
        const errMsg = e.response?.data?.detail || e.message || 'Failed'
        updateRow(i, { status: 'error', error: errMsg })
        errorCount++
      }

      if (i < rowStates.length - 1 && !cancelRef.current) {
        await new Promise(r => setTimeout(r, delayMs))
      }
    }

    setSummary({ done: doneCount, skipped: skippedCount, error: errorCount })
    onComplete(results)
    setPhase(cancelRef.current ? 'cancelled' : 'done')
  }

  const handleCancel = () => {
    cancelRef.current = true
    setPhase('cancelled')
  }

  const handleUndo = async () => {
    const raw = localStorage.getItem(`fg_batch_rename_${programId}`)
    if (!raw) {
      toast.error('No snapshot found')
      return
    }
    try {
      const { tables } = JSON.parse(raw)
      await api.post(`/fg/programs/${programId}/analysis/tabulations/batch-update`, { tabulations: tables })
      onComplete(tables)
      localStorage.removeItem(`fg_batch_rename_${programId}`)
      toast.success('Batch rename undone')
    } catch (e: any) {
      toast.error('Undo failed')
    }
  }

  const progressPct = rowStates.length > 0 ? Math.round((currentIdx + 1) / rowStates.length * 100) : 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white dark:bg-catalan-darkBg rounded-lg shadow-2xl max-w-2xl w-full max-h-96 flex flex-col border border-catalan-border">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-catalan-border">
          <h2 className="text-lg font-semibold"><EmojiIcon e="✨" /> Batch AI Rename</h2>
          <button onClick={onClose} className="text-catalan-textMuted hover:text-catalan-text">✕</button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4 space-y-3">
          {phase !== 'done' && (
            <>
              <div>
                <div className="text-sm font-medium mb-1">
                  {phase === 'idle' ? `Ready to rename ${rowStates.length} tables` : `Renaming ${currentIdx + 1} of ${rowStates.length}`}
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div className="bg-catalan-primary h-2 rounded-full transition-all" style={{ width: `${progressPct}%` }} />
                </div>
                <div className="text-xs text-catalan-textMuted mt-1">{progressPct}%</div>
              </div>

              {phase === 'running' && currentIdx < rowStates.length && (
                <div className="text-sm p-2 bg-catalan-surface rounded">
                  <div className="font-medium truncate">{rowStates[currentIdx].title}</div>
                  {rowStates[currentIdx].newTitle && (
                    <div className="text-xs text-catalan-success mt-1">✓ → {rowStates[currentIdx].newTitle}</div>
                  )}
                </div>
              )}
            </>
          )}

          {/* Status list */}
          <div className="space-y-1">
            {rowStates.slice(0, 15).map((rs) => (
              <div key={rs.id} className="text-xs flex items-center gap-2 p-2 bg-catalan-surface rounded hover:bg-catalan-hover">
                {rs.status === 'done' && <span className="text-catalan-success">✓</span>}
                {rs.status === 'running' && <span className="text-catalan-primary animate-spin">⟳</span>}
                {rs.status === 'pending' && <span className="text-catalan-textMuted">○</span>}
                {rs.status === 'error' && <span className="text-catalan-error"><EmojiIcon e="⚠" /></span>}
                {rs.status === 'skipped' && <span className="text-catalan-textMuted">–</span>}
                <span className="flex-1 truncate">{rs.title}</span>
                <span className="text-catalan-textMuted">{rs.status}</span>
                {rs.error && <span className="text-catalan-error text-xs">{rs.error}</span>}
              </div>
            ))}
            {rowStates.length > 15 && <div className="text-xs text-catalan-textMuted p-2">... and {rowStates.length - 15} more</div>}
          </div>

          {phase === 'done' && (
            <div className="p-3 bg-catalan-success/10 rounded text-sm text-catalan-success">
              ✓ Batch complete: {summary.done} renamed, {summary.skipped} skipped, {summary.error} errors
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-catalan-border p-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 text-sm">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={skipRenamed}
                onChange={e => setSkipRenamed(e.target.checked)}
                disabled={phase === 'running'}
              />
              <span>Skip already-renamed</span>
            </label>
            {phase === 'idle' && (
              <div className="flex items-center gap-2">
                <span className="text-catalan-textMuted">Delay:</span>
                <input
                  type="number"
                  value={delayMs}
                  onChange={e => setDelayMs(Math.max(100, Math.min(5000, parseInt(e.target.value) || 1200)))}
                  min="100"
                  max="5000"
                  step="100"
                  className="w-16 px-2 py-1 text-xs border rounded"
                />
                <span className="text-catalan-textMuted">ms</span>
              </div>
            )}
          </div>

          <div className="flex gap-2">
            {phase === 'idle' && (
              <button
                onClick={runBatch}
                className="px-4 py-2 bg-catalan-primary text-white rounded hover:opacity-90 text-sm font-medium"
              >
                Start Rename
              </button>
            )}
            {phase === 'running' && (
              <button
                onClick={handleCancel}
                className="px-4 py-2 bg-catalan-error text-white rounded hover:opacity-90 text-sm font-medium"
              >
                Cancel
              </button>
            )}
            {phase === 'done' && (
              <>
                <button
                  onClick={handleUndo}
                  className="px-4 py-2 text-catalan-error hover:bg-catalan-error/10 rounded text-sm font-medium"
                >
                  Undo Batch Rename
                </button>
                <button
                  onClick={onClose}
                  className="px-4 py-2 bg-catalan-primary text-white rounded hover:opacity-90 text-sm font-medium"
                >
                  Done
                </button>
              </>
            )}
            {(phase === 'cancelled' || phase === 'idle') && (
              <button
                onClick={onClose}
                className="px-4 py-2 bg-catalan-surface hover:bg-catalan-hover rounded text-sm font-medium"
              >
                Close
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
