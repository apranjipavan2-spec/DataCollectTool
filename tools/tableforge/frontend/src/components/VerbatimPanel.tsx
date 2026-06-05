import React, { useEffect, useMemo, useState } from 'react';
import { ColumnInfo } from '../types';
import { verbatimApi } from '../api';
import { ColOptions } from './ColPicker';
import { ProjectFilterBanner } from './ProjectFilterBanner';

interface Props {
  datasetId: string;
  columns: ColumnInfo[];
  projectFilters?: Record<string, string[]>;
  onClose: () => void;
}

type Mode = 'browse' | 'kappa';

interface CodePalette {
  name: string;
  color?: string;
  description?: string;
}

const COLORS = ['#a78bfa', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#84cc16', '#fb923c'];

export function VerbatimPanel({ datasetId, columns, projectFilters, onClose }: Props) {
  const [mode, setMode] = useState<Mode>('browse');
  const textCols = useMemo(() => columns.filter(c => c.type === 'text').map(c => c.name), [columns]);
  const [column, setColumn] = useState(textCols[0] || '');
  const [search, setSearch] = useState('');
  const [filterCode, setFilterCode] = useState('');
  const [palette, setPalette] = useState<CodePalette[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [counts, setCounts] = useState<Record<string, Record<string, number>>>({});
  const [newCode, setNewCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Kappa state
  const [coderA, setCoderA] = useState('');
  const [coderB, setCoderB] = useState('');
  const [weighted, setWeighted] = useState(false);
  const [kappaResult, setKappaResult] = useState<any>(null);

  const reload = async () => {
    if (!column) return;
    setLoading(true); setError(null);
    try {
      const res = await verbatimApi.list({
        dataset_id: datasetId, column, search: search || null,
        has_code: filterCode || null, page, page_size: 30,
        filters: projectFilters || {},
      });
      setRows(res.rows); setTotal(res.total);
      const ck = await verbatimApi.getCodes(datasetId);
      setPalette(ck.palette || []);
      setCounts(ck.counts || {});
    } catch (e: any) { setError(e.message || 'Failed'); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (mode === 'browse') reload(); }, [column, search, filterCode, page, mode]);

  const addCode = async () => {
    const name = newCode.trim();
    if (!name) return;
    if (palette.find(p => p.name === name)) { setNewCode(''); return; }
    const np = [...palette, { name, color: COLORS[palette.length % COLORS.length] }];
    setPalette(np);
    setNewCode('');
    await verbatimApi.savePalette({ dataset_id: datasetId, codes: np });
  };

  const toggleRowCode = async (rowIdx: number, code: string, currentCodes: string[]) => {
    const next = currentCodes.includes(code) ? currentCodes.filter(c => c !== code) : [...currentCodes, code];
    await verbatimApi.setCodes({ dataset_id: datasetId, column, row_idx: rowIdx, codes: next });
    setRows(prev => prev.map(r => r.row_idx === rowIdx ? { ...r, codes: next } : r));
  };

  const runKappa = async () => {
    setError(null); setKappaResult(null);
    if (!coderA || !coderB) { setError('Pick both coder columns'); return; }
    setLoading(true);
    try {
      const res = await verbatimApi.kappa({ dataset_id: datasetId, coder_a_col: coderA, coder_b_col: coderB, weighted, filters: projectFilters || {} });
      setKappaResult(res);
    } catch (e: any) { setError(e.message || 'Failed'); }
    finally { setLoading(false); }
  };

  const allCols = useMemo(() => columns.map(c => c.name), [columns]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content stat-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '95vw', width: 1000, maxHeight: '90vh' }}>
        <div className="modal-header">
          <div>
            <h2>💬 Verbatims & Open-End Coding</h2>
            <p className="modal-subtitle">Browse open-text responses, assign codes, and check inter-rater agreement (Cohen's κ).</p>
          </div>
          <button onClick={onClose} className="modal-close">×</button>
        </div>

        <div className="modal-body" style={{ overflowY: 'auto' }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <button className={`fp-btn ${mode === 'browse' ? '' : 'fp-btn-ghost'}`} onClick={() => setMode('browse')}>📖 Browse & Code</button>
            <button className={`fp-btn ${mode === 'kappa' ? '' : 'fp-btn-ghost'}`} onClick={() => setMode('kappa')}>🤝 Cohen's κ</button>
          </div>

          {mode === 'browse' && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1fr', gap: 8, marginBottom: 8 }}>
                <label className="stat-field">
                  <span>Text column</span>
                  <select value={column} onChange={e => { setColumn(e.target.value); setPage(0); }} className="fp-select">
                    <ColOptions allColumns={columns} available={columns.filter(c => textCols.includes(c.name))} placeholder="-- pick --" />
                  </select>
                </label>
                <label className="stat-field">
                  <span>Search text</span>
                  <input type="text" value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} className="fp-input" placeholder="filter quotes..." />
                </label>
                <label className="stat-field">
                  <span>Filter by code</span>
                  <select value={filterCode} onChange={e => { setFilterCode(e.target.value); setPage(0); }} className="fp-select">
                    <option value="">(any)</option>
                    {palette.map(p => <option key={p.name} value={p.name}>{p.name} ({counts[column]?.[p.name] ?? 0})</option>)}
                  </select>
                </label>
              </div>

              {/* Palette */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8, padding: 6, border: '1px solid var(--border)', borderRadius: 4 }}>
                {palette.map(p => (
                  <span key={p.name} style={{ background: p.color, color: '#fff', padding: '2px 8px', borderRadius: 10, fontSize: 11 }}>
                    {p.name} <span style={{ opacity: 0.7 }}>({counts[column]?.[p.name] ?? 0})</span>
                  </span>
                ))}
                <div style={{ display: 'flex', gap: 4 }}>
                  <input type="text" value={newCode} onChange={e => setNewCode(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addCode()}
                    placeholder="+ new code" className="fp-input" style={{ fontSize: 11, height: 22, width: 140 }} />
                  <button className="fp-btn-sm" onClick={addCode}>add</button>
                </div>
              </div>

              {error && <div className="stat-error">{error}</div>}
              {loading && <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>Loading…</div>}

              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 6 }}>
                {total} matching rows. Showing {rows.length} on page {page + 1}.
              </div>

              <div style={{ maxHeight: 380, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 4 }}>
                {rows.map(r => (
                  <div key={r.row_idx} style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 12, marginBottom: 4 }}>{r.text}</div>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                      <span style={{ fontSize: 9, color: 'var(--text-dim)' }}>#{r.row_idx}:</span>
                      {palette.map(p => {
                        const on = (r.codes || []).includes(p.name);
                        return (
                          <button key={p.name} onClick={() => toggleRowCode(r.row_idx, p.name, r.codes || [])}
                            style={{
                              background: on ? p.color : 'transparent',
                              color: on ? '#fff' : 'var(--text-dim)',
                              border: `1px solid ${p.color}`,
                              padding: '1px 7px', borderRadius: 9, fontSize: 10, cursor: 'pointer',
                            }}>{p.name}</button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
                <button className="fp-btn-sm" disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>← Prev</button>
                <button className="fp-btn-sm" disabled={(page + 1) * 30 >= total} onClick={() => setPage(p => p + 1)}>Next →</button>
                <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>page {page + 1} of {Math.max(1, Math.ceil(total / 30))}</span>
              </div>
            </>
          )}

          {mode === 'kappa' && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
                <label className="stat-field">
                  <span>Coder A column</span>
                  <select value={coderA} onChange={e => setCoderA(e.target.value)} className="fp-select">
                    <option value="">-- pick --</option>
                    {allCols.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <label className="stat-field">
                  <span>Coder B column</span>
                  <select value={coderB} onChange={e => setCoderB(e.target.value)} className="fp-select">
                    <option value="">-- pick --</option>
                    {allCols.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <label className="stat-field" style={{ alignSelf: 'end' }}>
                  <span><input type="checkbox" checked={weighted} onChange={e => setWeighted(e.target.checked)} /> Weighted (ordinal)</span>
                </label>
              </div>

              <button className="fp-btn" onClick={runKappa} disabled={loading}>
                {loading ? 'Computing…' : "Compute Cohen's κ"}
              </button>

              {error && <div className="stat-error">{error}</div>}

              {kappaResult && (
                <div className="stat-result" style={{ marginTop: 16 }}>
                  <div style={{ display: 'flex', gap: 24, marginBottom: 8 }}>
                    <div><span style={{ fontSize: 11, color: 'var(--text-dim)' }}>κ ({kappaResult.kappa_type})</span><div style={{ fontSize: 24, fontWeight: 700 }}>{kappaResult.kappa}</div></div>
                    <div><span style={{ fontSize: 11, color: 'var(--text-dim)' }}>95% CI</span><div style={{ fontSize: 14 }}>[{kappaResult.ci_95?.[0]}, {kappaResult.ci_95?.[1]}]</div></div>
                    <div><span style={{ fontSize: 11, color: 'var(--text-dim)' }}>% agreement</span><div style={{ fontSize: 14 }}>{kappaResult.pct_agreement}%</div></div>
                    <div><span style={{ fontSize: 11, color: 'var(--text-dim)' }}>N paired</span><div style={{ fontSize: 14 }}>{kappaResult.n_paired}</div></div>
                    <div><span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Interpretation</span><div style={{ fontSize: 14, fontWeight: 600 }}>{kappaResult.interpretation}</div></div>
                  </div>
                  <details>
                    <summary style={{ cursor: 'pointer', fontSize: 11, color: 'var(--text-dim)' }}>Show contingency matrix</summary>
                    <table className="stat-table" style={{ fontSize: 11, marginTop: 6 }}>
                      <thead><tr><th></th>{kappaResult.categories.map((c: string) => <th key={c}>B: {c}</th>)}</tr></thead>
                      <tbody>
                        {kappaResult.contingency.map((row: number[], i: number) => (
                          <tr key={i}><th>A: {kappaResult.categories[i]}</th>{row.map((v, j) => <td key={j}>{v}</td>)}</tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
