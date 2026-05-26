import React, { useEffect, useMemo, useState } from 'react';
import { ColumnInfo, ColumnRole } from '../types';
import { balanceApi, getColumnValues } from '../api';
import { ColPicker, ColOptions } from './ColPicker';
import { ProjectFilterBanner } from './ProjectFilterBanner';

interface Props {
  datasetId: string;
  columns: ColumnInfo[];
  columnRoles?: Record<string, ColumnRole>;
  studyDesign?: { treatment_col?: string; treatment_value?: string } | null;
  projectFilters?: Record<string, string[]>;
  onClose: () => void;
}

export function BalancePanel({ datasetId, columns, columnRoles = {}, studyDesign, projectFilters, onClose }: Props) {
  const allCols = useMemo(() => columns.map(c => c.name), [columns]);
  const [treatmentCol, setTreatmentCol] = useState(studyDesign?.treatment_col || '');
  const [treatmentValue, setTreatmentValue] = useState(studyDesign?.treatment_value || '');
  const [treatmentValues, setTreatmentValues] = useState<string[]>([]);
  const [covariates, setCovariates] = useState<string[]>([]);
  const [alpha, setAlpha] = useState(0.05);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!treatmentCol) return;
    getColumnValues(datasetId, treatmentCol).then(r => setTreatmentValues((r.values || []).map(String))).catch(() => {});
  }, [datasetId, treatmentCol]);

  useEffect(() => {
    if (covariates.length === 0 && allCols.length > 0) {
      // Default: pre-pick demographic columns
      const demos = Object.entries(columnRoles)
        .filter(([_, r]) => r?.role === 'demographic')
        .map(([c]) => c)
        .filter(c => allCols.includes(c) && c !== treatmentCol);
      if (demos.length > 0) setCovariates(demos);
    }
  }, [columnRoles, allCols, treatmentCol]);

  const run = async () => {
    setError(null); setResult(null);
    if (!treatmentCol) { setError('Pick a treatment column'); return; }
    if (covariates.length === 0) { setError('Pick at least one covariate'); return; }
    setLoading(true);
    try {
      const res = await balanceApi.table({
        dataset_id: datasetId,
        treatment_col: treatmentCol,
        treatment_value: treatmentValue || null,
        covariates,
        alpha,
        filters: projectFilters || {},
      });
      setResult(res);
    } catch (e: any) {
      setError(e.message || 'Failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content stat-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '95vw', width: 1000, maxHeight: '90vh' }}>
        <div className="modal-header">
          <div>
            <h2>⚖️ Balance Table</h2>
            <p className="modal-subtitle">Pre-treatment covariate balance — iebaltab style. |SMD| &gt; 0.25 flags imbalance.</p>
          </div>
          <button onClick={onClose} className="modal-close">×</button>
        </div>

        <div className="modal-body">
          <ProjectFilterBanner filters={projectFilters} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <label className="stat-field">
              <span>Treatment column</span>
              <select value={treatmentCol} onChange={e => setTreatmentCol(e.target.value)} className="fp-select">
                <ColOptions allColumns={columns} available={columns} placeholder="-- pick column --" />
              </select>
            </label>
            <label className="stat-field">
              <span>Treatment value (== "treated")</span>
              <select value={treatmentValue} onChange={e => setTreatmentValue(e.target.value)} className="fp-select">
                <option value="">(auto: most common)</option>
                {treatmentValues.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
            <label className="stat-field">
              <span>Significance level</span>
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
              available={columns.filter(c => c.name !== treatmentCol)}
              selected={covariates}
              label={`Covariates (${covariates.length} selected)`}
              height={200}
              onToggle={name => setCovariates(prev => prev.includes(name) ? prev.filter(x => x !== name) : [...prev, name])}
            />
          </div>

          <button className="fp-btn" onClick={run} disabled={loading}>
            {loading ? 'Computing…' : 'Run Balance Table'}
          </button>

          {error && <div className="stat-error">{error}</div>}

          {result && (
            <div className="stat-result" style={{ marginTop: 16 }}>
              <div style={{ fontSize: 12, marginBottom: 8 }}>
                Treatment: <strong>{result.treatment_col} = {result.treatment_value}</strong>
                {result.weighted && <span style={{ color: '#a78bfa', marginLeft: 8 }}>(weighted by {result.weight_col})</span>}
                {' • '}<strong>{result.n_imbalanced}</strong> of {result.n_covariates} covariates show imbalance
              </div>
              <table className="stat-table" style={{ fontSize: 11 }}>
                <thead>
                  <tr>
                    <th>Covariate</th>
                    <th>Type</th>
                    <th>N (T / C)</th>
                    <th>Mean (T)</th>
                    <th>Mean (C)</th>
                    <th>Diff</th>
                    <th>SMD / h</th>
                    <th>p</th>
                    <th>Sig</th>
                    <th>Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((r: any, i: number) => (
                    <tr key={i} style={{ background: r.imbalanced ? 'rgba(239,68,68,0.08)' : undefined }}>
                      <td><strong>{r.covariate}</strong></td>
                      <td>{r.type}</td>
                      <td>{r.n_treatment} / {r.n_control}</td>
                      <td>{r.type === 'numeric' ? `${r.mean_treatment} ± ${r.sd_treatment}` : '—'}</td>
                      <td>{r.type === 'numeric' ? `${r.mean_control} ± ${r.sd_control}` : '—'}</td>
                      <td>{r.diff ?? '—'}</td>
                      <td>{r.type === 'numeric' ? r.smd : `${r.max_h} (${r.max_h_level || ''})`}</td>
                      <td>{r.p_value ?? '—'}</td>
                      <td>{r.sig}</td>
                      <td style={{ color: r.imbalanced ? '#ef4444' : '#22c55e', fontWeight: 600 }}>
                        {r.imbalanced ? '⚠ unbalanced' : '✓ balanced'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 6 }}>
                SMD = standardized mean diff (Cohen's d). h = Cohen's h for categorical proportions.
                Flag thresholds: |SMD| &gt; 0.25, |h| &gt; 0.20.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
