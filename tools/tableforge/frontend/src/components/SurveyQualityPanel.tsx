import React, { useMemo, useState } from 'react';
import { ColumnInfo, ColumnRole } from '../types';
import { sdqApi } from '../api';
import { ColPicker, ColOptions } from './ColPicker';
import { ProjectFilterBanner } from './ProjectFilterBanner';

interface Props {
  datasetId: string;
  columns: ColumnInfo[];
  columnRoles?: Record<string, ColumnRole>;
  projectFilters?: Record<string, string[]>;
  onClose: () => void;
}

type Mode = 'straight_lining' | 'response_time' | 'duplicates' | 'missingness' | 'attention_checks' | 'overview';

interface AttentionCheck {
  column: string;
  expected_value: string;
}

const MODE_LABELS: Record<Mode, string> = {
  straight_lining: 'Straight-lining',
  response_time: 'Response time',
  duplicates: 'Duplicates',
  missingness: 'Missingness',
  attention_checks: 'Attention checks',
  overview: 'Overview score',
};

const MODE_DESCRIPTIONS: Record<Mode, string> = {
  straight_lining: 'Flag respondents whose answers across the picked items are mostly identical (low-effort responding).',
  response_time: 'Flag respondents who finished suspiciously fast or slow. Needs a duration column or start/end timestamps.',
  duplicates: 'Find duplicate rows — by key columns or full-row match.',
  missingness: 'Per-column + per-row missingness, top patterns, and Little\'s MCAR test.',
  attention_checks: 'Score each respondent on attention-check pass/fail across the columns you nominate.',
  overview: 'Combined per-respondent quality score (0–100) using whichever signals are configured.',
};

