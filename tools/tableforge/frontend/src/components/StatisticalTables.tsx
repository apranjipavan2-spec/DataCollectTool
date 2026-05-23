import React, { useState } from 'react';
import { ColumnInfo } from '../types';
import { API_BASE } from '../api';
import { Chart, adaptFrequencyToBar, adaptMatrixToHeatmap, adaptDescriptiveToBox } from './Chart';

type StatType =
  | 'correlation'
  | 'descriptive'
  | 'crosstab'
  | 'ttest'
  | 'anova'
  | 'regression'
  | 'normality'
  | 'outlier'
  | 'frequency'
  | 'paired_ttest'
  | 'wilcoxon'
  | 'mcnemar'
  | 'kruskal'
  | 'friedman'
  | 'spearman'
  | 'kendall'
  | 'logistic_regression'
  | 'multiple_regression'
  | 'posthoc'
  | 'reliability';

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
  const [view, setView] = useState<'table' | 'chart'>('table');
  const [alpha, setAlpha] = useState<number>(0.05);

  const numericCols = columns.filter(c => c.type === 'numeric');
  const allCols = columns;

  const titles: Record<StatType, string> = {
    correlation: 'Correlation Matrix (Pearson)',
    descriptive: 'Descriptive Statistics (Table 1)',
    crosstab: 'Cross-Tabulation + Cramér\u2019s V',
    ttest: 't-Test (Welch) + Cohen\u2019s d',
    anova: 'One-Way ANOVA + \u03b7\u00b2/\u03c9\u00b2',
    regression: 'OLS Regression',
    normality: 'Normality Tests',
    outlier: 'Outlier Detection',
    frequency: 'Frequency Distribution',
    paired_ttest: 'Paired t-Test (Pre vs Post)',
    wilcoxon: 'Wilcoxon Signed-Rank (paired, non-parametric)',
    mcnemar: 'McNemar\u2019s Test (paired binary)',
    kruskal: 'Kruskal-Wallis (non-parametric ANOVA)',
    friedman: 'Friedman Test (repeated measures)',
    spearman: 'Spearman Rank Correlation',
    kendall: 'Kendall\u2019s \u03c4 Correlation',
    logistic_regression: 'Logistic Regression (binary outcome)',
    multiple_regression: 'Multiple Regression (with categorical encoding + VIF)',
    posthoc: 'Post-Hoc Pairwise Comparisons',
    reliability: 'Cronbach\u2019s \u03b1 (scale reliability)',
  };

  const descriptions: Record<StatType, string> = {
    correlation: 'Select numeric columns to compute pairwise Pearson correlations.',
    descriptive: 'Select numeric columns for summary statistics (N, Mean, SD, quartiles).',
    crosstab: 'Select 2 categorical columns. Returns chi-square, Cram\u00e9r\u2019s V, Fisher\u2019s exact (2\u00d72).',
    ttest: 'Select a group column and a numeric column. Welch\u2019s t-test by default; falls back to Mann-Whitney if non-normal.',
    anova: 'Select a group column and a numeric column. Returns F, \u03b7\u00b2, \u03c9\u00b2, and Welch\u2019s F when variances differ.',
    regression: 'Select columns: first = dependent (Y), rest = independent (X). Fits OLS regression.',
    normality: 'Select numeric columns to test for normality (Shapiro-Wilk, Kolmogorov-Smirnov).',
    outlier: 'Select numeric columns to detect outliers using IQR and Z-score methods.',
    frequency: 'Select columns to generate frequency distribution tables.',
    paired_ttest: 'Select PRE column then POST column. Tests within-respondent change with Cohen\u2019s d_z.',
    wilcoxon: 'Select PRE then POST column. Paired non-parametric test, robust to non-normal change scores.',
    mcnemar: 'Select PRE then POST binary column (e.g., No/Yes). Detects net shift in paired binary outcomes.',
    kruskal: 'Select a group column and a numeric column. Non-parametric alternative to one-way ANOVA.',
    friedman: 'Select 3+ repeated-measure columns (same respondents, different timepoints/measures).',
    spearman: 'Select numeric/ordinal columns for rank-based correlation (robust to outliers).',
    kendall: 'Select numeric/ordinal columns for Kendall\u2019s \u03c4 (conservative, handles ties).',
    logistic_regression: 'First column = binary outcome. Rest = predictors. Returns odds ratios + 95% CI + pseudo-R\u00b2.',
    multiple_regression: 'First column = numeric outcome. Rest = predictors (categoricals auto-encoded). Includes VIF.',
    posthoc: 'Select group column then numeric column. Pairwise comparisons after ANOVA (Tukey HSD default).',
    reliability: 'Select \u22652 Likert item columns to compute Cronbach\u2019s \u03b1 and item-rest correlations.',
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
        body: JSON.stringify({ dataset_id: datasetId, columns: selectedCols, alpha }),
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
    const numericOnly = ['correlation', 'descriptive', 'normality', 'outlier', 'regression',
      'spearman', 'kendall', 'paired_ttest', 'wilcoxon', 'friedman', 'reliability',
      'multiple_regression'];
    if (numericOnly.includes(type)) return numericCols;
    return allCols;
  };

  const getMinMax = (): [number, number | undefined] => {
    switch (type) {
      case 'correlation': return [2, undefined];
      case 'spearman': return [2, undefined];
      case 'kendall': return [2, undefined];
      case 'descriptive': return [1, undefined];
      case 'crosstab': return [2, 2];
      case 'ttest': return [2, 2];
      case 'anova': return [2, 2];
      case 'kruskal': return [2, 2];
      case 'regression': return [2, undefined];
      case 'logistic_regression': return [2, undefined];
      case 'multiple_regression': return [2, undefined];
      case 'normality': return [1, undefined];
      case 'outlier': return [1, undefined];
      case 'frequency': return [1, undefined];
      case 'paired_ttest': return [2, 2];
      case 'wilcoxon': return [2, 2];
      case 'mcnemar': return [2, 2];
      case 'friedman': return [3, undefined];
      case 'posthoc': return [2, 2];
      case 'reliability': return [2, undefined];
      default: return [1, undefined];
    }
  };

  const [minCols, maxCols] = getMinMax();

  const getSelectionHint = () => {
    const groupValue = ['ttest', 'anova', 'kruskal', 'posthoc'];
    const prePost = ['paired_ttest', 'wilcoxon', 'mcnemar'];
    const yX = ['regression', 'logistic_regression', 'multiple_regression'];
    if (groupValue.includes(type) && selectedCols.length > 0) {
      return (
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
          Group: <strong>{selectedCols[0] || '?'}</strong> | Value: <strong>{selectedCols[1] || '?'}</strong>
        </div>
      );
    }
    if (prePost.includes(type) && selectedCols.length > 0) {
      return (
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
          PRE: <strong>{selectedCols[0] || '?'}</strong> | POST: <strong>{selectedCols[1] || '?'}</strong>
        </div>
      );
    }
    if (yX.includes(type) && selectedCols.length > 0) {
      const yLabel = type === 'logistic_regression' ? 'Outcome (binary)' : 'Dependent (Y)';
      return (
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
          {yLabel}: <strong>{selectedCols[0] || '?'}</strong> | Predictors: <strong>{selectedCols.slice(1).join(', ') || '?'}</strong>
        </div>
      );
    }
    if (type === 'friedman' && selectedCols.length > 0) {
      return (
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
          Measures (in order): <strong>{selectedCols.join(' → ')}</strong>
        </div>
      );
    }
    if (type === 'reliability' && selectedCols.length > 0) {
      return (
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
          Scale items: <strong>{selectedCols.join(', ')}</strong>
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

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
            <button className="btn-primary" onClick={runAnalysis}
              disabled={loading || selectedCols.length < minCols}>
              {loading ? 'Computing...' : 'Run Analysis'}
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--muted)' }}>
              <span>Significance level (α):</span>
              {[0.10, 0.05, 0.01].map(a => (
                <label key={a} style={{ display: 'flex', alignItems: 'center', gap: 2, cursor: 'pointer' }}>
                  <input type="radio" name="alpha-level" value={a} checked={alpha === a}
                    onChange={() => setAlpha(a)} />
                  <span style={{ fontFamily: 'monospace' }}>{a.toFixed(2)} ({Math.round((1-a)*100)}% CI)</span>
                </label>
              ))}
            </div>
          </div>

          {error && <div className="error-msg">{error}</div>}

          {/* Summary cards */}
          {result && renderSummary()}

          {/* Table / Chart toggle (only when the result can be charted) */}
          {result && (() => {
            const chartable = ['descriptive', 'frequency', 'correlation', 'spearman', 'kendall', 'crosstab'].includes(type);
            if (!chartable) return null;
            return (
              <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                <button className={`btn-small ${view === 'table' ? 'btn-primary' : ''}`} onClick={() => setView('table')} style={{ fontSize: 11 }}>📋 Table</button>
                <button className={`btn-small ${view === 'chart' ? 'btn-primary' : ''}`} onClick={() => setView('chart')} style={{ fontSize: 11 }}>📊 Chart</button>
              </div>
            );
          })()}

          {/* Chart view */}
          {result && view === 'chart' && (() => {
            if (type === 'descriptive') {
              const data = adaptDescriptiveToBox(result.headers, result.rows);
              return data ? <Chart kind="box" data={data} title="Distribution by variable (Min / Q1 / Median / Q3 / Max)" /> : <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>Chart unavailable for this result.</div>;
            }
            if (type === 'frequency') {
              const data = adaptFrequencyToBar(result.headers, result.rows);
              return data ? <Chart kind="bar" data={data} title="Frequency" /> : <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>Chart unavailable for this result.</div>;
            }
            if (type === 'correlation' || type === 'spearman' || type === 'kendall') {
              const data = adaptMatrixToHeatmap(result.headers, result.rows, 'diverging');
              return data ? <Chart kind="heatmap" data={data} title="Correlation heatmap (green = +, red = −)" height={Math.max(300, data.yLabels.length * 36 + 80)} /> : <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>Chart unavailable for this result.</div>;
            }
            if (type === 'crosstab') {
              const data = adaptMatrixToHeatmap(result.headers, result.rows, 'sequential');
              return data ? <Chart kind="heatmap" data={data} title="Cross-tab heatmap (counts)" height={Math.max(300, data.yLabels.length * 36 + 80)} /> : <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>Chart unavailable for this result.</div>;
            }
            return null;
          })()}

          {/* Results table */}
          {result && view === 'table' && (
            <div style={{ overflow: 'auto' }}>
              {result.chi2 !== undefined && (
                <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>
                  χ² = {result.chi2}, p = {result.p_value}{result.dof !== undefined ? `, df = ${result.dof}` : ''}
                  {result.cramers_v !== undefined && result.cramers_v !== null ? `, Cramér's V = ${result.cramers_v}` : ''}
                  {result.fisher_p ? `, Fisher's p = ${result.fisher_p}` : ''}
                </div>
              )}
              {result.f_stat !== undefined && (
                <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>
                  F = {result.f_stat}, p = {result.p_value}
                  {result.eta_squared !== undefined && result.eta_squared !== null ? `, η² = ${result.eta_squared}` : ''}
                  {result.omega_squared !== undefined && result.omega_squared !== null ? `, ω² = ${result.omega_squared}` : ''}
                </div>
              )}
              {result.H !== undefined && (
                <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>
                  Kruskal H = {result.H}, p = {result.p_value}{result.eta_squared !== undefined ? `, η²_H = ${result.eta_squared}` : ''}
                </div>
              )}
              {result.kendalls_w !== undefined && (
                <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>
                  Friedman χ² = {result.chi2}, p = {result.p_value}, Kendall's W = {result.kendalls_w}
                </div>
              )}
              {result.alpha !== undefined && (
                <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>
                  Cronbach's α = {result.alpha}
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
            </div>
          )}

          {/* Interpretation + legend (shown for both views) */}
          {result && result.interpretation && (
            <div style={{ marginTop: 12, padding: '8px 12px', background: 'var(--bg-alt, #1e293b)',
              borderRadius: 6, fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5,
              border: '1px solid var(--border, #334155)' }}>
              <strong>Interpretation:</strong> {result.interpretation}
            </div>
          )}
          {result && (
            <div style={{ marginTop: 10, fontSize: 10, color: 'var(--text-dim)' }}>
              *** p&lt;0.001 &nbsp; ** p&lt;0.01 &nbsp; * p&lt;0.05 &nbsp; ns = not significant
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
