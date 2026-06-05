import React, { useEffect, useState, Fragment } from 'react';
import { dryRunColumnType } from '../api';

interface Props {
  datasetId: string;
  column: string;
  newType: 'numeric' | 'date' | 'text' | 'multi_choice' | 'boolean';
  onCancel: () => void;
  onApply: () => void;
  onOpenInCleaner?: () => void;
  onViewRow?: (rowIdx: number) => void;
}

interface DryRun {
  total: number;
  non_null: number;
  fail_count: number;
  samples: string[];
  failing_cells?: { row: number; value: string; context?: Record<string, string> }[];
  context_columns?: string[];
}

function splitColumnName(name: string): string[] {
  // Split combined headers like "BEN: a > b > c NB: x > y > z" into readable lines.
  const parts = name.split(/\s+(?=[A-Z]{2,4}:\s)/g);
  return parts.length > 1 ? parts : [name];
}

function classifyFailure(value: string, newType: string): string {
  const raw = value ?? '';
  const s = String(raw).trim();
  if (!s) return 'Empty';
  if (newType === 'numeric') {
    if (/^[a-zA-Z]+$/.test(s)) return 'Text only';
    if (/[a-zA-Z]/.test(s)) return 'Has letters';
    if (/^[^\d.+\-]+$/.test(s)) return 'No digits';
    if (s.includes('/') || s.includes('-') && /\d+[\/-]\d+/.test(s)) return 'Looks like a date';
    if (/[(),%]/.test(s)) return 'Has symbols';
    return 'Bad number format';
  }
  if (newType === 'date') {
    if (/^[a-zA-Z]+$/.test(s)) return 'Text only';
    if (/^\d+$/.test(s)) return 'Just a number';
    return 'Unrecognized date';
  }
  return 'Cannot convert';
}

