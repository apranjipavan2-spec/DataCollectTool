import React, { useEffect, useMemo, useState } from 'react';
import { ColumnInfo, ColumnRole, TableResult } from '../types';
import { runAutoBattery, planBattery, BatteryProgress } from '../api';
import { ColPicker } from './ColPicker';
import { ProjectFilterBanner } from './ProjectFilterBanner';

interface Props {
  datasetId: string;
  columns: ColumnInfo[];
  columnRoles?: Record<string, ColumnRole>;
  projectFilters?: Record<string, string[]>;
  onClose: () => void;
  onPromote?: (label: string, headers: string[], rows: any[][], interpretation: string) => void;
  onPackReady?: (pack: any[]) => void;
}

type Correction = 'fdr_bh' | 'bonferroni' | 'holm' | 'none';

export function AutoAnalyzePanel({ datasetId, columns, columnRoles = {}, projectFilters, onClose, onPromote, onPackReady }: Props) {
  const [outcomes, setOutcomes] = useState<string[]>([]);
  const [predictors, setPredictors] = useState<string[]>([]);
  const [correction, setCorrection] = useState<Correction>('fdr_bh');
  const [useDesign, setUseDesign] = useState(true);

  const [planLoading, setPlanLoading] = useState(false);
  const [plan, setPlan] = useState<any[] | null>(null);

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ idx: number; total: number; label: string }>({ idx: 0, total: 0, label: '' });
  const [results, setResults] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const allCols = useMemo(() => columns.map(c => c.name), [columns]);

  // Auto-pick outcomes / predictors from column_roles
  const detectedOutcomes = useMemo(
    () => Object.entries(columnRoles).filter(([, r]) => r?.role === 'outcome').map(([c]) => c),
    [columnRoles],
  );
  const detectedPredictors = useMemo(() => {
    const treatments = Object.entries(columnRoles).filter(([, r]) => r?.role === 'treatment').map(([c]) => c);
    const demos = Object.entries(columnRoles).filter(([, r]) => r?.role === 'demographic').map(([c]) => c);
    return Array.from(new Set([...treatments, ...demos]));
  }, [columnRoles]);

  useEffect(() => {
    if (outcomes.length === 0 && detectedOutcomes.length > 0) setOutcomes(detectedOutcomes);
    if (predictors.length === 0 && detectedPredictors.length > 0) setPredictors(detectedPredictors);
  }, [detectedOutcomes, detectedPredictors]);

  const toggle = (setter: React.Dispatch<React.SetStateAction<string[]>>, val: string) => {
    setter(p => (p.includes(val) ? p.filter(x => x !== val) : [...p, val]));
    setPlan(null);
    setResults(null);
  };

  const doPlan = async () => {
    setPlanLoading(true);
    setError(null);
    try {
      const r = await planBattery({
        dataset_id: datasetId, outcome_cols: outcomes, predictor_cols: predictors,
        correction, use_design: useDesign, filters: projectFilters || {},
      }) as any;
      setPlan(r.plan);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setPlanLoading(false);
    }
  };

  const doRun = async () => {
    if (outcomes.length === 0) { setError('Pick at least one outcome'); return; }
    setRunning(true);
    setError(null);
    setResults(null);
    setProgress({ idx: 0, total: 0, label: 'Preparing…' });
    try {
      await runAutoBattery(
        { dataset_id: datasetId, outcome_cols: outcomes, predictor_cols: predictors, correction, use_design: useDesign, filters: projectFilters || {} },
        (e: BatteryProgress) => {
          if (e.step === 'start') {
            setProgress({ idx: 0, total: e.total || 0, label: 'Starting…' });
          } else if (e.step === 'progress') {
            setProgress({ idx: e.idx || 0, total: e.total || 0, label: e.label || '' });
          } else if (e.step === 'done') {
            const pack = e.results || [];
            setResults(pack);
            if (onPackReady) onPackReady(pack);
          }
        },
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  };

  const grouped = useMemo(() => {
    if (!results) return null;
    const out: Record<string, any[]> = {};
    for (const r of results) {
      const key = r.outcome || '(no outcome)';
      (out[key] = out[key] || []).push(r);
    }
    return out;
  }, [results]);

  const promote = (r: any) => {
    if (!onPromote || !r?.table) return;
    onPromote(r.label, r.table.headers || [], r.table.rows || [], r.interpretation || '');
  };

  const toggleExpand = (id: string) => {
    setExpanded(p => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const renderResultCard = (r: any) => {
    const open = expanded.has(r.id);
    const pAdj = r.test?.p_adj;
    const pRaw = r.test?.p_raw;
    const sig = r.test?.sig || '';
    const sigColour = sig === '***' ? '#ef4444' : sig === '**' ? '#f59e0b' : sig === '*' ? '#22c55e' : 'var(--text-dim)';
    return (
      <div key={r.id} style={{
        border: '1px solid var(--border, #334155)', borderRadius: 6, marginBottom: 8,
        background: 'var(--bg, #0f172a)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', cursor: 'pointer' }}
          onClick={() => toggleExpand(r.id)}>
          <span style={{ fontSize: 11, color: 'var(--text-dim)', minWidth: 40, fontFamily: 'monospace' }}>{r.id}</span>
          <span style={{ fontSize: 11, padding: '2px 6px', background: 'var(--bg-alt, #1e293b)', borderRadius: 3 }}>{r.kind}</span>
          <span style={{ flex: 1, fontSize: 12, fontWeight: 600 }}>{r.label}</span>
          {pAdj !== undefined && (
            <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
              p<sub>raw</sub>={pRaw ?? 'NA'} · p<sub>adj</sub>={pAdj} <strong style={{ color: sigColour }}>{sig}</strong>
            </span>
          )}
          <span style={{ fontSize: 14, color: 'var(--text-dim)' }}>{open ? '▾' : '▸'}</span>
        </div>
        {open && (
          <div style={{ padding: '0 12px 12px 12px' }}>
            {r.warnings?.length > 0 && (
              <div style={{ fontSize: 11, color: '#f59e0b', marginBottom: 6 }}>
                ⚠ {r.warnings.join(' · ')}
              </div>
            )}
            {r.table?.headers?.length > 0 && (
              <div style={{ overflow: 'auto', marginBottom: 6 }}>
                <table className="result-table" style={{ fontSize: 11 }}>
                  <thead>
                    <tr>{r.table.headers.map((h: string, i: number) => (
                      <th key={i} style={{ padding: '4px 8px', fontSize: 10 }}>{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody>
                    {r.table.rows.map((row: any[], ri: number) => (
                      <tr key={ri}>{row.map((cell, ci) => (
                        <td key={ci} style={{ padding: '3px 8px', fontSize: 11 }}>{cell != null ? String(cell) : ''}</td>
                      ))}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.5, marginBottom: 6 }}>
              {r.interpretation}
            </div>
            {onPromote && r.table?.headers?.length > 0 && (
              <button className="btn-small" onClick={(e) => { e.stopPropagation(); promote(r); }}
                style={{ fontSize: 10 }}>
                → Promote to project
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()} style={{ maxWidth: '95vw', width: 1000, maxHeight: '90vh' }}>
        <div className="modal-header">
          <h2>⚡ Run Full Analysis</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body" style={{ maxHeight: 'calc(90vh - 80px)', overflow: 'auto' }}>
          <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 12 }}>
            Pick outcomes (what you care about) + predictors (what might explain them). The system picks the right test for
            each pairing, applies multi-test correction, and returns the full pack. Tag column roles in the
            <strong> Variables </strong> panel for smarter test selection.
          </p>

          <ProjectFilterBanner filters={projectFilters} context="battery" />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <ColPicker
              allColumns={columns}
              available={columns}
              selected={outcomes}
              label={`Outcomes (${outcomes.length} selected${detectedOutcomes.length > 0 ? `, ${detectedOutcomes.length} auto-detected` : ''})`}
              height={180}
              onToggle={c => toggle(setOutcomes, c)}
            />
            <ColPicker
              allColumns={columns}
              available={columns}
              selected={predictors}
              label={`Predictors (${predictors.length} selected${detectedPredictors.length > 0 ? `, ${detectedPredictors.length} auto-detected` : ''})`}
              height={180}
              onToggle={c => toggle(setPredictors, c)}
            />
          </div>

          <div style={{ display: 'flex', gap: 16, marginBottom: 12, fontSize: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <label>Multi-test correction:&nbsp;
              <select value={correction} onChange={e => setCorrection(e.target.value as Correction)}>
                <option value="fdr_bh">Benjamini-Hochberg FDR</option>
                <option value="bonferroni">Bonferroni</option>
                <option value="holm">Holm</option>
                <option value="none">None</option>
              </select>
            </label>
            <label>
              <input type="checkbox" checked={useDesign} onChange={e => setUseDesign(e.target.checked)} />
              &nbsp;Use saved Study Design (pre/post pairs, treatment col, weights)
            </label>
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <button className="btn-small" onClick={doPlan}
              disabled={planLoading || running || outcomes.length === 0}>
              {planLoading ? 'Planning…' : 'Preview plan'}
            </button>
            <button className="btn-primary" onClick={doRun}
              disabled={running || outcomes.length === 0}>
              {running ? `Running ${progress.idx}/${progress.total}…` : '⚡ Run Full Analysis'}
            </button>
          </div>

          {error && <div className="error-msg" style={{ marginBottom: 10 }}>{error}</div>}

          {plan && !results && (
            <div style={{ marginBottom: 12, padding: 10, background: 'var(--bg-alt, #1e293b)', borderRadius: 6 }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Planned battery ({plan.length} tests):</div>
              <div style={{ maxHeight: 200, overflow: 'auto' }}>
                {plan.map((p: any) => (
                  <div key={p.id} style={{ fontSize: 11, padding: '2px 4px', display: 'flex', gap: 8 }}>
                    <span style={{ color: 'var(--text-dim)', fontFamily: 'monospace', minWidth: 36 }}>{p.id}</span>
                    <span style={{ minWidth: 100, color: 'var(--accent, #3b82f6)' }}>{p.kind}</span>
                    <span>{p.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {running && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, marginBottom: 4 }}>
                {progress.idx}/{progress.total} · <span style={{ color: 'var(--text-dim)' }}>{progress.label}</span>
              </div>
              <div style={{ height: 6, background: 'var(--bg-alt, #1e293b)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{
                  width: progress.total ? `${(progress.idx / progress.total) * 100}%` : '0%',
                  height: '100%', background: 'var(--accent, #3b82f6)', transition: 'width 0.2s',
                }} />
              </div>
            </div>
          )}

          {grouped && (
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
                Pack — {results?.length} tests · correction = {correction}
              </div>
              {Object.entries(grouped).map(([outcome, items]) => (
                <div key={outcome} style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent, #3b82f6)', marginBottom: 6 }}>
                    Outcome: {outcome} <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>({items.length} tests)</span>
                  </div>
                  {items.map(renderResultCard)}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
