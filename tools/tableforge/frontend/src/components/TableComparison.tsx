import React, { useState, useMemo } from 'react';
import { TableConfig, TableResult } from '../types';

interface Props {
  tables: TableConfig[];
  results: Map<string, TableResult>;
  onClose: () => void;
}

export function TableComparison({ tables, results, onClose }: Props) {
  const [tableAId, setTableAId] = useState(tables[0]?.id || '');
  const [tableBId, setTableBId] = useState(tables[1]?.id || '');
  const [diffMode, setDiffMode] = useState<'side_by_side' | 'diff_only'>('side_by_side');
  const [highlightDiffs, setHighlightDiffs] = useState(true);

  const tableA = tables.find(t => t.id === tableAId);
  const tableB = tables.find(t => t.id === tableBId);
  const resultA = results.get(tableAId);
  const resultB = results.get(tableBId);

  const diffData = useMemo(() => {
    if (!resultA || !resultB) return null;

    // Build a map of row key -> values for each table
    const mapA = new Map<string, any[]>();
    const mapB = new Map<string, any[]>();

    resultA.rows.forEach(row => mapA.set(String(row[0]), row));
    resultB.rows.forEach(row => mapB.set(String(row[0]), row));

    const allKeys = new Set([...mapA.keys(), ...mapB.keys()]);
    const diffs: {
      key: string;
      rowA: any[] | null;
      rowB: any[] | null;
      hasDiff: boolean;
      cellDiffs: boolean[];
    }[] = [];

    allKeys.forEach(key => {
      const rowA = mapA.get(key) || null;
      const rowB = mapB.get(key) || null;

      const maxLen = Math.max(rowA?.length || 0, rowB?.length || 0);
      const cellDiffs: boolean[] = [];
      let hasDiff = rowA === null || rowB === null;

      for (let i = 0; i < maxLen; i++) {
        const a = rowA?.[i];
        const b = rowB?.[i];
        const isDiff = String(a ?? '') !== String(b ?? '');
        cellDiffs.push(isDiff);
        if (isDiff) hasDiff = true;
      }

      diffs.push({ key, rowA, rowB, hasDiff, cellDiffs });
    });

    return diffs;
  }, [resultA, resultB]);

  const displayDiffs = diffMode === 'diff_only'
    ? (diffData || []).filter(d => d.hasDiff)
    : (diffData || []);

  const headersA = resultA?.headers || [];
  const headersB = resultB?.headers || [];

  const numDiffs = (diffData || []).filter(d => d.hasDiff).length;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()} style={{ height: '85vh', maxWidth: 1100 }}>
        <div className="modal-header">
          <h2>Table Comparison</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body" style={{ padding: '12px 16px', overflow: 'auto' }}>
          <div className="form-row" style={{ marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
            <div className="form-group" style={{ flex: 1 }}>
              <label>Table A</label>
              <select value={tableAId} onChange={e => setTableAId(e.target.value)}>
                {tables.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label>Table B</label>
              <select value={tableBId} onChange={e => setTableBId(e.target.value)}>
                {tables.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>View</label>
              <div className="btn-group">
                <button className={`btn-toggle ${diffMode === 'side_by_side' ? 'active' : ''}`} onClick={() => setDiffMode('side_by_side')}>Side by Side</button>
                <button className={`btn-toggle ${diffMode === 'diff_only' ? 'active' : ''}`} onClick={() => setDiffMode('diff_only')}>Differences Only</button>
              </div>
            </div>
            <label className="checkbox-label" style={{ alignSelf: 'flex-end', marginBottom: 6 }}>
              <input type="checkbox" checked={highlightDiffs} onChange={e => setHighlightDiffs(e.target.checked)} />
              Highlight differences
            </label>
          </div>

          {(!resultA || !resultB) ? (
            <div className="empty-state" style={{ padding: 40 }}>
              <p>Select two tables with computed results to compare them.</p>
            </div>
          ) : (
            <>
              <div className="comparison-summary" style={{ marginBottom: 10, padding: '6px 10px', background: 'var(--bg-2)', borderRadius: 4, fontSize: 12 }}>
                <strong>{tableA?.name}</strong> vs <strong>{tableB?.name}</strong>
                {' — '}
                {numDiffs === 0 ? (
                  <span style={{ color: '#22c55e' }}>✓ Tables are identical</span>
                ) : (
                  <span style={{ color: '#f59e0b' }}>⚠ {numDiffs} row{numDiffs !== 1 ? 's' : ''} differ</span>
                )}
                {' · '}{resultA.row_count} vs {resultB.row_count} rows
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table className="result-table comparison-table">
                  <thead>
                    <tr>
                      <th style={{ background: '#1e293b' }}>Row Key</th>
                      {headersA.map((h, i) => (
                        <th key={`a${i}`} style={{ background: '#1a4480' }}>{tableA?.name}: {h}</th>
                      ))}
                      {headersB.map((h, i) => (
                        <th key={`b${i}`} style={{ background: '#1e3a2f' }}>{tableB?.name}: {h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {displayDiffs.map(({ key, rowA, rowB, hasDiff, cellDiffs }) => (
                      <tr key={key} style={hasDiff && highlightDiffs ? { background: 'rgba(239,68,68,0.08)' } : {}}>
                        <td style={{ fontWeight: 600 }}>
                          {hasDiff && <span style={{ color: '#f59e0b', marginRight: 4 }}>◆</span>}
                          {rowA === null && <span style={{ color: '#ef4444', fontSize: 10, marginRight: 4 }}>ONLY B</span>}
                          {rowB === null && <span style={{ color: '#3b82f6', fontSize: 10, marginRight: 4 }}>ONLY A</span>}
                          {key}
                        </td>
                        {headersA.map((_, i) => {
                          const val = rowA?.[i];
                          return (
                            <td key={`a${i}`} style={{
                              background: highlightDiffs && cellDiffs[i] ? 'rgba(59,130,246,0.15)' : undefined,
                              color: rowA === null ? 'var(--text-dim)' : undefined,
                            }}>
                              {rowA ? (val != null ? String(val) : '') : '—'}
                            </td>
                          );
                        })}
                        {headersB.map((_, i) => {
                          const val = rowB?.[i];
                          return (
                            <td key={`b${i}`} style={{
                              background: highlightDiffs && cellDiffs[i] ? 'rgba(239,68,68,0.15)' : undefined,
                              color: rowB === null ? 'var(--text-dim)' : undefined,
                            }}>
                              {rowB ? (val != null ? String(val) : '') : '—'}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                    {displayDiffs.length === 0 && (
                      <tr>
                        <td colSpan={1 + headersA.length + headersB.length} style={{ textAlign: 'center', color: 'var(--text-dim)' }}>
                          {diffMode === 'diff_only' ? 'No differences found' : 'No rows'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn-primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
