import React, { useMemo, useState } from 'react';
import { ColumnInfo, ColumnRole } from '../types';
import { driverApi } from '../api';
import { ColPicker, ColOptions } from './ColPicker';
import { ProjectFilterBanner } from './ProjectFilterBanner';

interface Props {
  datasetId: string;
  columns: ColumnInfo[];
  columnRoles?: Record<string, ColumnRole>;
  projectFilters?: Record<string, string[]>;
  onClose: () => void;
}

export function DriverPanel({ datasetId, columns, columnRoles = {}, projectFilters, onClose }: Props) {
  const outcomeSuggestions = useMemo(() => Object.entries(columnRoles)
    .filter(([_, r]) => r?.role === 'outcome').map(([c]) => c), [columnRoles]);

  const [outcome, setOutcome] = useState(outcomeSuggestions[0] || '');
  const [predictors, setPredictors] = useState<string[]>([]);
  const [alpha, setAlpha] = useState(0.05);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setError(null); setResult(null);
    if (!outcome) { setError('Pick an outcome'); return; }
    if (predictors.length === 0) { setError('Pick at least one predictor'); return; }
    setLoading(true);
    try {
      const res = await driverApi.importance({ dataset_id: datasetId, outcome, predictors, standardize: true, alpha, filters: projectFilters || {} });
      setResult(res);
    } catch (e: any) {
      setError(e.message || 'Failed');
    } finally {
      setLoading(false);
    }
  };

  const maxImp = result ? Math.max(...result.drivers.map((d: any) => Math.abs(d.importance_pct || 0))) : 1;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content stat-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '95vw', width: 1000, maxHeight: '90vh' }}>
        <div className="modal-header">
          <div>
            <h2>🎯 Key Driver Analysis</h2>
            <p className="modal-subtitle">Which predictors matter most for {outcome || 'your outcome'}? Standardized β + Pratt's relative importance.</p>
          </div>
          <button onClick={onClose} className="modal-close">×</button>
        </div>

        <div className="modal-body" style={{ maxHeight: 'calc(90vh - 80px)', overflowY: 'auto' }}>
          <ProjectFilterBanner filters={projectFilters} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <label className="stat-field">
              <span>Outcome</span>
              <select value={outcome} onChange={e => setOutcome(e.target.value)} className="fp-select">
                <ColOptions allColumns={columns} available={columns} placeholder="-- pick --" />
              </select>
            </label>
            <label className="stat-field">
              <span>α</span>
              <select value={alpha} onChange={e => setAlpha(Number(e.target.value))} className="fp-select">
                <option value={0.10}>0.10</option>
                <option value={0.05}>0.05</option>
                <option value={0.01}>0.01</option>
              </select>
            </label>
          </div>

          <div style={{ marginBottom: 12 }}>
            <ColPicker
              allColumns={columns}
              available={columns.filter(c => c.name !== outcome)}
              selected={predictors}
              label={`Predictors (${predictors.length} selected)`}
              height={200}
              onToggle={name => setPredictors(prev => prev.includes(name) ? prev.filter(x => x !== name) : [...prev, name])}
            />
          </div>

          <button className="fp-btn" onClick={run} disabled={loading}>
            {loading ? 'Computing…' : 'Run Driver Analysis'}
          </button>

          {error && <div className="stat-error">{error}</div>}

          {result && (
            <div className="stat-result" style={{ marginTop: 16 }}>
              <div style={{ fontSize: 12, marginBottom: 8 }}>
                <strong>N = {result.n}</strong> • R² = <strong>{result.r2}</strong> • Adj R² = {result.adj_r2}
                {result.weighted && <span style={{ color: '#a78bfa', marginLeft: 8 }}>(weighted by {result.weight_col})</span>}
              </div>
              <table className="stat-table" style={{ fontSize: 11 }}>
                <thead>
                  <tr>
                    <th>Rank</th><th>Predictor</th><th>Std β</th><th>Importance</th><th>Bar</th><th>Importance %</th>
                  </tr>
                </thead>
                <tbody>
                  {result.drivers.map((d: any) => {
                    const w = Math.abs(d.importance_pct || 0);
                    const pct = maxImp > 0 ? (w / maxImp) * 100 : 0;
                    return (
                      <tr key={d.rank}>
                        <td>{d.rank}</td>
                        <td><strong>{d.predictor}</strong></td>
                        <td>{d.std_beta}</td>
                        <td>{d.pratt}</td>
                        <td style={{ minWidth: 160 }}>
                          <div style={{ background: 'rgba(34,197,94,0.6)', height: 14, width: `${pct}%`, borderRadius: 2 }} />
                        </td>
                        <td>{d.importance_pct}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <details style={{ marginTop: 12 }}>
                <summary style={{ cursor: 'pointer', fontSize: 11, color: 'var(--text-dim)' }}>Show level-by-level coefficients</summary>
                <table className="stat-table" style={{ fontSize: 10, marginTop: 6 }}>
                  <thead>
                    <tr><th>Level</th><th>β</th><th>SE</th><th>t</th><th>p</th><th>Sig</th></tr>
                  </thead>
                  <tbody>
                    {result.drivers.flatMap((d: any) => d.levels).map((lv: any, i: number) => (
                      <tr key={i}>
                        <td>{lv.label}</td><td>{lv.beta}</td><td>{lv.se}</td>
                        <td>{lv.t}</td><td>{lv.p_value}</td><td>{lv.sig}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
