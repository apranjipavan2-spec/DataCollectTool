import React, { useEffect, useState } from 'react';
import { QualityReport } from '../types';
import { getDataQuality, API_BASE } from '../api';

interface Props {
  datasetId: string;
  onClose: () => void;
  onDataChanged?: () => void;
}

export function DataQualityPanel({ datasetId, onClose, onDataChanged }: Props) {
  const [report, setReport] = useState<QualityReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'issues'>('all');
  const [drillDown, setDrillDown] = useState<{ column: string; issueType: string; headers: string[]; rows: any[][]; row_count: number } | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);
  const [cleanMsg, setCleanMsg] = useState<string | null>(null);
  const [typeModal, setTypeModal] = useState<{ column: string; info: any } | null>(null);

  const showDrillDown = async (column: string, issueType: string) => {
    setDrillLoading(true);
    try {
      const res = await fetch(`${API_BASE}/quality/${datasetId}/drilldown?column=${encodeURIComponent(column)}&issue_type=${issueType}`);
      if (res.ok) { const data = await res.json(); setDrillDown({ ...data, column, issueType }); }
    } catch {} finally { setDrillLoading(false); }
  };

  const refreshReport = () => {
    setLoading(true);
    getDataQuality(datasetId).then(setReport).finally(() => setLoading(false));
  };

  useEffect(() => { refreshReport(); }, [datasetId]);

  const statusIcon = (s: string) => s === 'green' ? '🟢' : s === 'yellow' ? '🟡' : '🔴';
  const statusLabel = (s: string) => s === 'green' ? 'Clean' : s === 'yellow' ? 'Warning' : 'Error';

  const displayCols = filter === 'issues'
    ? (report?.columns || []).filter(c => c.status !== 'green')
    : (report?.columns || []);

  // -- Cleaning actions --
  const handleCleanAction = async (action: string, column?: string, extra?: Record<string, any>) => {
    setCleanMsg(null);
    try {
      const res = await fetch(`${API_BASE}/dataset/clean_bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dataset_id: datasetId,
          actions: [{ action, column, ...extra }],
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setCleanMsg(data.messages?.join('; ') || 'Done');
        refreshReport();
        onDataChanged?.();
      } else {
        const err = await res.text();
        setCleanMsg('Error: ' + err);
      }
    } catch (e: any) {
      setCleanMsg('Error: ' + e.message);
    }
  };

  const handleCheckType = async (column: string) => {
    try {
      const res = await fetch(`${API_BASE}/dataset/${datasetId}/column/${encodeURIComponent(column)}/type_info`);
      if (res.ok) {
        const info = await res.json();
        setTypeModal({ column, info });
      }
    } catch {}
  };

  const handleConvertType = async (column: string, targetType: string, action: string) => {
    try {
      const res = await fetch(`${API_BASE}/dataset/clean_column`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataset_id: datasetId, column, target_type: targetType, action }),
      });
      if (res.ok) {
        const data = await res.json();
        setCleanMsg(data.message);
        setTypeModal(null);
        refreshReport();
        onDataChanged?.();
      }
    } catch (e: any) {
      setCleanMsg('Error: ' + e.message);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Data Quality & Cleaning</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body" style={{ position: 'relative' }}>
          {cleanMsg && (
            <div style={{ padding: '8px 12px', marginBottom: 10, background: 'rgba(59,130,246,0.1)', border: '1px solid var(--primary)', borderRadius: 6, fontSize: 13 }}>
              {cleanMsg}
              <button style={{ marginLeft: 12, background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer' }}
                onClick={() => setCleanMsg(null)}>×</button>
            </div>
          )}
          {loading ? (
            <div className="loading-spinner">Analyzing data quality...</div>
          ) : report ? (
            <>
              <div className="quality-summary">
                <div className="quality-stat">
                  <span className="quality-num">{report.total_rows.toLocaleString()}</span>
                  <span>Total Rows</span>
                </div>
                <div className="quality-stat">
                  <span className="quality-num">{report.duplicate_rows}</span>
                  <span>Duplicate Rows</span>
                </div>
                <div className="quality-stat q-green">
                  <span className="quality-num">{report.columns.filter(c => c.status === 'green').length}</span>
                  <span>Clean Columns</span>
                </div>
                <div className="quality-stat q-yellow">
                  <span className="quality-num">{report.columns.filter(c => c.status === 'yellow').length}</span>
                  <span>Warnings</span>
                </div>
                <div className="quality-stat q-red">
                  <span className="quality-num">{report.columns.filter(c => c.status === 'red').length}</span>
                  <span>Errors</span>
                </div>
              </div>

              {/* Quick clean actions */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                {report.duplicate_rows > 0 && (
                  <button className="btn-secondary" style={{ fontSize: 12 }}
                    onClick={() => handleCleanAction('remove_duplicates')}>
                    Remove {report.duplicate_rows} Duplicates
                  </button>
                )}
                <button className="btn-secondary" style={{ fontSize: 12 }}
                  onClick={refreshReport}>
                  Refresh Report
                </button>
              </div>

              <div className="quality-filter-bar">
                <button className={`btn-toggle ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>All Columns</button>
                <button className={`btn-toggle ${filter === 'issues' ? 'active' : ''}`} onClick={() => setFilter('issues')}>
                  Issues Only ({report.columns.filter(c => c.status !== 'green').length})
                </button>
              </div>

              <table className="quality-table">
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Column</th>
                    <th>Nulls</th>
                    <th>Null %</th>
                    <th>Unique</th>
                    <th>Outliers</th>
                    <th>Issues / Fix Suggestion</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {displayCols.map(c => (
                    <tr key={c.column} className={c.status !== 'green' ? `quality-row-${c.status}` : ''}>
                      <td title={statusLabel(c.status)}>{statusIcon(c.status)}</td>
                      <td><strong>{c.column}</strong></td>
                      <td className="num-cell">{c.nulls.toLocaleString()}</td>
                      <td className="num-cell">{c.null_pct}%</td>
                      <td className="num-cell">{c.unique.toLocaleString()}</td>
                      <td className="num-cell">{c.outliers || 0}</td>
                      <td>
                        {c.issues.length > 0 ? (
                          <div>
                            <span>{c.issues.join('; ')}</span>
                            {c.nulls > 0 && (
                              <button className="drill-link" onClick={() => showDrillDown(c.column, 'nulls')}>🔍 View null rows</button>
                            )}
                            {(c.outliers || 0) > 0 && (
                              <button className="drill-link" onClick={() => showDrillDown(c.column, 'outliers')}>🔍 View outlier rows</button>
                            )}
                          </div>
                        ) : '—'}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {c.nulls > 0 && (
                            <select style={{ fontSize: 11, padding: '2px 4px', background: 'var(--bg-card)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4 }}
                              defaultValue=""
                              onChange={e => { if (e.target.value) handleCleanAction('fill_nulls', c.column, { method: e.target.value }); e.target.value = ''; }}>
                              <option value="" disabled>Fill Nulls...</option>
                              <option value="median">Median</option>
                              <option value="mean">Mean</option>
                              <option value="mode">Mode</option>
                              <option value="zero">Zero</option>
                              <option value="empty">Empty</option>
                            </select>
                          )}
                          {(c.outliers || 0) > 0 && (
                            <button className="drill-link" style={{ fontSize: 11 }}
                              onClick={() => handleCleanAction('remove_outliers', c.column)}>
                              Remove Outliers
                            </button>
                          )}
                          {(c.type_mismatch || 0) > 0 && (
                            <button className="drill-link" style={{ fontSize: 11 }}
                              onClick={() => handleCheckType(c.column)}>
                              Fix Type
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <div className="error-msg">Failed to load quality report</div>
          )}

          {drillDown && (
            <div className="drilldown-overlay" style={{ position: 'absolute', inset: 0, background: 'var(--bg-0)', zIndex: 5, display: 'flex', flexDirection: 'column', padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h3>Drill-Down: {drillDown.column} — {drillDown.issueType} ({drillDown.row_count} rows)</h3>
                <button className="btn-secondary" onClick={() => setDrillDown(null)}>← Back</button>
              </div>
              {drillLoading ? <div className="loading-spinner">Loading...</div> : (
                <div style={{ overflow: 'auto', flex: 1 }}>
                  <table className="result-table">
                    <thead><tr>{drillDown.headers.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
                    <tbody>
                      {drillDown.rows.map((row, ri) => (
                        <tr key={ri}>{row.map((cell: any, ci: number) => <td key={ci}>{cell != null ? String(cell) : ''}</td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                  {drillDown.row_count > 50 && <div className="hint-text" style={{ marginTop: 8 }}>Showing first 50 of {drillDown.row_count} rows</div>}
                </div>
              )}
            </div>
          )}

          {/* Type validation modal */}
          {typeModal && (
            <div className="drilldown-overlay" style={{ position: 'absolute', inset: 0, background: 'var(--bg-0)', zIndex: 6, display: 'flex', flexDirection: 'column', padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h3>Data Type: {typeModal.column}</h3>
                <button className="btn-secondary" onClick={() => setTypeModal(null)}>← Back</button>
              </div>
              <div style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <strong>Current type:</strong> {typeModal.info.current_dtype}<br />
                  <strong>Detected dominant type:</strong> {typeModal.info.detected_type}<br />
                  <strong>Mixed types:</strong> {typeModal.info.mixed ? 'Yes' : 'No'}
                </div>
                <div style={{ display: 'flex', gap: 16 }}>
                  {Object.entries(typeModal.info.type_counts as Record<string, number>).map(([type, count]) => (
                    <div key={type} style={{ padding: '6px 12px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6 }}>
                      <div style={{ fontSize: 16, fontWeight: 700 }}>{count}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{type}</div>
                    </div>
                  ))}
                </div>
                {typeModal.info.non_conforming_samples?.length > 0 && (
                  <div>
                    <strong>Non-conforming samples:</strong>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                      {typeModal.info.non_conforming_samples.map((s: string, i: number) => (
                        <span key={i} style={{ padding: '2px 8px', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 4, fontSize: 12 }}>
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <div>
                  <strong>What should this column be?</strong>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    {['numeric', 'date', 'text'].map(t => (
                      <div key={t} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12, flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ fontWeight: 600, textTransform: 'capitalize' }}>{t}</div>
                        <button className="btn-primary" style={{ fontSize: 11, padding: '4px 8px' }}
                          onClick={() => handleConvertType(typeModal.column, t, 'coerce')}>
                          Convert (set invalid to blank)
                        </button>
                        <button className="btn-secondary" style={{ fontSize: 11, padding: '4px 8px' }}
                          onClick={() => handleConvertType(typeModal.column, t, 'exclude')}>
                          Exclude non-{t} rows
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="modal-footer" style={{ gap: 8 }}>
          <button className="btn-secondary" onClick={() => {
            if (!report) return;
            const lines = [
              `Data Quality Report`,
              `Generated: ${new Date().toLocaleString()}`,
              `Total Rows: ${report.total_rows} | Duplicate Rows: ${report.duplicate_rows}`,
              '',
              'Column,Status,Nulls,Null%,Unique,Outliers,Issues',
              ...report.columns.map(c =>
                `"${c.column}",${c.status},${c.nulls},${c.null_pct.toFixed(1)}%,${c.unique},${c.outliers || 0},"${c.issues.join('; ')}"`
              ),
            ];
            const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = `quality_report_${datasetId}.csv`; a.click();
            URL.revokeObjectURL(url);
          }} disabled={!report}>Export CSV</button>
          <button className="btn-primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
