import React, { useEffect, useMemo, useState } from 'react';
import { ColumnInfo, ColumnRole } from '../types';
import { likertApi } from '../api';
import { Chart, adaptLikertToStackedBar } from './Chart';
import { ColPicker, ColOptions } from './ColPicker';
import { ProjectFilterBanner } from './ProjectFilterBanner';

interface Props {
  datasetId: string;
  columns: ColumnInfo[];
  columnRoles?: Record<string, ColumnRole>;
  projectFilters?: Record<string, string[]>;
  onClose: () => void;
  onCompositeCreated?: () => void;
}

type Mode = 'summary' | 'composite' | 'compare' | 'factor';

export function LikertPanel({ datasetId, columns, columnRoles = {}, projectFilters, onClose, onCompositeCreated }: Props) {
  const [mode, setMode] = useState<Mode>('summary');
  const [selected, setSelected] = useState<string[]>([]);
  const [reverseCoded, setReverseCoded] = useState<string[]>([]);
  const [groupCol, setGroupCol] = useState<string>('');
  const [scaleMin, setScaleMin] = useState(1);
  const [scaleMax, setScaleMax] = useState(5);
  const [compositeName, setCompositeName] = useState('Composite');
  const [method, setMethod] = useState<'mean' | 'sum' | 'z'>('mean');
  const [correction, setCorrection] = useState<'bonferroni' | 'fdr_bh' | 'holm'>('fdr_bh');
  const [nFactors, setNFactors] = useState(0);
  const [rotation, setRotation] = useState<'varimax' | 'none'>('varimax');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const likertCols = useMemo(() => {
    const tagged = Object.entries(columnRoles)
      .filter(([, r]) => r?.scale === 'likert')
      .map(([c]) => c);
    if (tagged.length >= 2) return tagged;
    return columns.filter(c => c.type === 'numeric').map(c => c.name);
  }, [columns, columnRoles]);

  const allCategoricalCols = useMemo(
    () => columns.filter(c => c.type !== 'numeric').map(c => c.name),
    [columns],
  );

  useEffect(() => {
    setResult(null);
    setError(null);
  }, [mode]);

  const toggle = (c: string) => {
    setSelected(p => (p.includes(c) ? p.filter(x => x !== c) : [...p, c]));
    setResult(null);
  };

  const toggleReverse = (c: string) => {
    setReverseCoded(p => (p.includes(c) ? p.filter(x => x !== c) : [...p, c]));
  };

  const run = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const base = { dataset_id: datasetId, filters: projectFilters || {} };
      let r: any;
      if (mode === 'summary') {
        r = await likertApi.summary({ ...base, item_cols: selected, scale_min: scaleMin, scale_max: scaleMax });
      } else if (mode === 'composite') {
        r = await likertApi.composite({
          ...base, item_cols: selected, composite_name: compositeName, method,
          reverse_code: reverseCoded, scale_min: scaleMin, scale_max: scaleMax,
        });
        if (onCompositeCreated) onCompositeCreated();
      } else if (mode === 'compare') {
        if (!groupCol) throw new Error('Pick a group column');
        r = await likertApi.compare({ ...base, item_cols: selected, group_col: groupCol, correction });
      } else {
        r = await likertApi.factor({ ...base, item_cols: selected, n_factors: nFactors, rotation });
      }
      setResult(r);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const minSel = mode === 'factor' ? 3 : 2;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()} style={{ maxWidth: '95vw', width: 1000, maxHeight: '90vh' }}>
        <div className="modal-header">
          <h2>📊 Likert Analysis</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body" style={{ maxHeight: 'calc(90vh - 80px)', overflow: 'auto' }}>
          <ProjectFilterBanner filters={projectFilters} />
          {/* Mode tabs */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 14, borderBottom: '1px solid var(--border, #334155)' }}>
            {(['summary', 'composite', 'compare', 'factor'] as Mode[]).map(m => (
              <button key={m}
                onClick={() => setMode(m)}
                style={{
                  background: mode === m ? 'var(--accent, #3b82f6)' : 'transparent',
                  color: mode === m ? 'white' : 'var(--text, #e2e8f0)',
                  border: 'none', padding: '6px 14px', borderRadius: '6px 6px 0 0',
                  cursor: 'pointer', fontSize: 12, fontWeight: 600, textTransform: 'capitalize',
                }}>
                {m === 'compare' ? 'Compare by group' : m}
              </button>
            ))}
          </div>

          <p style={{ color: 'var(--text-dim)', fontSize: 12, marginBottom: 10 }}>
            {mode === 'summary'   && 'Per-item N, Mean, SD, Top-2 / Bottom-2 / Net Agree, and full distribution.'}
            {mode === 'composite' && 'Build a new scale column (mean/sum/z). Reverse-code items where higher = less of the construct.'}
            {mode === 'compare'   && 'Per-item Mann-Whitney / Kruskal-Wallis across a grouping variable with multi-test correction.'}
            {mode === 'factor'    && 'PCA-based factor extraction with varimax rotation. KMO + Bartlett included.'}
          </p>

          {/* Scale config */}
          {(mode === 'summary' || mode === 'composite') && (
            <div style={{ display: 'flex', gap: 16, marginBottom: 12, fontSize: 12 }}>
              <label>Scale min:&nbsp;<input type="number" value={scaleMin} onChange={e => setScaleMin(+e.target.value)} style={{ width: 50 }} /></label>
              <label>Scale max:&nbsp;<input type="number" value={scaleMax} onChange={e => setScaleMax(+e.target.value)} style={{ width: 50 }} /></label>
            </div>
          )}

          {/* Composite-specific */}
          {mode === 'composite' && (
            <div style={{ display: 'flex', gap: 16, marginBottom: 12, fontSize: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <label>Name:&nbsp;<input value={compositeName} onChange={e => setCompositeName(e.target.value)} style={{ width: 160 }} /></label>
              <label>Method:&nbsp;
                <select value={method} onChange={e => setMethod(e.target.value as any)}>
                  <option value="mean">Mean</option>
                  <option value="sum">Sum</option>
                  <option value="z">Z-score average</option>
                </select>
              </label>
            </div>
          )}

          {/* Compare-specific */}
          {mode === 'compare' && (
            <div style={{ display: 'flex', gap: 16, marginBottom: 12, fontSize: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <label>Group column:&nbsp;
                <select value={groupCol} onChange={e => setGroupCol(e.target.value)}>
                  <ColOptions allColumns={columns} available={columns.filter(c => allCategoricalCols.includes(c.name))} placeholder="(pick one)" />
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

          {/* Factor-specific */}
          {mode === 'factor' && (
            <div style={{ display: 'flex', gap: 16, marginBottom: 12, fontSize: 12, alignItems: 'center' }}>
              <label># Factors (0 = auto):&nbsp;<input type="number" value={nFactors} min={0} onChange={e => setNFactors(+e.target.value)} style={{ width: 50 }} /></label>
              <label>Rotation:&nbsp;
                <select value={rotation} onChange={e => setRotation(e.target.value as any)}>
                  <option value="varimax">Varimax</option>
                  <option value="none">None</option>
                </select>
              </label>
            </div>
          )}

          {/* Item picker */}
          <div style={{ marginBottom: 12 }}>
            {likertCols.length === 0 && (
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 6 }}>
                No Likert columns tagged — showing all numeric. Tag columns as <code>likert</code> in Variables panel for filtered suggestions.
              </div>
            )}
            <ColPicker
              allColumns={columns}
              available={columns.filter(c => likertCols.includes(c.name) || (likertCols.length === 0 && c.type === 'numeric'))}
              selected={selected}
              label={`Likert items (≥${minSel} required, ${selected.length} selected)`}
              height={200}
              onToggle={toggle}
            />
          </div>

          {/* Reverse-code chips for composite */}
          {mode === 'composite' && selected.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, color: 'var(--text-dim)' }}>Click an item below to reverse-code it (used when higher = less of construct):</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                {selected.map(c => (
                  <button key={c}
                    className={`btn-small ${reverseCoded.includes(c) ? 'btn-primary' : ''}`}
                    style={{ fontSize: 10 }}
                    onClick={() => toggleReverse(c)}>
                    {reverseCoded.includes(c) ? '↺ ' : ''}{c}
                  </button>
                ))}
              </div>
            </div>
          )}

          <button className="btn-primary" onClick={run}
            disabled={loading || selected.length < minSel || (mode === 'compare' && !groupCol)}
            style={{ marginBottom: 16 }}>
            {loading ? 'Computing…' : `Run ${mode}`}
          </button>

          {error && <div className="error-msg" style={{ marginBottom: 10 }}>{error}</div>}

          {/* Result banners */}
          {result?.alpha !== undefined && (
            <div style={{ fontSize: 13, marginBottom: 8 }}>
              <strong>Cronbach's α = {result.alpha}</strong>
              {result.composite_name && <span style={{ marginLeft: 12, color: 'var(--text-dim)' }}>Column '{result.composite_name}' added to dataset.</span>}
            </div>
          )}
          {result?.n_factors !== undefined && (
            <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>
              Extracted {result.n_factors} factor(s) · cumulative variance = {result.cumulative_variance}%
              {result.kmo !== null && result.kmo !== undefined ? ` · KMO = ${result.kmo}` : ''}
            </div>
          )}

          {/* Full stacked-bar chart (interactive) */}
          {mode === 'summary' && result?.distributions && (() => {
            const data = adaptLikertToStackedBar(result.distributions);
            return data ? (
              <div style={{ marginBottom: 12 }}>
                <Chart kind="stackedBar" data={data} title="Likert distribution (% per level)" height={Math.max(220, data.items.length * 36 + 80)} />
              </div>
            ) : null;
          })()}

          {/* Likert distribution preview (stacked bars) */}
          {mode === 'summary' && result?.distributions && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 6 }}>Distribution (stacked %)</div>
              {result.distributions.map((d: any) => (
                <div key={d.item} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, marginBottom: 3 }}>
                  <div style={{ width: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.item}</div>
                  <div style={{ flex: 1, display: 'flex', height: 16, borderRadius: 3, overflow: 'hidden', background: 'var(--bg-alt, #1e293b)' }}>
                    {d.distribution.map((p: number, i: number) => {
                      const palette = ['#ef4444', '#f59e0b', '#facc15', '#84cc16', '#22c55e'];
                      const colour = palette[Math.min(i, palette.length - 1)];
                      return p > 0 ? (
                        <div key={i} style={{ width: `${p}%`, background: colour, fontSize: 9, color: 'white', textAlign: 'center', overflow: 'hidden' }} title={`${d.levels[i]}: ${p}%`}>
                          {p >= 6 ? p.toFixed(0) : ''}
                        </div>
                      ) : null;
                    })}
                  </div>
                  <div style={{ width: 60, fontSize: 11, color: 'var(--text-dim)', textAlign: 'right' }}>NA: {d.net_agree}</div>
                </div>
              ))}
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
