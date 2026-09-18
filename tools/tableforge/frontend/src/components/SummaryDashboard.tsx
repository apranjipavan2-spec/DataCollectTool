import React from 'react';
import { TableConfig, TableResult } from '../types';

interface Props {
  tables: TableConfig[];
  results: Map<string, TableResult>;
  onTableSelect: (idx: number) => void;
}

function getHeadlines(table: TableConfig, result: TableResult | undefined) {
  if (!result || result.rows.length === 0) return null;
  const headlines: { label: string; value: string; change?: string }[] = [];

  // Grand total row
  const totalRow = result.rows.find(r => String(r[0]) === 'Grand Total');
  if (totalRow) {
    table.values.forEach((v, i) => {
      const val = totalRow[table.rows.length + i];
      if (typeof val === 'number') {
        headlines.push({
          label: v.label || v.field,
          value: val.toLocaleString(undefined, { maximumFractionDigits: 1 }),
        });
      }
    });
  } else if (result.rows.length > 0) {
    // Use sum of first value column
    const numHeaders = result.headers.slice(table.rows.length);
    numHeaders.slice(0, 3).forEach((h, i) => {
      const colIdx = table.rows.length + i;
      const total = result.rows.reduce((acc, row) => {
        const v = row[colIdx];
        return typeof v === 'number' ? acc + v : acc;
      }, 0);
      headlines.push({ label: h, value: total.toLocaleString(undefined, { maximumFractionDigits: 1 }) });
    });
  }

  return headlines;
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const w = 80, h = 28;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return `${x},${y}`;
  }).join(' ');
  const trend = values[values.length - 1] > values[0];
  return (
    <svg width={w} height={h} className="sparkline">
      <polyline points={pts} fill="none" stroke={trend ? '#22c55e' : '#ef4444'} strokeWidth="1.5" />
    </svg>
  );
}

export function SummaryDashboard({ tables, results, onTableSelect }: Props) {
  const tablesWithData = tables
    .map((t, i) => ({ table: t, result: results.get(t.id), idx: i }))
    .filter(x => x.result && x.result.rows.length > 0);

  if (tablesWithData.length === 0) {
    return (
      <div className="dashboard-empty">
        <div className="empty-state">
          <div className="empty-icon">📊</div>
          <p>Build tables to see summary dashboard</p>
        </div>
      </div>
    );
  }

  return (
    <div className="summary-dashboard">
      <div className="dashboard-header">
        <h3>Summary Dashboard</h3>
        <span className="dashboard-subtitle">{tablesWithData.length} table{tablesWithData.length !== 1 ? 's' : ''} · click a card to go to table</span>
      </div>
      <div className="dashboard-grid">
        {tablesWithData.map(({ table, result, idx }) => {
          const headlines = getHeadlines(table, result);
          const firstValColIdx = table.rows.length;
          const sparkValues = result!.rows
            .filter(r => String(r[0]) !== 'Grand Total')
            .map(r => r[firstValColIdx])
            .filter(v => typeof v === 'number') as number[];

          return (
            <div key={table.id} className="dashboard-card" onClick={() => onTableSelect(idx)}>
              <div className="dashboard-card-title">{table.name}</div>
              {table.title && <div className="dashboard-card-subtitle">{table.title}</div>}
              <div className="dashboard-metrics">
                {headlines?.slice(0, 3).map((h, i) => (
                  <div key={i} className="dashboard-metric">
                    <div className="metric-value">{h.value}</div>
                    <div className="metric-label">{h.label}</div>
                  </div>
                ))}
              </div>
              <div className="dashboard-card-footer">
                <span className="dashboard-rows">{result!.row_count} rows × {result!.col_count} cols</span>
                {sparkValues.length >= 3 && <Sparkline values={sparkValues.slice(0, 20)} />}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
