import React, { useState, useEffect, useRef } from 'react';
import { ColumnInfo, TableResult, ComparisonConfig } from '../types';
import { API_BASE } from '../api';

interface Props {
  datasetId: string;
  columns: ColumnInfo[];
  onClose: () => void;
  initialConfig?: ComparisonConfig;
  onConfigChange?: (config: ComparisonConfig) => void;
}

const COMPARISONS = [
  { value: 'prev_period', label: 'Previous Period Value', desc: 'Value from preceding period' },
  { value: 'abs_change', label: 'Absolute Change', desc: 'Current minus previous' },
  { value: 'pct_change', label: '% Change (MoM)', desc: 'Percentage change from previous' },
  { value: 'yoy_value', label: 'Same Period Last Year', desc: 'Value from 12 periods ago' },
  { value: 'yoy_abs', label: 'YoY Absolute Change', desc: 'Current minus same period last year' },
  { value: 'yoy_pct', label: 'YoY % Change', desc: 'Year-over-year percentage change' },
  { value: 'period_avg', label: 'Period Average', desc: 'Running average across periods' },
  { value: 'deviation', label: 'Deviation from Average', desc: 'Current minus running average' },
  { value: 'cum_ytd', label: 'Cumulative YTD', desc: 'Running total year-to-date' },
  { value: 'moving_avg', label: 'Moving Average', desc: 'Average of last N periods' },
];

export function ComparisonPanel({ datasetId, columns, onClose, initialConfig, onConfigChange }: Props) {
  const [dateCol, setDateCol] = useState(initialConfig?.date_column || '');
  const [valueCol, setValueCol] = useState(initialConfig?.value_column || '');
  const [groupBy, setGroupBy] = useState<string[]>(initialConfig?.group_by || []);
  const [selected, setSelected] = useState<Set<string>>(new Set(initialConfig?.comparisons || ['abs_change', 'pct_change']));
  const [movingN, setMovingN] = useState(initialConfig?.moving_avg_n || 3);
  const [result, setResult] = useState<TableResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const configReportedRef = useRef(false);

  const dateCols = columns.filter(c => c.type === 'date');
  const numCols = columns.filter(c => c.type === 'numeric');
  const textCols = columns.filter(c => c.type === 'text');

  // Auto-detect: pre-select first date col and first numeric col (only if no initial config)
  useEffect(() => {
    if (!initialConfig) {
      if (!dateCol && dateCols.length > 0) setDateCol(dateCols[0].name);
      if (!valueCol && numCols.length > 0) setValueCol(numCols[0].name);
    }
  }, [columns]);

  // Report config changes back to parent whenever config state changes
  useEffect(() => {
    // Skip the initial render to avoid overwriting with defaults before auto-detect runs
    if (!configReportedRef.current) {
      configReportedRef.current = true;
      return;
    }
    if (onConfigChange && dateCol) {
      onConfigChange({
        date_column: dateCol,
        value_column: valueCol,
        group_by: groupBy,
        comparisons: Array.from(selected),
        moving_avg_n: movingN,
      });
    }
  }, [dateCol, valueCol, groupBy, selected, movingN]);

  const toggleComp = (v: string) => {
    const next = new Set(selected);
    if (next.has(v)) next.delete(v); else next.add(v);
    setSelected(next);
  };

  const handleRun = async () => {
    if (!dateCol || !valueCol) { setError('Select date and value columns'); return; }
    // Persist config on run
    if (onConfigChange) {
      onConfigChange({
        date_column: dateCol,
        value_column: valueCol,
        group_by: groupBy,
        comparisons: Array.from(selected),
        moving_avg_n: movingN,
      });
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/compare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dataset_id: datasetId,
          date_column: dateCol,
          value_column: valueCol,
          group_by: groupBy,
          comparisons: Array.from(selected),
          moving_avg_n: movingN,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setResult(await res.json());
    } catch (e: any) {
      setError(e.message || 'Comparison failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Period-over-Period Comparisons</h2>
          <button className="modal-close" onClick={onClose}>x</button>
        </div>
        <div className="modal-body">
          <div className="form-row">
            <div className="form-group" style={{ flex: 1 }}>
              <label>Date Column</label>
              <select value={dateCol} onChange={e => setDateCol(e.target.value)}>
                <option value="">Select...</option>
                {dateCols.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                {dateCols.length === 0 && columns.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label>Value Column</label>
              <select value={valueCol} onChange={e => setValueCol(e.target.value)}>
                <option value="">Select...</option>
                {numCols.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label>Group By (optional)</label>
              <select value={groupBy[0] || ''} onChange={e => setGroupBy(e.target.value ? [e.target.value] : [])}>
                <option value="">None</option>
                {textCols.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
              </select>
            </div>
          </div>

          <div className="form-group">
            <label>Comparison Types</label>
            <div className="comp-grid">
              {COMPARISONS.map(c => (
                <label key={c.value} className={`comp-item ${selected.has(c.value) ? 'active' : ''}`}>
                  <input type="checkbox" checked={selected.has(c.value)}
                    onChange={() => toggleComp(c.value)} />
                  <div>
                    <strong>{c.label}</strong>
                    <span>{c.desc}</span>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {selected.has('moving_avg') && (
            <div className="form-group" style={{ maxWidth: 200 }}>
              <label>Moving Average Periods (N)</label>
              <input type="number" value={movingN} min={2} max={24}
                onChange={e => setMovingN(parseInt(e.target.value) || 3)} />
            </div>
          )}

          <div style={{ marginTop: 12 }}>
            <button className="btn-primary" onClick={handleRun} disabled={loading}>
              {loading ? 'Computing...' : 'Generate Comparison'}
            </button>
          </div>

          {error && <div className="error-msg">{error}</div>}

          {result && result.rows.length > 0 && (
            <div className="comp-result">
              <div className="result-table-wrap" style={{ maxHeight: 400, marginTop: 16 }}>
                <table className="result-table">
                  <thead>
                    <tr>{result.headers.map((h, i) => <th key={i}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row, ri) => (
                      <tr key={ri}>
                        {row.map((cell: any, ci: number) => {
                          const header = result.headers[ci] || '';
                          const isChange = header.includes('Change') || header.includes('Deviation') || header.includes('% Change') || header.includes('YoY');
                          const isPct = header.includes('%');
                          const numVal = typeof cell === 'number' ? cell : null;
                          const changeClass = isChange && numVal !== null
                            ? (numVal > 0 ? 'positive-change' : numVal < 0 ? 'negative-change' : '')
                            : '';
                          const arrow = isChange && numVal !== null
                            ? (numVal > 0 ? ' ▲' : numVal < 0 ? ' ▼' : ' ▶')
                            : '';
                          const display = cell != null
                            ? (typeof cell === 'number'
                              ? (isPct ? cell.toFixed(1) + '%' : cell.toLocaleString(undefined, { maximumFractionDigits: 2 }))
                              : String(cell))
                            : '';
                          return (
                            <td key={ci} className={`${typeof cell === 'number' ? 'num-cell' : ''} ${changeClass}`}>
                              {display}{arrow && <span className={`change-arrow ${changeClass}`}>{arrow}</span>}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="result-info">{result.row_count} rows x {result.col_count} columns</div>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
