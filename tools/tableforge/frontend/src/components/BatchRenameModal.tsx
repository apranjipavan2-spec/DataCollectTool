import { useState, useRef } from 'react'
import type { TableConfig, TableResult, DatasetMeta } from '../types'

type Status = 'pending' | 'running' | 'done' | 'error' | 'skipped'
interface RowState {
  id: string
  name: string
  status: Status
  newTitle?: string
  error?: string
}

interface Props {
  tables: TableConfig[]
  allResults: Map<string, TableResult>
  dataset: DatasetMeta | null
  projectFilters: Record<string, string[]>
  onClose: () => void
  onApplyAll: (updates: { tableId: string; title: string; subtitle: string; renames: Record<string, string> }[]) => void
  onRollback: (original: TableConfig[]) => void
}

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, '') + '/api'

export function BatchRenameModal({ tables, allResults, dataset, projectFilters, onClose, onApplyAll, onRollback }: Props) {
  const [rowStates, setRowStates] = useState<RowState[]>(tables.map(t => ({ id: t.id, name: t.name || t.title, status: 'pending' })))
  const [currentIdx, setCurrentIdx] = useState(0)
  const [phase, setPhase] = useState<'idle' | 'running' | 'cancelled' | 'done'>('idle')
  const cancelRef = useRef(false)
  const [skipRenamed, setSkipRenamed] = useState(true)
  const [delayMs, setDelayMs] = useState(1200)
  const [summary, setSummary] = useState({ done: 0, skipped: 0, error: 0 })
  const originalTablesRef = useRef<TableConfig[]>(tables.map(t => ({ ...t })))

  const updateRow = (idx: number, updates: Partial<RowState>) => {
    setRowStates(prev => prev.map((r, i) => i === idx ? { ...r, ...updates } : r))
  }

  const runBatch = async () => {
    if (!dataset) return
    cancelRef.current = false
    const updates: { tableId: string; title: string; subtitle: string; renames: Record<string, string> }[] = []
    let doneCount = 0, skippedCount = 0, errorCount = 0

    setPhase('running')

    for (let i = 0; i < rowStates.length; i++) {
      if (cancelRef.current) break

      const rs = rowStates[i]
      const tab = tables.find(t => t.id === rs.id)
      if (!tab) continue

      if (skipRenamed && tab.header_renames && Object.keys(tab.header_renames).length > 0) {
        updateRow(i, { status: 'skipped' })
        skippedCount++
        continue
      }

      setCurrentIdx(i)
      updateRow(i, { status: 'running' })

      try {
        const result = allResults.get(tab.id)
        if (!result) {
          updateRow(i, { status: 'skipped' })
          skippedCount++
          continue
        }

        const res = await fetch(`${API_BASE}/ai/polish`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            dataset_id: dataset.dataset_id,
            table_title: tab.title || tab.name,
            rows: tab.rows,
            columns: tab.columns,
            values: tab.values,
            headers: result.headers,
            sample_rows: result.rows.slice(0, 15),
            table_filters: tab.filters || {},
            project_filters: projectFilters,
          }),
        })

        if (!res.ok) throw new Error(await res.text())
        const data = await res.json()

        updates.push({
          tableId: tab.id,
          title: data.title || tab.title,
          subtitle: data.subtitle || '',
          renames: data.column_labels || {},
        })

        updateRow(i, { status: 'done', newTitle: data.title || tab.title })
        doneCount++
      } catch (e: any) {
        const errMsg = e.message || 'Failed'
        updateRow(i, { status: 'error', error: errMsg })
        errorCount++
      }

      if (i < rowStates.length - 1 && !cancelRef.current) {
        await new Promise(r => setTimeout(r, delayMs))
      }
    }

    setSummary({ done: doneCount, skipped: skippedCount, error: errorCount })
    onApplyAll(updates)
    setPhase(cancelRef.current ? 'cancelled' : 'done')
  }

  const handleCancel = () => {
    cancelRef.current = true
    setPhase('cancelled')
  }

  const handleUndo = () => {
    onRollback(originalTablesRef.current)
  }

  const progressPct = rowStates.length > 0 ? Math.round((currentIdx + 1) / rowStates.length * 100) : 0

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 50,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(0,0,0,0.4)',
    }}>
      <div style={{
        backgroundColor: 'var(--bg-primary)',
        borderRadius: '8px',
        boxShadow: '0 20px 25px rgba(0,0,0,0.15)',
        maxWidth: '600px',
        width: '100%',
        maxHeight: '480px',
        display: 'flex',
        flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px',
          borderBottom: '1px solid var(--border)',
        }}>
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: '600' }}>✨ Batch AI Rename</h2>
          <button onClick={onClose} style={{
            background: 'none',
            border: 'none',
            fontSize: '20px',
            cursor: 'pointer',
            color: 'var(--text-dim)',
          }}>✕</button>
        </div>

        {/* Content */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}>
          {phase !== 'done' && (
            <>
              <div>
                <div style={{ fontSize: '14px', fontWeight: '500', marginBottom: '8px' }}>
                  {phase === 'idle' ? `Ready to rename ${rowStates.length} tables` : `Renaming ${currentIdx + 1} of ${rowStates.length}`}
                </div>
                <div style={{
                  width: '100%',
                  height: '8px',
                  backgroundColor: '#e5e7eb',
                  borderRadius: '4px',
                  overflow: 'hidden',
                }}>
                  <div style={{
                    height: '100%',
                    backgroundColor: 'var(--primary)',
                    width: `${progressPct}%`,
                    transition: 'width 0.3s ease',
                  }} />
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-dim)', marginTop: '4px' }}>{progressPct}%</div>
              </div>

              {phase === 'running' && currentIdx < rowStates.length && (
                <div style={{
                  fontSize: '13px',
                  padding: '8px',
                  backgroundColor: 'var(--bg-secondary)',
                  borderRadius: '4px',
                }}>
                  <div style={{ fontWeight: '500', overflow: 'hidden', textOverflow: 'ellipsis' }}>{rowStates[currentIdx].name}</div>
                  {rowStates[currentIdx].newTitle && (
                    <div style={{ fontSize: '12px', color: 'var(--text-success)', marginTop: '4px' }}>
                      ✓ → {rowStates[currentIdx].newTitle}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* Status list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {rowStates.slice(0, 15).map((rs, i) => (
              <div key={rs.id} style={{
                fontSize: '12px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px',
                backgroundColor: 'var(--bg-secondary)',
                borderRadius: '4px',
              }}>
                {rs.status === 'done' && <span style={{ color: 'var(--success)' }}>✓</span>}
                {rs.status === 'running' && <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⟳</span>}
                {rs.status === 'pending' && <span style={{ color: 'var(--text-dim)' }}>○</span>}
                {rs.status === 'error' && <span style={{ color: 'var(--error)' }}>⚠</span>}
                {rs.status === 'skipped' && <span style={{ color: 'var(--text-dim)' }}>–</span>}
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{rs.name}</span>
                <span style={{ color: 'var(--text-dim)' }}>{rs.status}</span>
                {rs.error && <span style={{ color: 'var(--error)', fontSize: '11px' }}>{rs.error}</span>}
              </div>
            ))}
            {rowStates.length > 15 && (
              <div style={{ fontSize: '12px', color: 'var(--text-dim)', padding: '8px' }}>
                ... and {rowStates.length - 15} more
              </div>
            )}
          </div>

          {phase === 'done' && (
            <div style={{
              padding: '12px',
              backgroundColor: 'rgba(34, 197, 94, 0.1)',
              borderRadius: '4px',
              fontSize: '13px',
              color: 'var(--success)',
            }}>
              ✓ Batch complete: {summary.done} renamed, {summary.skipped} skipped, {summary.error} errors
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          borderTop: '1px solid var(--border)',
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '13px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={skipRenamed}
                onChange={e => setSkipRenamed(e.target.checked)}
                disabled={phase === 'running'}
              />
              <span>Skip already-renamed</span>
            </label>
            {phase === 'idle' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ color: 'var(--text-dim)' }}>Delay:</span>
                <input
                  type="number"
                  value={delayMs}
                  onChange={e => setDelayMs(Math.max(100, Math.min(5000, parseInt(e.target.value) || 1200)))}
                  min="100"
                  max="5000"
                  step="100"
                  style={{
                    width: '60px',
                    padding: '4px',
                    fontSize: '12px',
                    border: '1px solid var(--border)',
                    borderRadius: '4px',
                  }}
                />
                <span style={{ color: 'var(--text-dim)' }}>ms</span>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            {phase === 'idle' && (
              <button onClick={runBatch} style={{
                padding: '8px 16px',
                backgroundColor: 'var(--primary)',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                fontSize: '13px',
                fontWeight: '500',
                cursor: 'pointer',
              }}>
                Start Rename
              </button>
            )}
            {phase === 'running' && (
              <button onClick={handleCancel} style={{
                padding: '8px 16px',
                backgroundColor: 'var(--error)',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                fontSize: '13px',
                fontWeight: '500',
                cursor: 'pointer',
              }}>
                Cancel
              </button>
            )}
            {phase === 'done' && (
              <>
                <button onClick={handleUndo} style={{
                  padding: '8px 16px',
                  backgroundColor: 'transparent',
                  color: 'var(--error)',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '13px',
                  fontWeight: '500',
                  cursor: 'pointer',
                }}>
                  Undo Batch Rename
                </button>
                <button onClick={onClose} style={{
                  padding: '8px 16px',
                  backgroundColor: 'var(--primary)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '13px',
                  fontWeight: '500',
                  cursor: 'pointer',
                }}>
                  Done
                </button>
              </>
            )}
            {phase === 'cancelled' && (
              <button onClick={onClose} style={{
                padding: '8px 16px',
                backgroundColor: 'var(--bg-secondary)',
                border: 'none',
                borderRadius: '4px',
                fontSize: '13px',
                fontWeight: '500',
                cursor: 'pointer',
              }}>
                Close
              </button>
            )}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
