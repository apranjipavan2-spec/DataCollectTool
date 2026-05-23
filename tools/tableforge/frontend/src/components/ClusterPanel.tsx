import React, { useMemo, useState } from 'react';
import { ColumnInfo } from '../types';
import { clusterApi } from '../api';

interface Props {
  datasetId: string;
  columns: ColumnInfo[];
  onClose: () => void;
}

export function ClusterPanel({ datasetId, columns, onClose }: Props) {
  const numericCols = useMemo(() => columns.filter(c => c.type === 'numeric').map(c => c.name), [columns]);
  const [selected, setSelected] = useState<string[]>([]);
  const [k, setK] = useState<number>(3);
  const [showElbow, setShowElbow] = useState(true);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setError(null); setResult(null);
    if (selected.length < 2) { setError('Pick ≥2 columns'); return; }
    setLoading(true);
    try {
      const res = await clusterApi.kmeans({
        dataset_id: datasetId,
        columns: selected,
        k,
        k_range: showElbow ? [2, 8] : null,
        standardize: true,
      });
      setResult(res);
    } catch (e: any) {
      setError(e.message || 'Failed');
    } finally {
      setLoading(false);
    }
  };

  const maxElbow = result?.elbow?.length ? Math.max(...result.elbow.map((e: any) => e.inertia)) : 1;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content stat-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 1000 }}>
        <div className="modal-header">
          <div>
            <h2>🔮 K-Means Clustering</h2>
            <p className="modal-subtitle">Segment respondents by chosen numeric variables. Z-standardized before clustering.</p>
          </div>
          <button onClick={onClose} className="modal-close">×</button>
        </div>

        <div className="modal-body">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 12 }}>
            <label className="stat-field">
              <span>K (number of clusters)</span>
              <input type="number" min={2} max={10} value={k} onChange={e => setK(Number(e.target.value))} className="fp-input" />
            </label>
            <label className="stat-field" style={{ alignSelf: 'end' }}>
              <span>
                <input type="checkbox" checked={showElbow} onChange={e => setShowElbow(e.target.checked)} /> Show elbow curve (k=2..8)
              </span>
            </label>
            <div style={{ alignSelf: 'end', fontSize: 11, color: 'var(--text-dim)' }}>
              {numericCols.length} numeric columns available
            </div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Columns for clustering ({selected.length} selected)</div>
            <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 4, padding: 6, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
              {numericCols.map(c => (
                <label key={c} style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input type="checkbox" checked={selected.includes(c)}
                    onChange={e => setSelected(prev => e.target.checked ? [...prev, c] : prev.filter(x => x !== c))} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c}</span>
                </label>
              ))}
            </div>
          </div>

          <button className="fp-btn" onClick={run} disabled={loading}>
            {loading ? 'Clustering…' : 'Run K-Means'}
          </button>

          {error && <div className="stat-error">{error}</div>}

          {result && (
            <div className="stat-result" style={{ marginTop: 16 }}>
              <div style={{ fontSize: 12, marginBottom: 8 }}>
                <strong>K = {result.k}</strong> • N = {result.n} • Silhouette = <strong>{result.silhouette ?? 'n/a'}</strong> • Inertia = {result.inertia}
              </div>

              {result.elbow && result.elbow.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Elbow Curve (lower inertia = tighter clusters)</div>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: 80, padding: 4, border: '1px solid var(--border)', borderRadius: 4 }}>
                    {result.elbow.map((e: any) => {
                      const h = maxElbow > 0 ? (e.inertia / maxElbow) * 70 : 0;
                      const isPick = e.k === result.k;
                      return (
                        <div key={e.k} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
                          <div style={{ height: h, width: '70%', background: isPick ? '#a78bfa' : '#475569', borderRadius: 2 }} title={`k=${e.k}: ${e.inertia}`} />
                          <div style={{ fontSize: 9, color: 'var(--text-dim)' }}>k={e.k}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Cluster Profiles</div>
              <table className="stat-table" style={{ fontSize: 11 }}>
                <thead>
                  <tr>
                    <th>Cluster</th>
                    <th>N</th>
                    <th>%</th>
                    {selected.map(c => <th key={c}>{c}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {result.profiles.map((p: any) => (
                    <tr key={p.cluster}>
                      <td><strong style={{ color: ['#a78bfa', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899'][p.cluster % 6] }}>Cluster {p.cluster}</strong></td>
                      <td>{p.n}</td>
                      <td>{p.pct}%</td>
                      {selected.map(c => <td key={c}>{p.means[c]}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
