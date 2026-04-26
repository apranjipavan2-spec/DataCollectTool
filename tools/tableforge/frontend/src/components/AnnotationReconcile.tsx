import React, { useState, useMemo } from 'react';
import { Annotation } from './AnnotationOverlay';

export interface ReconcileAnnotation {
  tableId: string;
  tableName: string;
  annotation: Annotation;
  action: 'keep' | 'discard' | 'remap';
  newRowIdx?: number;
  newColIdx?: number;
}

interface Props {
  /** Annotations that may be misplaced after data refresh */
  orphaned: ReconcileAnnotation[];
  /** New row count so user knows valid range */
  newRowCount: number;
  newColCount: number;
  onResolve: (resolved: ReconcileAnnotation[]) => void;
  onClose: () => void;
}

export function AnnotationReconcileDialog({ orphaned, newRowCount, newColCount, onResolve, onClose }: Props) {
  const [decisions, setDecisions] = useState<ReconcileAnnotation[]>(() =>
    orphaned.map(o => ({ ...o, action: 'keep' as const }))
  );

  const update = (idx: number, patch: Partial<ReconcileAnnotation>) => {
    setDecisions(prev => prev.map((d, i) => i === idx ? { ...d, ...patch } : d));
  };

  const allResolved = decisions.every(d =>
    d.action === 'discard' ||
    (d.action === 'keep') ||
    (d.action === 'remap' && d.newRowIdx !== undefined && d.newColIdx !== undefined)
  );

  return (
    <div className="modal-overlay">
      <div className="modal modal-md">
        <div className="modal-header">
          <h2>⚠ Annotation Reconciliation</h2>
        </div>
        <div className="modal-body">
          <p style={{ color: 'var(--text-dim)', marginBottom: 12 }}>
            <strong>{orphaned.length}</strong> annotation{orphaned.length !== 1 ? 's' : ''} may be misplaced
            because the table structure changed after re-running the data.
            New table size: <strong>{newRowCount} rows × {newColCount} columns</strong>.
          </p>
          <div className="reconcile-list">
            {decisions.map((d, idx) => (
              <div key={idx} className="reconcile-item">
                <div className="reconcile-info">
                  <span className="reconcile-table">{d.tableName}</span>
                  <span className="reconcile-pos">Row {d.annotation.rowIdx + 1}, Col {d.annotation.colIdx + 1}</span>
                  {d.annotation.text && (
                    <span className="reconcile-note" title={d.annotation.text}>
                      📝 "{d.annotation.text.slice(0, 40)}{d.annotation.text.length > 40 ? '…' : ''}"
                    </span>
                  )}
                </div>
                <div className="reconcile-actions">
                  <select
                    value={d.action}
                    onChange={e => update(idx, { action: e.target.value as any })}
                  >
                    <option value="keep">Keep at original position</option>
                    <option value="remap">Move to new position</option>
                    <option value="discard">Discard</option>
                  </select>
                  {d.action === 'remap' && (
                    <div className="reconcile-remap">
                      <label>Row:</label>
                      <input
                        type="number" min={0} max={newRowCount - 1}
                        value={d.newRowIdx ?? d.annotation.rowIdx}
                        onChange={e => update(idx, { newRowIdx: Number(e.target.value) })}
                        style={{ width: 60 }}
                      />
                      <label>Col:</label>
                      <input
                        type="number" min={0} max={newColCount - 1}
                        value={d.newColIdx ?? d.annotation.colIdx}
                        onChange={e => update(idx, { newColIdx: Number(e.target.value) })}
                        style={{ width: 60 }}
                      />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12, padding: '8px 12px', background: 'rgba(59,130,246,0.08)', borderRadius: 6, fontSize: 12, color: 'var(--text-dim)' }}>
            💡 "Keep at original position" retains the annotation at its original row/col index.
            If the data shifted, the annotation may point to different content.
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary"
            onClick={() => onResolve(decisions)}
            disabled={!allResolved}
          >
            Apply Decisions
          </button>
        </div>
      </div>
    </div>
  );
}

/** Detect orphaned annotations by checking if their positions exceed the new table bounds */
export function detectOrphanedAnnotations(
  annotationsMap: Record<string, { rowIdx: number; colIdx: number; text: string; color: string }[]>,
  tableNames: Record<string, string>,
  results: Map<string, { rows: any[][]; headers: string[] }>
): ReconcileAnnotation[] {
  const orphaned: ReconcileAnnotation[] = [];
  for (const [tableId, anns] of Object.entries(annotationsMap)) {
    const result = results.get(tableId);
    if (!result || anns.length === 0) continue;
    const rowCount = result.rows.length;
    const colCount = result.headers.length;
    for (const ann of anns) {
      if (ann.rowIdx >= rowCount || ann.colIdx >= colCount) {
        orphaned.push({
          tableId,
          tableName: tableNames[tableId] || tableId,
          annotation: ann as Annotation,
          action: 'keep',
        });
      }
    }
  }
  return orphaned;
}
