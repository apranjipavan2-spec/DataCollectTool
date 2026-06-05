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
  onRollback: () => void
}

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, '') + '/api'

export function BatchRenameModal({ tables, allResults, dataset, projectFilters, onClose, onApplyAll, onRollback }: Props) {
  const [rowStates, setRowStates] = useState<RowState[]>(tables.map(t => ({ id: t.id, name: t.name || t.title, status: 'pending' })))
  const [currentIdx, setCurrentIdx] = useState(0)
  const [phase, setPhase] = useState<'idle' | 'running' | 'cancelled' | 'done' | 'error'>('idle')
  const [configError, setConfigError] = useState('')
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

    // Check API config first
    try {
      const configRes = await fetch(`${API_BASE}/ai/config`)
      if (!configRes.ok) throw new Error('Failed to check AI configuration')
      const config = await configRes.json()
      if (!config.has_key) {
        setConfigError('AI API key not configured. Please contact your administrator to configure the API key.')
        setPhase('error')
        return
      }
    } catch (e: any) {
      setConfigError('Unable to verify API configuration. Please try again.')
      setPhase('error')
      return
    }

    cancelRef.current = false
    setConfigError('')
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
    onRollback()
  }

  const progressPct = rowStates.length > 0 ? Math.round((currentIdx + 1) / rowStates.length * 100) : 0

  return (
    <div className="ai-result" style={{ marginTop: 16 }}>
      {configError && phase === 'error' && (
        <div style={{
          padding: 12,
          backgroundColor: 'rgba(239, 68, 68, 0.1)',
          borderRadius: 4,
          fontSize: 12,
          color: 'var(--danger)',
          marginBottom: 12,
          border: '1px solid rgba(239, 68, 68, 0.2)',
        }}>
          ⚠ {configError}
        </div>
      )}
      {phase !== 'error' && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 8 }}>
            {phase === 'idle' ? `Ready to rename ${rowStates.length} tables` : `Renaming ${currentIdx + 1} of ${rowStates.length}`}
          </div>
          <div style={{ width: '100%', height: 6, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              backgroundColor: 'var(--primary)',
              width: `${progressPct}%`,
              transition: 'width 0.3s ease',
            }} />
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>{progressPct}%</div>
        </div>
      )}

      {phase === 'running' && currentIdx < rowStates.length && (
        <div style={{
          fontSize: 12,
          padding: 8,
          backgroundColor: 'rgba(255,255,255,0.05)',
          borderRadius: 4,
          marginBottom: 10,
        }}>
          <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis' }}>{rowStates[currentIdx].name}</div>
          {rowStates[currentIdx].newTitle && (
            <div style={{ fontSize: 11, color: 'var(--success)', marginTop: 4 }}>
              ✓ → {rowStates[currentIdx].newTitle}
            </div>
          )}
        </div>
      )}

      {/* Status list */}
      <div style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 12 }}>
        {rowStates.slice(0, 15).map((rs) => (
          <div key={rs.id} style={{
            fontSize: 11,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: 6,
            backgroundColor: 'rgba(255,255,255,0.05)',
            borderRadius: 3,
          }}>
            {rs.status === 'done' && <span style={{ color: 'var(--success)' }}>✓</span>}
            {rs.status === 'running' && <span style={{ display: 'inline-block', animation: 'spin 0.8s linear infinite' }}>⟳</span>}
            {rs.status === 'pending' && <span style={{ color: 'var(--text-dim)' }}>○</span>}
            {rs.status === 'error' && <span style={{ color: 'var(--danger)' }}>⚠</span>}
            {rs.status === 'skipped' && <span style={{ color: 'var(--text-dim)' }}>–</span>}
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{rs.name}</span>
            {rs.error && <span style={{ color: 'var(--danger)', fontSize: 10, whiteSpace: 'nowrap' }}>error</span>}
          </div>
        ))}
        {rowStates.length > 15 && (
          <div style={{ fontSize: 11, color: 'var(--text-dim)', padding: 6 }}>
            ... and {rowStates.length - 15} more
          </div>
        )}
      </div>

      {phase === 'done' && (
        <div style={{
          padding: 10,
          backgroundColor: 'rgba(34, 197, 94, 0.1)',
          borderRadius: 4,
          fontSize: 12,
          color: 'var(--success)',
          marginBottom: 12,
        }}>
          ✓ Batch complete: {summary.done} renamed, {summary.skipped} skipped, {summary.error} errors
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={skipRenamed}
            onChange={e => setSkipRenamed(e.target.checked)}
          />
          <span>Skip already-renamed</span>
        </label>
        {phase === 'idle' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: 'var(--text-dim)' }}>Delay:</span>
            <input
              type="number"
              value={delayMs}
              onChange={e => setDelayMs(Math.max(100, Math.min(5000, parseInt(e.target.value) || 1200)))}
              min="100"
              max="5000"
              step="100"
              style={{
                width: 50,
                padding: 4,
                fontSize: 11,
                border: '1px solid var(--border)',
                borderRadius: 3,
                background: 'var(--bg)',
                color: 'var(--text)',
              }}
            />
            <span style={{ color: 'var(--text-dim)' }}>ms</span>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        {phase === 'idle' && (
          <button onClick={runBatch} className="btn-primary" style={{ flex: 1 }}>
            Start Rename
          </button>
        )}
        {phase === 'error' && (
          <>
            <button onClick={() => { setPhase('idle'); setConfigError('') }} className="btn-primary" style={{ flex: 1 }}>
              Try Again
            </button>
            <button onClick={onClose} className="btn-primary" style={{ flex: 1, backgroundColor: 'transparent', color: 'var(--text-dim)', border: '1px solid var(--border)' }}>
              Close
            </button>
          </>
        )}
        {phase === 'running' && (
          <button onClick={handleCancel} className="btn-primary" style={{ flex: 1, backgroundColor: 'var(--danger)' }}>
            Cancel
          </button>
        )}
        {phase === 'done' && (
          <>
            <button onClick={handleUndo} className="btn-primary" style={{ flex: 1, backgroundColor: 'transparent', color: 'var(--danger)', border: '1px solid var(--danger)' }}>
              Undo
            </button>
            <button onClick={onClose} className="btn-primary" style={{ flex: 1 }}>
              Done
            </button>
          </>
        )}
        {phase === 'cancelled' && (
          <button onClick={onClose} className="btn-primary" style={{ flex: 1 }}>
            Close
          </button>
        )}
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
