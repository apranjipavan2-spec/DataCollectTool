import React, { useMemo, useState } from 'react';
import { ColumnInfo, ColumnRole } from '../types';
import { geoApi } from '../api';

interface Props {
  datasetId: string;
  columns: ColumnInfo[];
  columnRoles?: Record<string, ColumnRole>;
  onClose: () => void;
}

export function GeoSummaryPanel({ datasetId, columns, columnRoles = {}, onClose }: Props) {
  const allCols = useMemo(() => columns.map(c => c.name), [columns]);
  const geoSuggestions = useMemo(() => Object.entries(columnRoles)
    .filter(([_, r]) => r?.role === 'geographic').map(([c]) => c), [columnRoles]);

  const [geoCol, setGeoCol] = useState(geoSuggestions[0] || '');
  const [valueCol, setValueCol] = useState('');
  const [agg, setAgg] = useState<'mean' | 'sum' | 'count' | 'median'>('count');
  const [topN, setTopN] = useState<number>(20);
  const [benchmark, setBenchmark] = useState('');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const numericCols = useMemo(() => columns.filter(c => c.type === 'numeric').map(c => c.name), [columns]);

  const run = async () => {
    setError(null); setResult(null);
    if (!geoCol) { setError('Pick a geo column'); return; }
    setLoading(true);
    try {
      const bv = benchmark ? parseFloat(benchmark) : null;
      const res = await geoApi.aggregate({
        dataset_id: datasetId,
        geo_col: geoCol,
        value_col: valueCol || null,
        agg,
        top_n: topN > 0 ? topN : null,
        benchmark: bv !== null && !isNaN(bv) ? { value: bv, label: 'Benchmark' } : null,
      });
      setResult(res);
    } catch (e: any) {
      setError(e.message || 'Failed');
    } finally {
      setLoading(false);
    }
  };

  const maxVal = result ? Math.max(...result.rows.map((r: any) => r.value || 0)) : 1;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content stat-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 900 }}>
        <div className="modal-header">
          <div>
            <h2>🗺 Geographic Summary</h2>
            <p className="modal-subtitle">Rank areas (districts/states) by metric. Compare against benchmarks.</p>
          </div>
          <button onClick={onClose} className="modal-close">×</button>
        </div>

        <div className="modal-body">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, marginBottom: 12 }}>
            <label className="stat-field">
              <span>Geo column</span>
              <select value={geoCol} onChange={e => setGeoCol(e.target.value)} className="fp-select">
                <option value="">-- pick --</option>
                {allCols.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="stat-field">
              <span>Value (optional)</span>
              <select value={valueCol} onChange={e => setValueCol(e.target.value)} className="fp-select">
                <option value="">(count rows)</option>
                {numericCols.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="stat-field">
              <span>Aggregation</span>
              <select value={agg} onChange={e => setAgg(e.target.value as any)} className="fp-select">
                <option value="count">Count</option>
                <option value="mean">Mean</option>
                <option value="median">Median</option>
                <option value="sum">Sum</option>
              </select>
            </label>
            <label className="stat-field">
              <span>Top N</span>
              <input type="number" value={topN} min={0} onChange={e => setTopN(Number(e.target.value))} className="fp-input" />
            </label>
            <label className="stat-field">
              <span>Benchmark value</span>
              <input type="text" value={benchmark} onChange={e => setBenchmark(e.target.value)} className="fp-input" placeholder="e.g. 75.5" />
            </label>
          </div>

          <button className="fp-btn" onClick={run} disabled={loading}>
            {loading ? 'Computing…' : 'Aggregate'}
          </button>

          {error && <div className="stat-error">{error}</div>}

          {result && (
            <div className="stat-result" style={{ marginTop: 16 }}>
              <div style={{ fontSize: 12, marginBottom: 8 }}>
                <strong>{result.n_areas}</strong> areas {result.weighted && <span style={{ color: '#a78bfa' }}>(weighted)</span>}
              </div>
              <table className="stat-table" style={{ fontSize: 11 }}>
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>{result.geo_col}</th>
                    <th>N</th>
                    <th>{agg} of {result.value_col || 'rows'}</th>
                    <th>Bar</th>
                    <th>Share %</th>
                    {result.rows[0]?.benchmark_value !== undefined && <><th>Benchmark</th><th>Δ%</th></>}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((r: any) => {
                    const pct = maxVal > 0 ? (r.value / maxVal) * 100 : 0;
                    const devColor = (r.deviation_pct ?? 0) >= 0 ? '#22c55e' : '#ef4444';
                    return (
                      <tr key={r.rank}>
                        <td>{r.rank}</td>
                        <td><strong>{r.area}</strong></td>
                        <td>{r.n}</td>
                        <td>{r.value}</td>
                        <td style={{ minWidth: 120 }}>
                          <div style={{ background: 'rgba(168,85,247,0.6)', height: 14, width: `${pct}%`, borderRadius: 2 }} />
                        </td>
                        <td>{r.share_pct}%</td>
                        {r.benchmark_value !== undefined && (
                          <>
                            <td>{r.benchmark_value}</td>
                            <td style={{ color: devColor, fontWeight: 600 }}>
                              {r.deviation_pct !== null && r.deviation_pct !== undefined ? `${r.deviation_pct > 0 ? '+' : ''}${r.deviation_pct}%` : '—'}
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