export function SurveyQualityPanel({ datasetId, columns, columnRoles = {}, projectFilters, onClose }: Props) {
  const [mode, setMode] = useState<Mode>('overview');
  const [itemCols, setItemCols] = useState<string[]>([]);
  const [threshold, setThreshold] = useState<number>(0.95);

  const [durationCol, setDurationCol] = useState<string>('');
  const [startCol, setStartCol] = useState<string>('');
  const [endCol, setEndCol] = useState<string>('');
  const [fastSec, setFastSec] = useState<string>('');
  const [slowSec, setSlowSec] = useState<string>('');

  const [keyCols, setKeyCols] = useState<string[]>([]);
  const [missCols, setMissCols] = useState<string[]>([]);
  const [littleMcar, setLittleMcar] = useState<boolean>(true);

  const [attentionChecks, setAttentionChecks] = useState<AttentionCheck[]>([]);

  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const numericCols = useMemo(() => columns.filter(c => c.type === 'numeric').map(c => c.name), [columns]);
  const allColNames = useMemo(() => columns.map(c => c.name), [columns]);

  const likertCols = useMemo(
    () => columns.filter(c => columnRoles[c.name]?.scale === 'likert').map(c => c.name),
    [columns, columnRoles]
  );
  const idCols = useMemo(
    () => columns.filter(c => columnRoles[c.name]?.role === 'id').map(c => c.name),
    [columns, columnRoles]
  );
  const timeCols = useMemo(
    () => columns.filter(c => columnRoles[c.name]?.role === 'meta_time').map(c => c.name),
    [columns, columnRoles]
  );
  const attentionRoleCols = useMemo(
    () => columns.filter(c => columnRoles[c.name]?.role === 'attention_check').map(c => c.name),
    [columns, columnRoles]
  );

  // Pre-fill from roles on first open
  React.useEffect(() => {
    if (itemCols.length === 0 && likertCols.length) setItemCols(likertCols);
    if (!durationCol && timeCols.length) setDurationCol(timeCols[0]);
    if (keyCols.length === 0 && idCols.length) setKeyCols(idCols);
    if (attentionChecks.length === 0 && attentionRoleCols.length) {
      setAttentionChecks(attentionRoleCols.map(c => ({ column: c, expected_value: '' })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleIn = (arr: string[], setter: (v: string[]) => void, val: string) => {
    setter(arr.includes(val) ? arr.filter(v => v !== val) : [...arr, val]);
  };

  const run = async () => {
    setLoading(true); setError(null); setResult(null);
    try {
      let r: any;
      const base = { dataset_id: datasetId, filters: projectFilters || {} };
      if (mode === 'straight_lining') {
        if (itemCols.length < 2) throw new Error('Pick at least 2 item columns');
        r = await sdqApi.straightLining({ ...base, item_cols: itemCols, threshold });
      } else if (mode === 'response_time') {
        if (!durationCol && (!startCol || !endCol)) throw new Error('Pick a duration column or both start/end columns');
        r = await sdqApi.responseTime({
          ...base,
          duration_col: durationCol || undefined,
          start_col: startCol || undefined,
          end_col: endCol || undefined,
          fast_seconds: fastSec ? Number(fastSec) : undefined,
          slow_seconds: slowSec ? Number(slowSec) : undefined,
        });
      } else if (mode === 'duplicates') {
        r = await sdqApi.duplicates({ ...base, key_cols: keyCols.length ? keyCols : undefined });
      } else if (mode === 'missingness') {
        r = await sdqApi.missingness({ ...base, columns: missCols.length ? missCols : undefined, little_mcar: littleMcar });
      } else if (mode === 'attention_checks') {
        const valid = attentionChecks.filter(ac => ac.column && ac.expected_value !== '');
        if (valid.length === 0) throw new Error('Add at least one attention check (column + expected value)');
        r = await sdqApi.attentionChecks({ ...base, checks: valid });
      } else if (mode === 'overview') {
        r = await sdqApi.overview({
          ...base,
          item_cols: itemCols.length ? itemCols : undefined,
          duration_col: durationCol || undefined,
          fast_seconds: fastSec ? Number(fastSec) : undefined,
          slow_seconds: slowSec ? Number(slowSec) : undefined,
          attention_checks: attentionChecks.filter(ac => ac.column && ac.expected_value !== ''),
          key_cols: keyCols.length ? keyCols : undefined,
        });
      }
      setResult(r);
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  const ColumnMultiPicker = ({ pool, value, onChange, label }: { pool: string[]; value: string[]; onChange: (v: string[]) => void; label: string }) => (
    <div style={{ marginBottom: 10 }}>
      <ColPicker
        allColumns={columns}
        available={columns.filter(c => pool.includes(c.name))}
        selected={value}
        label={`${label} (${value.length} selected)`}
        height={160}
        onToggle={c => { toggleIn(value, onChange, c); setResult(null); }}
      />
    </div>
  );

  const ColumnSinglePicker = ({ pool, value, onChange, label, allowBlank = true }: { pool: string[]; value: string; onChange: (v: string) => void; label: string; allowBlank?: boolean }) => (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>{label}</div>
      <select value={value} onChange={e => { onChange(e.target.value); setResult(null); }} style={{ width: '100%', padding: 4, background: 'var(--bg-alt)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 12 }}>
        <ColOptions allColumns={columns} available={columns.filter(c => pool.includes(c.name))} placeholder={allowBlank ? '— none —' : undefined} />
      </select>
    </div>
  );

  const renderConfig = () => {
    if (mode === 'straight_lining') {
      return (
        <>
          <ColumnMultiPicker pool={likertCols.length ? likertCols : numericCols} value={itemCols} onChange={setItemCols} label="Scale items (Likert preferred)" />
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>Flag threshold (identical fraction)</div>
            <input type="number" min={0.5} max={1} step={0.05} value={threshold} onChange={e => setThreshold(Number(e.target.value))} style={{ width: 80, padding: 4, background: 'var(--bg-alt)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 12 }} />
            <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-dim)' }}>0.95 = flag if ≥ 95% of answers are identical</span>
          </div>
        </>
      );
    }
    if (mode === 'response_time') {
      return (
        <>
          <ColumnSinglePicker pool={numericCols} value={durationCol} onChange={setDurationCol} label="Duration column (seconds)" />
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>— OR —</div>
          <ColumnSinglePicker pool={allColNames} value={startCol} onChange={setStartCol} label="Start timestamp column" />
          <ColumnSinglePicker pool={allColNames} value={endCol} onChange={setEndCol} label="End timestamp column" />
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>Fast threshold (sec, optional)</div>
              <input value={fastSec} onChange={e => setFastSec(e.target.value)} placeholder="auto" style={{ width: '100%', padding: 4, background: 'var(--bg-alt)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 12 }} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>Slow threshold (sec, optional)</div>
              <input value={slowSec} onChange={e => setSlowSec(e.target.value)} placeholder="auto" style={{ width: '100%', padding: 4, background: 'var(--bg-alt)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 12 }} />
            </div>
          </div>
        </>
      );
    }
    if (mode === 'duplicates') {
      return (
        <>
          <ColumnMultiPicker pool={allColNames} value={keyCols} onChange={setKeyCols} label="Key columns (blank = full-row duplicate check)" />
        </>
      );
    }
    if (mode === 'missingness') {
      return (
        <>
          <ColumnMultiPicker pool={allColNames} value={missCols} onChange={setMissCols} label="Columns to check (blank = all)" />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            <input type="checkbox" checked={littleMcar} onChange={e => setLittleMcar(e.target.checked)} /> Run Little's MCAR test
          </label>
        </>
      );
    }
    if (mode === 'attention_checks') {
      return (
        <>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 6 }}>Define each attention check: column + the value a respondent MUST answer to pass.</div>
          {attentionChecks.map((ac, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              <select value={ac.column} onChange={e => { const next = [...attentionChecks]; next[i] = { ...ac, column: e.target.value }; setAttentionChecks(next); }} style={{ flex: 1, padding: 4, background: 'var(--bg-alt)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 12 }}>
                <option value="">— pick column —</option>
                {allColNames.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <input value={ac.expected_value} onChange={e => { const next = [...attentionChecks]; next[i] = { ...ac, expected_value: e.target.value }; setAttentionChecks(next); }} placeholder="expected value" style={{ width: 140, padding: 4, background: 'var(--bg-alt)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 12 }} />
              <button className="btn-small" onClick={() => setAttentionChecks(attentionChecks.filter((_, j) => j !== i))} style={{ fontSize: 11 }}>×</button>
            </div>
          ))}
          <button className="btn-small" onClick={() => setAttentionChecks([...attentionChecks, { column: '', expected_value: '' }])} style={{ fontSize: 11 }}>+ Add check</button>
        </>
      );
    }
    if (mode === 'overview') {
      return (
        <>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 6 }}>Combined score uses whichever signals are configured. Leave any section blank to skip it.</div>
          <ColumnMultiPicker pool={likertCols.length ? likertCols : numericCols} value={itemCols} onChange={setItemCols} label="Items for straight-lining check" />
          <ColumnSinglePicker pool={numericCols} value={durationCol} onChange={setDurationCol} label="Duration column (optional)" />
          <ColumnMultiPicker pool={allColNames} value={keyCols} onChange={setKeyCols} label="Duplicate key columns (optional)" />
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 6 }}>Attention checks (optional)</div>
          {attentionChecks.map((ac, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              <select value={ac.column} onChange={e => { const next = [...attentionChecks]; next[i] = { ...ac, column: e.target.value }; setAttentionChecks(next); }} style={{ flex: 1, padding: 4, background: 'var(--bg-alt)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 12 }}>
                <option value="">— pick column —</option>
                {allColNames.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <input value={ac.expected_value} onChange={e => { const next = [...attentionChecks]; next[i] = { ...ac, expected_value: e.target.value }; setAttentionChecks(next); }} placeholder="expected" style={{ width: 120, padding: 4, background: 'var(--bg-alt)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 12 }} />
              <button className="btn-small" onClick={() => setAttentionChecks(attentionChecks.filter((_, j) => j !== i))} style={{ fontSize: 11 }}>×</button>
            </div>
          ))}
          <button className="btn-small" onClick={() => setAttentionChecks([...attentionChecks, { column: '', expected_value: '' }])} style={{ fontSize: 11 }}>+ Add check</button>
        </>
      );
    }
    return null;
  };

  const renderResult = () => {
    if (!result) return null;
    return (
      <>
        {/* Top-level summary */}
        {result.headers && result.rows && (
          <div style={{ overflow: 'auto', marginBottom: 12 }}>
            <table className="result-table" style={{ fontSize: 12 }}>
              <thead><tr>{result.headers.map((h: string, i: number) => <th key={i} style={{ padding: '6px 10px', fontSize: 11 }}>{h}</th>)}</tr></thead>
              <tbody>
                {result.rows.map((row: any[], ri: number) => (
                  <tr key={ri}>{row.map((c, ci) => <td key={ci} style={{ padding: '5px 10px', fontSize: 12 }}>{c != null ? String(c) : ''}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Per-check (attention checks) */}
        {result.per_check_headers && (
          <SecondaryTable title="Per-check pass rates" headers={result.per_check_headers} rows={result.per_check_rows} />
        )}

        {/* Pattern rows (missingness) */}
        {result.pattern_headers && (
          <SecondaryTable title="Top missingness patterns" headers={result.pattern_headers} rows={result.pattern_rows} />
        )}
        {result.row_dist_headers && (
          <SecondaryTable title="Per-row missingness distribution" headers={result.row_dist_headers} rows={result.row_dist_rows} />
        )}
        {(result.mcar_chi2 !== undefined || result.mcar_p !== undefined) && result.mcar_chi2 !== null && (
          <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 10 }}>
            <strong>Little's MCAR:</strong> χ² = {result.mcar_chi2}, df = {result.mcar_df}, p = {result.mcar_p}
            {result.mcar_p !== null && (
              <span style={{ marginLeft: 6, color: result.mcar_p < 0.05 ? '#ef4444' : '#22c55e' }}>
                {result.mcar_p < 0.05 ? '(not MCAR)' : '(MCAR plausible)'}
              </span>
            )}
          </div>
        )}

        {/* Duplicate groups */}
        {result.groups_headers && result.groups_rows?.length > 0 && (
          <SecondaryTable title="Duplicate groups" headers={result.groups_headers} rows={result.groups_rows} />
        )}

        {/* Per-respondent quality detail */}
        {result.detail_headers && (
          <SecondaryTable title={`Lowest-scoring respondents (top ${result.detail_rows.length})`} headers={result.detail_headers} rows={result.detail_rows} />
        )}

        {/* Flagged rows (straight-lining / response-time / attention) */}
        {result.flagged_headers && result.flagged_rows?.length > 0 && (
          <SecondaryTable title={`Flagged respondents (top ${result.flagged_rows.length})`} headers={result.flagged_headers} rows={result.flagged_rows} />
        )}

        {result.interpretation && (
          <div style={{ marginTop: 10, padding: '8px 12px', background: 'var(--bg-alt, #1e293b)', borderRadius: 6, fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5, border: '1px solid var(--border, #334155)' }}>
            <strong>Interpretation:</strong> {result.interpretation}
          </div>
        )}
      </>
    );
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()} style={{ maxWidth: '95vw', width: 1000, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-header">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 22 }}>🩺</span>
            <span>Survey Data Quality</span>
            <span style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 400, marginLeft: 6 }}>Quality checks before analysis</span>
          </h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div style={{ padding: 16, overflowY: 'auto' }}>
          <ProjectFilterBanner filters={projectFilters} />
          {/* Mode tabs */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
            {(Object.keys(MODE_LABELS) as Mode[]).map(m => (
              <button key={m} className={`btn-small ${mode === m ? 'btn-primary' : ''}`} onClick={() => { setMode(m); setResult(null); }} style={{ fontSize: 11 }}>{MODE_LABELS[m]}</button>
            ))}
          </div>

          <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 12 }}>{MODE_DESCRIPTIONS[mode]}</div>

          {renderConfig()}

          <button className="btn-primary" onClick={run} disabled={loading} style={{ marginTop: 10, marginBottom: 12 }}>
            {loading ? 'Computing…' : `Run ${MODE_LABELS[mode]}`}
          </button>

          {error && <div className="error-msg" style={{ marginBottom: 10 }}>{error}</div>}

          {renderResult()}
        </div>
      </div>
    </div>
  );
}

function SecondaryTable({ title, headers, rows }: { title: string; headers: string[]; rows: any[][] }) {
  if (!headers?.length || !rows?.length) return null;
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 6 }}>{title}</div>
      <div style={{ overflow: 'auto', maxHeight: 240 }}>
        <table className="result-table" style={{ fontSize: 12 }}>
          <thead><tr>{headers.map((h, i) => <th key={i} style={{ padding: '5px 10px', fontSize: 11 }}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri}>{row.map((c, ci) => <td key={ci} style={{ padding: '4px 10px', fontSize: 12 }}>{c != null ? String(c) : ''}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
