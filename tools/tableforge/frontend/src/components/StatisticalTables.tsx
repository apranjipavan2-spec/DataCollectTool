import React, { useState } from 'react';
import { ColumnInfo } from '../types';
import { API_BASE } from '../api';

type StatType = 'correlation' | 'descriptive' | 'crosstab' | 'ttest' | 'anova' | 'regression' | 'normality' | 'outlier' | 'frequency';

interface Props {
  type: StatType;
  datasetId: string;
  columns: ColumnInfo[];
  onClose: () => void;
}

export function StatisticalTables({ type, datasetId, columns, onClose }: Props) {
  const [selectedCols, setSelectedCols] = useState<string[]>([]);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const numericCols = columns.filter(c => c.type === 'numeric');
  const allCols = columns;

  const titles: Record<StatType, string> = {
    correlation: 'Correlation Matrix',
    descriptive: 'Descriptive Statistics (Table 1)',
    crosstab: 'Cross-Tabulation with Chi-Square Test',
    ttest: 't-Test / Mann-Whitney U Test',
    anova: 'One-Way ANOVA',
    regression: 'Linear Regression',
    normality: 'Normality Tests',
    outlier: 'Outlier Detection',
    frequency: 'Frequency Distribution',
  };

  const descriptions: Record<StatType, string> = {
    correlation: 'Select numeric columns to compute pairwise Pearson correlations.',
    descriptive: 'Select numeric columns for summary statistics (N, Mean, SD, quartiles).',
    crosstab: 'Select 2 categorical columns for cross-tabulation with chi-square test.',
    ttest: 'Select a group column and a numeric column for comparison.',
    anova: 'Select a group column and a numeric column for one-way ANOVA.',
    regression: 'Select columns: first = dependent (Y), rest = independent (X). Fits OLS regression.',
    normality: 'Select numeric columns to test for normality (Shapiro-Wilk, Kolmogorov-Smirnov).',
    outlier: 'Select numeric columns to detect outliers using IQR and Z-score methods.',
    frequency: 'Select columns to generate frequency distribution tables.',
  };

  const toggleCol = (col: string) => {
    setSelectedCols(prev =>
      prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col]
    );
    setResult(null);
    setError(null);
  };

  const runAnalysis = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/stat/${type}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataset_id: datasetId, columns: selectedCols }),
      });
      if (!res.ok) {
        const text = await res.text();
        try {
          const j = JSON.parse(text);
          throw new Error(j.detail || text);
        } catch (e: any) {
          if (e.message) throw e;
          throw new Error(text);
        }
      }
      setResult(await res.json());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const getAvailableCols = () => {
    if (['correlation', 'descriptive', 'normality', 'outlier', 'regression'].includes(type)) return numericCols;
    return allCols;
  };

  const getMinMax = (): [number, number | undefined] => {
    switch (type) {
      case 'correlation': return [2, undefined];
      case 'descriptive': return [1, undefined];
      case 'crosstab': return [2, 2];
      case 'ttest': return [2, 2];
      case 'anova': return [2, 2];
      case 'regression': return [2, undefined];
      case 'normality': return [1, undefined];
      case 'outlier': return [1, undefined];
      case 'frequency': return [1, undefined];
      default: return [1, undefined];
    }
  };

  const [minCols, maxCols] = getMinMax();

  const getSelectionHint = () => {
    if (type === 'ttest' || type === 'anova') {
      return selectedCols.length > 0 ? (
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
          Group: <strong>{selectedCols[0] || '?'}</strong> | Value: <strong>{selectedCols[1] || '?'}</strong>
        </div>
      ) : null;
    }
    if (type === 'regression' && selectedCols.length > 0) {
      return (
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
          Dependent (Y): <strong>{selectedCols[0] || '?'}</strong> |
          Independent (X): <strong>{selectedCols.slice(1).join(', ') || '?'}</strong>
        </div>
      );
    }
    return null;
  };

  // Render summary cards for regression/normality
  const renderSummary = () => {
    if (!result?.summary) return null;
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        {Object.entries(result.summary).map(([key, val]: [string, any]) => (
          <div key={key} style={{
            background: 'var(--bg-alt, #1e293b)', padding: '8px 14px', borderRadius: 6,
            border: '1px solid var(--border, #334155)', minWidth: 100
          }}>
            <div style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{key}</div>
            <div style={{ fontSize: 16, fontWeight: 600, fontFamily: 'monospace' }}>
              {typeof val === 'number' ? val.toFixed(4) : String(val)}
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()} style={{ maxWidth: 960 }}>
        <div className="modal-header">
          <h2>{titles[type]}</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body" style={{ maxHeight: '75vh', overflow: 'auto' }}>
          <p style={{ color: 'var(--text-dim)', fontSize: 13, marginBottom: 12 }}>{descriptions[type]}</p>

          {/* Column selection */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, display: 'block' }}>
              Select Columns {maxCols ? `(exactly ${maxCols})` : `(at least ${minCols})`}:
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxHeight: 120, overflow: 'auto' }}>
              {getAvailableCols().map(col => (
                <button key={col.name}
                  className={`btn-small ${selectedCols.includes(col.name) ? 'btn-primary' : ''}`}
                  style={{ fontSize: 11 }}
                  onClick={() => {
                    if (maxCols && !selectedCols.includes(col.name) && selectedCols.length >= maxCols) {
                      setSelectedCols(prev => [...prev.slice(0, -1), col.name]);
                    } else {
                      toggleCol(col.name);
                    }
                    setResult(null);
                  }}>
                  {col.name}
                  <span style={{ opacity: 0.5, marginLeft: 4, fontSize: 9 }}>
                    {col.type === 'numeric' ? '#' : 'A'}
                  </span>
                </button>
              ))}
            </div>
            {getSelectionHint()}
          </div>

          <button className="btn-primary" onClick={runAnalysis}
            disabled={loading || selectedCols.length < minCols}
            style={{ marginBottom: 16 }}>
            {loading ? 'Computing...' : 'Run Analysis'}
          </button>

          {error && <div className="error-msg">{error}</div>}

          {/* Summary cards */}
          {result && renderSummary()}

          {/* Results table */}
          {result && (
            <div style={{ overflow: 'auto' }}>
              {result.chi2 !== undefined && (
                <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>
                  Chi-Square = {result.chi2}, p = {result.p_value}, df = {result.dof}
                </div>
              )}
              {result.f_stat !== undefined && (
                <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>
                  F = {result.f_stat}, p = {result.p_value}
                </div>
              )}
              <table className="result-table" style={{ fontSize: 12 }}>
                <thead>
                  <tr>
                    {result.headers.map((h: string, i: number) => (
                      <th key={i} style={{ padding: '6px 10px', fontSize: 11 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row: any[], ri: number) => (
                    <tr key={ri}>
                      {row.map((cell: any, ci: number) => {
                        const isNum = typeof cell === 'number';
                        const isCorr = type === 'correlation' && ci > 0;
                        let cellStyle: React.CSSProperties = { padding: '5px 10px', fontSize: 12 };
                        // Heatmap for correlation matrix
                        if (isCorr && isNum) {
                          const abs = Math.abs(cell);
                          const r = cell >= 0 ? 0 : 220;
                          const g = cell >= 0 ? Math.round(100 + abs * 155) : 0;
                          const b = cell >= 0 ? 0 : Math.round(100 + abs * 155);
                          cellStyle.background = `rgba(${r},${g},${b},${abs * 0.4})`;
                          cellStyle.fontWeight = abs > 0.5 ? 600 : 400;
                        }
                        // Significance highlighting
                        if (typeof cell === 'string' && (cell === '***' || cell === '**' || cell === '*')) {
                          cellStyle.color = cell === '***' ? '#ef4444' : cell === '**' ? '#f59e0b' : '#22c55e';
                          cellStyle.fontWeight = 700;
                        }
                        if (typeof cell === 'string' && cell === 'ns') {
                          cellStyle.color = 'var(--text-dim)';
                        }
                        // Outlier flag highlighting
                        if (type === 'outlier' && typeof cell === 'string' && cell.toLowerCase().includes('outlier')) {
                          cellStyle.color = '#ef4444';
                          cellStyle.fontWeight = 600;
                        }
                        return (
                          <td key={ci} className={isNum ? 'num-cell' : ''} style={cellStyle}>
                            {cell != null ? String(cell) : ''}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Interpretation footnotes */}
              {result.interpretation && (
                <div style={{ marginTop: 12, padding: '8px 12px', background: 'var(--bg-alt, #1e293b)',
                  borderRadius: 6, fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5,
                  border: '1px solid var(--border, #334155)' }}>
                  <strong>Interpretation:</strong> {result.interpretation}
                </div>
              )}

              {/* Significance legend */}
              <div style={{ marginTop: 10, fontSize: 10, color: 'var(--text-dim)' }}>
                *** p&lt;0.001 &nbsp; ** p&lt;0.01 &nbsp; * p&lt;0.05 &nbsp; ns = not significant
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