export function TypeConvertModal({ datasetId, column, newType, onCancel, onApply, onOpenInCleaner, onViewRow }: Props) {
  const [data, setData] = useState<DryRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null); setData(null);
    dryRunColumnType(datasetId, column, newType)
      .then(r => { if (!cancelled) setData(r); })
      .catch(e => { if (!cancelled) setError(e?.message || 'Dry-run failed'); });
    return () => { cancelled = true; };
  }, [datasetId, column, newType]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const nameLines = splitColumnName(column);
  const targetLabel = newType === 'numeric' ? '🔢 Numeric'
                    : newType === 'date' ? '📅 Date'
                    : newType === 'boolean' ? '☑ Boolean'
                    : newType;
  const total = data?.total ?? 0;
  const nonNull = data?.non_null ?? 0;
  const fail = data?.fail_count ?? 0;
  const willConvert = Math.max(nonNull - fail, 0);
  const successPct = nonNull > 0 ? Math.round((willConvert / nonNull) * 100) : 0;
  const failing = data?.failing_cells || [];

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal modal-lg" style={{ width: '960px', maxWidth: '95vw' }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>
              Convert column → <span style={{ color: 'var(--primary)' }}>{targetLabel}</span>
            </h2>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4, lineHeight: 1.5, maxWidth: 620, wordBreak: 'break-word' }}>
              {nameLines.map((ln, i) => <div key={i}>{ln}</div>)}
            </div>
          </div>
          <button className="modal-close" onClick={onCancel} title="Close (Esc)">×</button>
        </div>

        <div className="modal-body" style={{ padding: 16 }}>
          {error && (
            <div style={{ padding: 12, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.35)', borderRadius: 6, color: '#fca5a5', fontSize: 12, marginBottom: 12 }}>
              {error}
            </div>
          )}
          {!data && !error && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 }}>
              Analyzing column…
            </div>
          )}
          {data && (
            <>
              {/* Stats grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 14 }}>
                <StatCard label="Total rows" value={total} />
                <StatCard label="Non-empty" value={nonNull} />
                <StatCard label="Will convert" value={willConvert} accent="ok" />
                <StatCard label="Will fail" value={fail} accent={fail > 0 ? 'err' : 'ok'} />
              </div>

              {/* Success bar */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                  <span style={{ color: 'var(--text-dim)' }}>Parse success</span>
                  <span style={{ fontWeight: 600 }}>{successPct}%</span>
                </div>
                <div style={{ height: 8, background: 'rgba(255,255,255,0.05)', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{
                    width: `${successPct}%`, height: '100%',
                    background: successPct >= 95 ? '#22c55e' : successPct >= 80 ? '#eab308' : '#ef4444',
                    transition: 'width 0.3s',
                  }} />
                </div>
              </div>

              {/* Failing cells table */}
              {fail > 0 ? (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#fca5a5' }}>
                      ⚠ Cells that won't parse as {newType} ({fail} total{failing.length < fail ? `, showing first ${failing.length}` : ''})
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                      These become blanks after conversion
                    </div>
                  </div>
                  {data.context_columns && data.context_columns.length > 0 && (
                    <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 4, fontStyle: 'italic' }}>
                      Each row below shows the failing value in <strong style={{ color: '#fca5a5' }}>{(nameLines[0] || column).split(/\s+>\s+/).pop()}</strong>,
                      with neighbouring identifying columns ({data.context_columns.map(c => {
                        const parts = c.split(/\s+>\s+/);
                        return parts[parts.length - 1];
                      }).join(' · ')}) so you can spot which respondent / record it belongs to.
                    </div>
                  )}
                  <div style={{
                    maxHeight: 320, overflow: 'auto',
                    border: '1px solid var(--border)', borderRadius: 6,
                    background: 'rgba(0,0,0,0.18)',
                  }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-card)', zIndex: 1 }}>
                        <tr>
                          <th style={{ textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid var(--border)', width: 56, color: 'var(--text-dim)', fontWeight: 600 }}>Row</th>
                          <th title={column}
                            style={{ textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid var(--border)', minWidth: 140, color: 'var(--text-dim)', fontWeight: 600 }}>
                            Value in <span style={{ color: '#fca5a5' }}>{(nameLines[0] || column).split(/\s+>\s+/).pop()}</span>
                          </th>
                          <th style={{ textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid var(--border)', width: 130, color: 'var(--text-dim)', fontWeight: 600 }}>Why it failed</th>
                          {data.context_columns && data.context_columns.map(cc => {
                            const short = cc.split(/\s+>\s+/).pop() || cc;
                            return (
                              <th key={cc} title={cc}
                                style={{ textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid var(--border)', color: 'var(--text-dim)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                                {short}
                              </th>
                            );
                          })}
                          <th style={{ textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid var(--border)', width: 70, color: 'var(--text-dim)', fontWeight: 600 }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {failing.map((c, i) => {
                          const reason = classifyFailure(c.value, newType);
                          const isOpen = expandedRow === c.row;
                          const colSpan = 4 + (data.context_columns?.length || 0);
                          return (
                            <Fragment key={i}>
                              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                                <td style={{ padding: '5px 10px', fontFamily: 'monospace', color: 'var(--text-dim)' }}>{c.row + 1}</td>
                                <td style={{ padding: '5px 10px', fontFamily: 'monospace', color: '#fca5a5', wordBreak: 'break-all' }}>{c.value || <em style={{ color: 'var(--text-dim)' }}>(empty)</em>}</td>
                                <td style={{ padding: '5px 10px', color: '#fbbf24', fontSize: 11 }}>{reason}</td>
                                {data.context_columns && data.context_columns.map(cc => (
                                  <td key={cc} style={{ padding: '5px 10px', fontFamily: 'monospace', color: 'var(--text)', whiteSpace: 'nowrap', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}
                                    title={c.context?.[cc] || ''}>
                                    {c.context?.[cc] || <em style={{ color: 'var(--text-dim)' }}>—</em>}
                                  </td>
                                ))}
                                <td style={{ padding: '5px 10px', whiteSpace: 'nowrap' }}>
                                  <button
                                    onClick={() => setExpandedRow(isOpen ? null : c.row)}
                                    title={isOpen ? 'Collapse details' : 'Show all available row context here'}
                                    style={{ background: 'none', border: 'none', color: '#93c5fd', fontSize: 11, cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>
                                    {isOpen ? 'Hide' : 'Details'}
                                  </button>
                                </td>
                              </tr>
                              {isOpen && (
                                <tr style={{ background: 'rgba(59,130,246,0.06)' }}>
                                  <td colSpan={colSpan} style={{ padding: '10px 14px 12px' }}>
                                    <div style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                                      Row {c.row + 1} — all available context
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 14px', fontSize: 11, alignItems: 'baseline' }}>
                                      <div style={{ color: '#fca5a5', fontWeight: 600 }}>{(nameLines[0] || column).split(/\s+>\s+/).pop()}</div>
                                      <div style={{ fontFamily: 'monospace', color: '#fca5a5', wordBreak: 'break-all' }}>
                                        {c.value || <em style={{ color: 'var(--text-dim)' }}>(empty)</em>} <span style={{ color: '#fbbf24', marginLeft: 6 }}>← {reason}</span>
                                      </div>
                                      {data.context_columns && data.context_columns.map(cc => (
                                        <Fragment key={cc}>
                                          <div style={{ color: 'var(--text-dim)' }} title={cc}>{cc.split(/\s+>\s+/).pop()}</div>
                                          <div style={{ fontFamily: 'monospace', color: 'var(--text)', wordBreak: 'break-all' }}>
                                            {c.context?.[cc] || <em style={{ color: 'var(--text-dim)' }}>—</em>}
                                          </div>
                                        </Fragment>
                                      ))}
                                    </div>
                                    {onViewRow && (
                                      <div style={{ marginTop: 10 }}>
                                        <button
                                          onClick={() => onViewRow(c.row)}
                                          title="Close this modal and open Data Preview at this row (note: many-column datasets may scroll horizontally)"
                                          style={{ background: 'transparent', border: '1px solid var(--border)', color: '#93c5fd', fontSize: 11, padding: '3px 8px', borderRadius: 4, cursor: 'pointer' }}>
                                          Open in Data Preview →
                                        </button>
                                      </div>
                                    )}
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div style={{ padding: 14, background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 6, fontSize: 12, color: '#86efac' }}>
                  ✓ All {nonNull} non-empty cells parse cleanly as {newType}. Safe to convert.
                </div>
              )}

              <div style={{ marginTop: 14, padding: 10, background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.25)', borderRadius: 6, fontSize: 11, color: 'var(--text-dim)' }}>
                <strong style={{ color: 'var(--text)' }}>This conversion is recorded.</strong> It will be saved into your project file and appear in the Audit Trail. You can revert it later from the column type selector.
              </div>
            </>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
          {onOpenInCleaner && fail > 0 && (
            <button className="btn-secondary"
              style={{ background: 'linear-gradient(135deg,#a78bfa,#7c3aed)', color: '#fff', border: 'none' }}
              onClick={() => { onOpenInCleaner(); }}
              disabled={busy}>
              🧹 Fix in Cleaner
            </button>
          )}
          <button className="btn-primary" onClick={() => { setBusy(true); onApply(); }} disabled={busy || !data}>
            Apply Conversion
          </button>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: number; accent?: 'ok' | 'err' }) {
  const color = accent === 'ok' ? '#86efac' : accent === 'err' ? '#fca5a5' : 'var(--text)';
  return (
    <div style={{ padding: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', borderRadius: 6 }}>
      <div style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color, marginTop: 4 }}>{value.toLocaleString()}</div>
    </div>
  );
}
