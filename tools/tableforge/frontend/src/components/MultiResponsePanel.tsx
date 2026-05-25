import React, { useEffect, useMemo, useState } from 'react';
import { ColumnInfo, ColumnRole } from '../types';
import { mrApi } from '../api';
import { Chart, adaptFrequencyToBar, adaptMatrixToHeatmap } from './Chart';
import { ColPicker, ColOptions } from './ColPicker';

interface Props {
  datasetId: string;
  columns: ColumnInfo[];
  columnRoles?: Record<string, ColumnRole>;
  onClose: () => void;
}

type Mode = 'frequencies' | 'cooccurrence' | 'by_group' | 'exclusive';
type SetKind = 'single' | 'dummies';

export function MultiResponsePanel({ datasetId, columns, columnRoles = {}, onClose }: Props) {
  const [mode, setMode] = useState<Mode>('frequencies');
  const [setKind, setSetKind] = useState<SetKind>('single');
  const [mrCol, setMrCol] = useState<string>('');
  const [mrCols, setMrCols] = useState<string[]>([]);
  const [separator, setSeparator] = useState(',');
  const [truthy, setTruthy] = useState('1,true,yes,y,t');
  const [groupCol, setGroupCol] = useState<string>('');
  const [correction, setCorrection] = useState<'bonferroni' | 'fdr_bh' | 'holm'>('fdr_bh');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Detect MR-tagged columns first; fall back to multi_choice-typed columns
  const detectedMrSingle = useMemo(() => {
    const tagged = Object.entries(columnRoles)
      .filter(([, r]) => r?.scale === 'multi_response' && !r?.mr_set_id)
      .map(([c]) => c);
    const multiChoice = columns.filter(c => c.type === 'multi_choice').map(c => c.name);
    return Array.from(new Set([...tagged, ...multiChoice]));
  }, [columns, columnRoles]);

  const detectedMrDummies = useMemo(() => {
    const byGroup: Record<string, string[]> = {};
    for (const [col, role] of Object.entries(columnRoles)) {
      if (role?.mr_set_id) {
        const g = role.mr_set_id;
        (byGroup[g] = byGroup[g] || []).push(col);
      }
    }
    return byGroup;
  }, [columnRoles]);

  const allCategoricalCols = useMemo(
    () => columns.filter(c => c.type !== 'numeric').map(c => c.name),
    [columns],
  );

  const allCols = useMemo(() => columns.map(c => c.name), [columns]);

  useEffect(() => {
    setResult(null);
    setError(null);
  }, [mode]);

  const toggleDummy = (c: string) => {
    setMrCols(p => (p.includes(c) ? p.filter(x => x !== c) : [...p, c]));
    setResult(null);
  };

  const ready = () => {
    if (setKind === 'single') return !!mrCol;
    return mrCols.length >= 2;
  };

  const run = async () => {
    if (!ready()) {
      setError(setKind === 'single' ? 'Pick an MR column' : 'Pick ≥2 dummy columns');
      return;
    }
    if (mode === 'by_group' && !groupCol) {
      setError('Pick a group column');
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const base: any = { dataset_id: datasetId, separator, truthy: truthy.split(',').map(s => s.trim()) };
      if (setKind === 'single') base.mr_col = mrCol;
      else base.mr_cols = mrCols;
      if (mode === 'by_group') { base.group_col = groupCol; base.correction = correction; }
      let r: any;
      if (mode === 'frequencies') r = await mrApi.frequencies(base);
      else if (mode === 'cooccurrence') r = await mrApi.cooccurrence(base);
      else if (mode === 'by_group') r = await mrApi.byGroup(base);
      else r = await mrApi.exclusive(base);
      setResult(r);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // For co-occurrence: matrix rendering with Jaccard intensity
  const renderCooccurMatrix = (headers: string[], rows: any[][]) => {
    const max = 1.0; // Jaccard is bounded [0,1]
    return (
      <div style={{ overflow: 'auto', marginBottom: 12 }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 10 }}>
          <thead>
            <tr>{headers.map((h, i) => (
              <th key={i} style={{ padding: '4px 6px', background: 'var(--bg-alt, #1e293b)', border: '1px solid var(--border, #334155)', whiteSpace: 'nowrap', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis' }}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => {
                  let bg = 'transparent';
                  if (ci > 0 && typeof cell === 'number' && ri !== ci - 1) {
                    const v = cell / max;
                    bg = `rgba(34, 197, 94, ${Math.min(v, 1) * 0.7})`;
                  } else if (ci === 0) {
                    bg = 'var(--bg-alt, #1e293b)';
                  }
                  return (
                    <td key={ci} style={{
                      padding: '3px 6px', border: '1px solid var(--border, #334155)',
                      background: bg, textAlign: ci === 0 ? 'left' : 'right',
                      whiteSpace: 'nowrap', fontWeight: ci === 0 ? 600 : 400,
                      maxWidth: ci === 0 ? 130 : undefined, overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {cell != null ? String(cell) : ''}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()} style={{ maxWidth: '95vw', width: 1000, maxHeight: '90vh' }}>
        <div className="modal-header">
          <h2>☑️ Multi-Response Analysis</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body" style={{ maxHeight: 'calc(90vh - 80px)', overflow: 'auto' }}>
          {/* Mode tabs */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 14, borderBottom: '1px solid var(--border, #334155)' }}>
            {(['frequencies', 'cooccurrence', 'by_group', 'exclusive'] as Mode[]).map(m => (
              <button key={m}
                onClick={() => setMode(m)}
                style={{
                  background: mode === m ? 'var(--accent, #3b82f6)' : 'transparent',
                  color: mode === m ? 'white' : 'var(--text, #e2e8f0)',
                  border: 'none', padding: '6px 14px', borderRadius: '6px 6px 0 0',
                  cursor: 'pointer', fontSize: 12, fontWeight: 600, textTransform: 'capitalize',
                }}>
                {m === 'by_group' ? 'By group' : m === 'cooccurrence' ? 'Co-occurrence' : m}
              </button>
            ))}
          </div>

          <p style={{ color: 'var(--text-dim)', fontSize: 12, marginBottom: 10 }}>
            {mode === 'frequencies'  && '% of respondents choosing each option (denominator = N respondents) and per-respondent count distribution.'}
            {mode === 'cooccurrence' && 'Jaccard similarity matrix + top pairs of options frequently chosen together.'}
            {mode === 'by_group'     && 'Per-option χ² across a grouping variable with multi-test correction and Cramér\u0027s V.'}
            {mode === 'exclusive'    && '% of respondents who chose each option exclusively (no other options).'}
          </p>

          {/* Set kind picker */}
          <div style={{ display: 'flex', gap: 16, marginBottom: 12, fontSize: 12, alignItems: 'center' }}>
            <label>
              <input type="radio" checked={setKind === 'single'} onChange={() => { setSetKind('single'); setResult(null); }} />
              &nbsp;Single column (comma-separated)
            </label>
            <label>
              <input type="radio" checked={setKind === 'dummies'} onChange={() => { setSetKind('dummies'); setResult(null); }} />
              &nbsp;Dummy columns (one per option)
            </label>
          </div>

          {setKind === 'single' && (
            <div style={{ display: 'flex', gap: 16, marginBottom: 12, fontSize: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <label>MR column:&nbsp;
                <select value={mrCol} onChange={e => { setMrCol(e.target.value); setResult(null); }}>
                  <option value="">(pick one)</option>
                  {detectedMrSingle.length > 0 && (
                    <optgroup label="Detected">
                      <ColOptions allColumns={columns} available={columns.filter(c => detectedMrSingle.includes(c.name))} />
                    </optgroup>
                  )}
                  <optgroup label="All columns">
                    <ColOptions allColumns={columns} available={columns} />
                  </optgroup>
                </select>
              </label>
              <label>Separator:&nbsp;<input value={separator} onChange={e => setSeparator(e.target.value)} style={{ width: 40 }} /></label>
            </div>
          )}

          {setKind === 'dummies' && (
            <>
              {Object.keys(detectedMrDummies).length > 0 && (
                <div style={{ marginBottom: 10, fontSize: 11 }}>
                  <span style={{ color: 'var(--text-dim)' }}>Detected MR sets: </span>
                  {Object.entries(detectedMrDummies).map(([gid, cols]) => (
                    <button key={gid}
                      className="btn-small"
                      style={{ marginLeft: 6, fontSize: 10 }}
                      onClick={() => { setMrCols(cols); setResult(null); }}>
                      {gid} ({cols.length} cols)
                    </button>
                  ))}
                </div>
              )}
              <div style={{ marginBottom: 8 }}>
                <ColPicker
                  allColumns={columns}
                  available={columns}
                  selected={mrCols}
                  label={`Dummy columns (≥2 required, ${mrCols.length} selected)`}
                  height={160}
                  onToggle={toggleDummy}
                />
              </div>
              <div style={{ display: 'flex', gap: 16, marginBottom: 12, fontSize: 11, color: 'var(--text-dim)' }}>
                <label>Truthy values (comma-sep):&nbsp;
                  <input value={truthy} onChange={e => setTruthy(e.target.value)} style={{ width: 200 }} />
                </label>
              </div>
            </>
          )}

          {mode === 'by_group' && (
            <div style={{ display: 'flex', gap: 16, marginBottom: 12, fontSize: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <label>Group column:&nbsp;
                <select value={groupCol} onChange={e => setGroupCol(e.target.value)}>
                  <option value="">(pick one)</option>
                  {allCategoricalCols.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label>Correction:&nbsp;
                <select value={correction} onChange={e => setCorrection(e.target.value as any)}>
                  <option value="fdr_bh">Benjamini-Hochberg FDR</option>
                  <option value="bonferroni">Bonferroni</option>
                  <option value="holm">Holm</option>
                </select>
              </label>
            </div>
          )}

          <button className="btn-primary" onClick={run}
            disabled={loading || !ready() || (mode === 'by_group' && !groupCol)}
            style={{ marginBottom: 16 }}>
            {loading ? 'Computing…' : `Run ${mode === 'by_group' ? 'by group' : mode}`}
          </button>

          {error && <div className="error-msg" style={{ marginBottom: 10 }}>{error}</div>}

          {/* Frequency summary banner */}
          {mode === 'frequencies' && result?.n_respondents !== undefined && (
            <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>
              N respondents = <strong>{result.n_respondents}</strong> · Total responses = <strong>{result.total_responses}</strong>
            </div>
          )}

          {/* Frequencies bar chart */}
          {mode === 'frequencies' && result?.headers && (() => {
            const data = adaptFrequencyToBar(result.headers, result.rows);
            return data ? (
              <div style={{ marginBottom: 12 }}>
                <Chart kind="bar" data={data} title="Option uptake (count of respondents)" />
              </div>
            ) : null;
          })()}

          {/* Co-occurrence: recharts heatmap (interactive) */}
          {mode === 'cooccurrence' && result?.headers && (() => {
            const data = adaptMatrixToHeatmap(result.headers, result.rows, 'sequential');
            return data ? (
              <div style={{ marginBottom: 12 }}>
                <Chart kind="heatmap" data={data} title="Co-occurrence (Jaccard similarity)" height={Math.max(320, data.yLabels.length * 36 + 80)} />
              </div>
            ) : null;
          })()}

          {/* Co-occurrence matrix (legacy table render — kept as fallback / numeric reference) */}
          {mode === 'cooccurrence' && result?.headers && renderCooccurMatrix(result.headers, result.rows)}

          {/* Top co-occurring pairs */}
          {mode === 'cooccurrence' && result?.pair_rows && result.pair_rows.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 6 }}>Top co-occurring pairs</div>
              <table className="result-table" style={{ fontSize: 12 }}>
                <thead>
                  <tr>{result.pair_headers.map((h: string, i: number) => (
                    <th key={i} style={{ padding: '5px 10px', fontSize: 11 }}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {result.pair_rows.map((row: any[], ri: number) => (
                    <tr key={ri}>{row.map((cell, ci) => (
                      <td key={ci} style={{ padding: '4px 10px', fontSize: 12 }}>{cell != null ? String(cell) : ''}</td>
                    ))}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Per-respondent count distribution (frequencies mode) */}
          {mode === 'frequencies' && result?.distribution_rows && result.distribution_rows.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 6 }}>How many options each respondent chose</div>
              <table className="result-table" style={{ fontSize: 12 }}>
                <thead>
                  <tr>{result.distribution_headers.map((h: string, i: number) => (
                    <th key={i} style={{ padding: '5px 10px', fontSize: 11 }}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {result.distribution_rows.map((row: any[], ri: number) => (
                    <tr key={ri}>{row.map((cell, ci) => (
                      <td key={ci} style={{ padding: '4px 10px', fontSize: 12 }}>{cell != null ? String(cell) : ''}</td>
                    ))}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Main results table — skipped for cooccurrence which uses matrix render */}
          {mode !== 'cooccurrence' && result?.headers && (
            <div style={{ overflow: 'auto' }}>
              <table className="result-table" style={{ fontSize: 12 }}>
                <thead>
                  <tr>{result.headers.map((h: string, i: number) => (
                    <th key={i} style={{ padding: '6px 10px', fontSize: 11 }}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {result.rows.map((row: any[], ri: number) => (
                    <tr key={ri}>
                      {row.map((cell: any, ci: number) => {
                        const style: React.CSSProperties = { padding: '5px 10px', fontSize: 12 };
                        if (typeof cell === 'string' && ['***', '**', '*'].includes(cell)) {
                          style.color = cell === '***' ? '#ef4444' : cell === '**' ? '#f59e0b' : '#22c55e';
                          style.fontWeight = 700;
                        }
                        return <td key={ci} style={style}>{cell != null ? String(cell) : ''}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {result?.interpretation && (
            <div style={{ marginTop: 12, padding: '8px 12px', background: 'var(--bg-alt, #1e293b)',
              borderRadius: 6, fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5,
              border: '1px solid var(--border, #334155)' }}>
              <strong>Interpretation:</strong> {result.interpretation}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
