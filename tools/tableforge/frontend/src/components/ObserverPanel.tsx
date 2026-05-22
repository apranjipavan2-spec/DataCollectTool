import React, { useEffect, useMemo, useState } from 'react';
import { ColumnInfo, ColumnRole } from '../types';
import { observerApi } from '../api';

interface Props {
  datasetId: string;
  columns: ColumnInfo[];
  columnRoles?: Record<string, ColumnRole>;
  onClose: () => void;
}

type Mode = 'concordance' | 'discrepancies';

interface PairRow {
  self_col: string;
  observer_col: string;
  kind: '' | 'binary' | 'ordinal' | 'continuous';
  label: string;
}

export function ObserverPanel({ datasetId, columns, columnRoles = {}, onClose }: Props) {
  const [mode, setMode] = useState<Mode>('concordance');
  const [pairs, setPairs] = useState<PairRow[]>([]);
  const [discSelf, setDiscSelf] = useState('');
  const [discObs, setDiscObs] = useState('');
  const [idCols, setIdCols] = useState<string[]>([]);
  const [maxRows, setMaxRows] = useState(200);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allCols = useMemo(() => columns.map(c => c.name), [columns]);

  // Auto-suggest pairs from column_roles: any observer_rated column whose paired_with points to another existing col
  const suggestedPairs = useMemo<PairRow[]>(() => {
    const out: PairRow[] = [];
    for (const [col, role] of Object.entries(columnRoles)) {
      if (role?.role === 'observer_rated' && role.paired_with && allCols.includes(role.paired_with)) {
        out.push({
          self_col: role.paired_with,
          observer_col: col,
          kind: '',
          label: `${role.paired_with} ↔ ${col}`,
        });
      }
    }
    return out;
  }, [columnRoles, allCols]);

  useEffect(() => {
    if (pairs.length === 0 && suggestedPairs.length > 0) {
      setPairs(suggestedPairs);
    }
  }, [suggestedPairs]);

  useEffect(() => {
    setResult(null);
    setError(null);
  }, [mode]);

  const addPair = () => {
    setPairs(p => [...p, { self_col: '', observer_col: '', kind: '', label: '' }]);
  };
  const updatePair = (i: number, patch: Partial<PairRow>) => {
    setPairs(p => p.map((r, idx) => idx === i ? { ...r, ...patch } : r));
    setResult(null);
  };
  const removePair = (i: number) => {
    setPairs(p => p.filter((_, idx) => idx !== i));
    setResult(null);
  };
  const toggleIdCol = (c: string) => {
    setIdCols(p => (p.includes(c) ? p.filter(x => x !== c) : [...p, c]));
  };

  const run = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      if (mode === 'concordance') {
        const valid = pairs.filter(p => p.self_col && p.observer_col);
        if (valid.length === 0) throw new Error('Add at least one valid pair');
        const r = await observerApi.concordance({
          dataset_id: datasetId,
          pairs: valid.map(p => ({
            self_col: p.self_col,
            observer_col: p.observer_col,
            kind: p.kind || null,
            label: p.label || null,
          })),
        });
        setResult(r);
      } else {
        if (!discSelf || !discObs) throw new Error('Pick both self and observer columns');
        const r = await observerApi.discrepancies({
          dataset_id: datasetId,
          self_col: discSelf,
          observer_col: discObs,
          id_cols: idCols,
          max_rows: maxRows,
        });
        setResult(r);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()} style={{ maxWidth: 1100 }}>
        <div className="modal-header">
          <h2>👁️ Observer-vs-Respondent Reconciliation</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body" style={{ maxHeight: '78vh', overflow: 'auto' }}>
          {/* Mode tabs */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 14, borderBottom: '1px solid var(--border, #334155)' }}>
            {(['concordance', 'discrepancies'] as Mode[]).map(m => (
              <button key={m}
                onClick={() => setMode(m)}
                style={{
                  background: mode === m ? 'var(--accent, #3b82f6)' : 'transparent',
                  color: mode === m ? 'white' : 'var(--text, #e2e8f0)',
                  border: 'none', padding: '6px 14px', borderRadius: '6px 6px 0 0',
                  cursor: 'pointer', fontSize: 12, fontWeight: 600, textTransform: 'capitalize',
                }}>
                {m}
              </button>
            ))}
          </div>

          <p style={{ color: 'var(--text-dim)', fontSize: 12, marginBottom: 12 }}>
            {mode === 'concordance'
              ? '% agreement + Cohen\u0027s κ (weighted κ for ordinal, McNemar for paired binary, Bland-Altman for continuous).'
              : 'Drill into rows where the two sources disagree, ranked by magnitude.'}
          </p>

          {mode === 'concordance' && (
            <>
              <div style={{ marginBottom: 10, display: 'flex', gap: 10, alignItems: 'center' }}>
                <button className="btn-small btn-primary" onClick={addPair}>+ Add pair</button>
                {suggestedPairs.length > 0 && (
                  <button className="btn-small" onClick={() => setPairs(suggestedPairs)}>
                    Reset to detected ({suggestedPairs.length})
                  </button>
                )}
                <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                  {suggestedPairs.length > 0
                    ? 'Pairs auto-detected from observer_rated columns with paired_with.'
                    : 'Tag columns as observer_rated + paired_with in the Variables panel for auto-detection.'}
                </span>
              </div>

              {pairs.length === 0 && (
                <div style={{ fontSize: 12, color: 'var(--text-dim)', padding: 14, background: 'var(--bg-alt, #1e293b)', borderRadius: 6, marginBottom: 10 }}>
                  No pairs yet — click <strong>+ Add pair</strong> to define a self-report ↔ observer column comparison.
                </div>
              )}

              {pairs.map((p, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 110px 1fr 32px',
                                       gap: 6, marginBottom: 6, fontSize: 11, alignItems: 'center' }}>
                  <select value={p.self_col} onChange={e => updatePair(i, { self_col: e.target.value })}>
                    <option value="">— self-report —</option>
                    {allCols.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <select value={p.observer_col} onChange={e => updatePair(i, { observer_col: e.target.value })}>
                    <option value="">— observer —</option>
                    {allCols.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <select value={p.kind} onChange={e => updatePair(i, { kind: e.target.value as PairRow['kind'] })}>
                    <option value="">Auto-detect</option>
                    <option value="binary">Binary</option>
                    <option value="ordinal">Ordinal</option>
                    <option value="continuous">Continuous</option>
                  </select>
                  <input value={p.label} onChange={e => updatePair(i, { label: e.target.value })}
                    placeholder="Label (optional)" />
                  <button className="btn-small" onClick={() => removePair(i)} style={{ padding: '2px 8px' }}>×</button>
                </div>
              ))}
            </>
          )}

          {mode === 'discrepancies' && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 100px', gap: 10, marginBottom: 10, fontSize: 12, alignItems: 'center' }}>
                <label>Self-report column:&nbsp;
                  <select value={discSelf} onChange={e => setDiscSelf(e.target.value)}>
                    <option value="">(pick one)</option>
                    {allCols.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <label>Observer column:&nbsp;
                  <select value={discObs} onChange={e => setDiscObs(e.target.value)}>
                    <option value="">(pick one)</option>
                    {allCols.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <label>Max rows:&nbsp;
                  <input type="number" value={maxRows} min={10} max={5000} step={50}
                    onChange={e => setMaxRows(+e.target.value)} style={{ width: 60 }} />
                </label>
              </div>
              <div style={{ marginBottom: 10 }}>
                <label style={{ fontSize: 11, color: 'var(--text-dim)' }}>Extra ID columns to show (district, respondent ID, etc.):</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4, maxHeight: 80, overflow: 'auto' }}>
                  {allCols.map(c => (
                    <button key={c}
                      className={`btn-small ${idCols.includes(c) ? 'btn-primary' : ''}`}
                      style={{ fontSize: 10 }}
                      onClick={() => toggleIdCol(c)}>
                      {c}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          <button className="btn-primary" onClick={run}
            disabled={loading || (mode === 'concordance' && pairs.length === 0) || (mode === 'discrepancies' && (!discSelf || !discObs))}
            style={{ marginBottom: 16 }}>
            {loading ? 'Computing…' : `Run ${mode}`}
          </button>

          {error && <div className="error-msg" style={{ marginBottom: 10 }}>{error}</div>}

          {/* Discrepancy summary banner */}
          {mode === 'discrepancies' && result?.total_disagreements !== undefined && (
            <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>
              <strong style={{ color: 'var(--text, #e2e8f0)' }}>{result.total_disagreements}</strong>&nbsp;
              of <strong style={{ color: 'var(--text, #e2e8f0)' }}>{result.total_compared}</strong> compared rows disagree
              ({result.disagreement_rate}%) · showing top {result.showing}
            </div>
          )}

          {/* Results table */}
          {result?.headers && (
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
                        if (typeof cell === 'string') {
                          const interp = ['less than chance', 'slight', 'fair', 'moderate', 'substantial', 'almost perfect'];
                          if (interp.includes(cell)) {
                            const idx = interp.indexOf(cell);
                            const palette = ['#ef4444', '#f97316', '#f59e0b', '#facc15', '#84cc16', '#22c55e'];
                            style.color = palette[idx];
                            style.fontWeight = 600;
                          }
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
