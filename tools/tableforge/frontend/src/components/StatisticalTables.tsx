import React, { useState, useMemo, useRef } from 'react';
import { ColumnInfo } from '../types';
import { API_BASE, getColumnValues } from '../api';
import { Chart, adaptFrequencyToBar, adaptMatrixToHeatmap, adaptDescriptiveToBox } from './Chart';
import { ColPicker } from './ColPicker';

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
  | 'reliability'
  | 'cramers_matrix'
  | 'multinomial_logistic';

interface InsertPayload {
  label: string;
  headers: string[];
  rows: any[][];
  interpretation: string;
  statChart?: { kind: 'bar' | 'box' | 'heatmap'; data: any; title?: string; height?: number };
  chartOnly?: boolean;
  statConfig?: { statType: string; columns: string[]; alpha: number; analysisFilters: Record<string, string[]>; useProjectFilter: boolean };
}

interface InitialConfig {
  columns: string[];
  alpha: number;
  analysisFilters: Record<string, string[]>;
  useProjectFilter: boolean;
}

interface Props {
  type: StatType;
  datasetId: string;
  columns: ColumnInfo[];
  projectFilters?: Record<string, string[]>;
  initialConfig?: InitialConfig;
  onInsert?: (payload: InsertPayload) => void;
  onClose: () => void;
}

export function StatisticalTables({ type, datasetId, columns, projectFilters, initialConfig, onInsert, onClose }: Props) {
  const [selectedCols, setSelectedCols] = useState<string[]>(initialConfig?.columns ?? []);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'table' | 'chart'>('table');
  const [alpha, setAlpha] = useState<number>(initialConfig?.alpha ?? 0.05);
  const projectFilterActive = !!projectFilters && Object.values(projectFilters).some(v => v && v.length > 0);
  const [useProjectFilter, setUseProjectFilter] = useState<boolean>(initialConfig?.useProjectFilter ?? projectFilterActive);

  // Analysis-level subset filter (independent of project filter)
  const [showSubsetFilter, setShowSubsetFilter] = useState(() => !!initialConfig?.analysisFilters && Object.keys(initialConfig.analysisFilters).length > 0);
  const [analysisFilters, setAnalysisFilters] = useState<Record<string, string[]>>(initialConfig?.analysisFilters ?? {});
  const [filterColValues, setFilterColValues] = useState<Record<string, string[]>>({});
  const [filterColSearch, setFilterColSearch] = useState<Record<string, string>>({});
  const [filterColLoading, setFilterColLoading] = useState<Record<string, boolean>>({});
  const [expandedFilterCol, setExpandedFilterCol] = useState<string | null>(null);

  const loadColValues = async (col: string) => {
    if (filterColValues[col]) return;
    setFilterColLoading(prev => ({ ...prev, [col]: true }));
    try {
      const res = await getColumnValues(datasetId, col);
      setFilterColValues(prev => ({ ...prev, [col]: res.values }));
    } finally {
      setFilterColLoading(prev => ({ ...prev, [col]: false }));
    }
  };

  const addFilterCol = async (col: string) => {
    if (!col || analysisFilters[col] !== undefined) return;
    setAnalysisFilters(prev => ({ ...prev, [col]: [] }));
    setExpandedFilterCol(col);
    await loadColValues(col);
  };

  const removeFilterCol = (col: string) => {
    setAnalysisFilters(prev => { const n = { ...prev }; delete n[col]; return n; });
    if (expandedFilterCol === col) setExpandedFilterCol(null);
    setResult(null);
  };

  const toggleFilterValue = (col: string, val: string) => {
    setAnalysisFilters(prev => {
      const cur = prev[col] || [];
      return { ...prev, [col]: cur.includes(val) ? cur.filter(v => v !== val) : [...cur, val] };
    });
    setResult(null);
  };

  const analysisFilterActive = Object.values(analysisFilters).some(v => v.length > 0);

  const [addingColSearch, setAddingColSearch] = useState('');
  const [showColPicker, setShowColPicker] = useState(false);
  const colPickerRef = useRef<HTMLDivElement>(null);
  const addingColInputRef = useRef<HTMLInputElement>(null);
  const [pickerRect, setPickerRect] = useState<{ top: number; left: number; width: number } | null>(null);

  const colIndexMap = useMemo(
    () => Object.fromEntries(columns.map((c, i) => [c.name, i + 1])),
    [columns],
  );

  const availableFilterCols = useMemo(() => {
    const q = addingColSearch.trim().toLowerCase();
    const unfiltered = columns.filter(c => !analysisFilters[c.name]);
    if (!q) return unfiltered;
    return unfiltered.filter(c =>
      c.name.toLowerCase().includes(q) || String(colIndexMap[c.name] ?? '').includes(q)
    );
  }, [columns, analysisFilters, addingColSearch, colIndexMap]);

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
    cramers_matrix: "Cramér\u2019s V Association Matrix",
    multinomial_logistic: 'Multinomial Logistic Regression',
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
    cramers_matrix: 'Select 2+ categorical columns. Returns pairwise chi-square and Cram\u00e9r\u2019s V for every pair \u2014 like a correlation matrix for categorical associations.',
    multinomial_logistic: 'First column = categorical outcome (3+ classes). Rest = predictors (categorical or numeric). Returns log-odds and OR per class vs reference.',
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
        body: JSON.stringify({
          dataset_id: datasetId,
          columns: selectedCols,
          alpha,
          filters: {
            ...(useProjectFilter ? (projectFilters || {}) : {}),
            ...Object.fromEntries(Object.entries(analysisFilters).filter(([, v]) => v.length > 0)),
          },
        }),
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
      case 'cramers_matrix': return [2, undefined];
      case 'multinomial_logistic': return [2, undefined];
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
    if (type === 'multinomial_logistic' && selectedCols.length > 0) {
      return (
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
          Outcome: <strong>{selectedCols[0] || '?'}</strong> | Predictors: <strong>{selectedCols.slice(1).join(', ') || '?'}</strong>
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
      <div className="modal" onClick={e => e.stopPropagation()}
        style={{ maxWidth: '96vw', width: 1100, maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-header" style={{ flexShrink: 0 }}>
          <h2>{titles[type]}</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        {/* Two-column body */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>

          {/* ── LEFT: Controls ── */}
          <div style={{ width: 420, flexShrink: 0, overflowY: 'auto', padding: '12px 14px',
            borderRight: '1px solid var(--border, #334155)' }}>
            <p style={{ color: 'var(--text-dim)', fontSize: 13, marginBottom: 12 }}>{descriptions[type]}</p>

          {projectFilterActive ? (
            <div style={{
              background: useProjectFilter ? 'rgba(56,189,248,0.10)' : 'rgba(148,163,184,0.08)',
              border: `1px solid ${useProjectFilter ? 'rgba(56,189,248,0.35)' : 'rgba(148,163,184,0.30)'}`,
              color: useProjectFilter ? '#7dd3fc' : '#94a3b8',
              borderRadius: 6, padding: '8px 10px', marginBottom: 12, fontSize: 12,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
            }}>
              <div>
                {useProjectFilter
                  ? <>🌐 Using Project Filter — analysis runs on the filtered subset
                      ({Object.entries(projectFilters || {}).filter(([, v]) => v && v.length > 0).map(([k, v]) => `${k} (${v.length})`).join(', ')}).</>
                  : <>⚪ Ignoring Project Filter — this analysis runs on the full dataset.</>}
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', userSelect: 'none' }}>
                <input
                  type="checkbox"
                  checked={useProjectFilter}
                  onChange={e => { setUseProjectFilter(e.target.checked); setResult(null); }}
                />
                <span>Apply project filter to this test</span>
              </label>
            </div>
          ) : null}

          {/* Analysis-level subset filter */}
          <div style={{
            border: '1px solid var(--border, #334155)', borderRadius: 6,
            marginBottom: 12, overflow: 'hidden',
          }}>
            <button
              onClick={() => setShowSubsetFilter(s => !s)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '7px 10px', background: analysisFilterActive ? 'rgba(251,191,36,0.08)' : 'transparent',
                border: 'none', cursor: 'pointer', color: analysisFilterActive ? '#fbbf24' : 'var(--text-dim)',
                fontSize: 12, fontWeight: analysisFilterActive ? 600 : 400,
              }}>
              <span>
                {analysisFilterActive
                  ? `🔍 Subset Filter active — ${Object.entries(analysisFilters).filter(([,v])=>v.length>0).map(([k,v])=>`${k} (${v.length})`).join(', ')}`
                  : '🔍 Subset Filter (run on a data subset for this analysis only)'}
              </span>
              <span style={{ fontSize: 10 }}>{showSubsetFilter ? '▲' : '▼'}</span>
            </button>

            {showSubsetFilter && (
              <div style={{ padding: '8px 10px', borderTop: '1px solid var(--border, #334155)' }}>
                {/* Active filter columns */}
                {Object.keys(analysisFilters).length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                    {Object.entries(analysisFilters).map(([col, vals]) => (
                      <button key={col}
                        onClick={() => { setExpandedFilterCol(expandedFilterCol === col ? null : col); loadColValues(col); }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px',
                          borderRadius: 12, fontSize: 11, cursor: 'pointer',
                          background: expandedFilterCol === col ? 'rgba(251,191,36,0.15)' : 'rgba(255,255,255,0.06)',
                          border: `1px solid ${expandedFilterCol === col ? 'rgba(251,191,36,0.4)' : 'rgba(255,255,255,0.15)'}`,
                          color: vals.length > 0 ? '#fbbf24' : 'var(--text-dim)',
                        }}>
                        <span>{col}{vals.length > 0 ? ` (${vals.length})` : ' — all'}</span>
                        <span onClick={e => { e.stopPropagation(); removeFilterCol(col); }}
                          style={{ marginLeft: 2, opacity: 0.6, fontWeight: 700 }}>×</span>
                      </button>
                    ))}
                  </div>
                )}

                {/* Add column — searchable picker */}
                <div style={{ position: 'relative', marginBottom: expandedFilterCol ? 8 : 0 }} ref={colPickerRef}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input
                      ref={addingColInputRef}
                      type="text"
                      placeholder="Search column by name or #number to add filter…"
                      value={addingColSearch}
                      onFocus={() => {
                        setShowColPicker(true);
                        if (addingColInputRef.current) {
                          const r = addingColInputRef.current.getBoundingClientRect();
                          setPickerRect({ top: r.bottom + 2, left: r.left, width: r.width });
                        }
                      }}
                      onBlur={() => setTimeout(() => setShowColPicker(false), 150)}
                      onChange={e => { setAddingColSearch(e.target.value); setShowColPicker(true); }}
                      style={{
                        flex: 1, padding: '4px 8px', fontSize: 11, borderRadius: 4,
                        background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.18)',
                        color: 'inherit', outline: 'none',
                      }}
                    />
                    {analysisFilterActive && (
                      <button onClick={() => { setAnalysisFilters({}); setExpandedFilterCol(null); setResult(null); }}
                        style={{ fontSize: 11, padding: '4px 8px', borderRadius: 4, cursor: 'pointer', whiteSpace: 'nowrap',
                          background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', color: 'var(--text-dim)' }}>
                        Clear all
                      </button>
                    )}
                  </div>
                  {showColPicker && pickerRect && availableFilterCols.length > 0 && (
                    <div style={{
                      position: 'fixed', top: pickerRect.top, left: pickerRect.left, width: pickerRect.width,
                      zIndex: 9999,
                      background: 'var(--bg, #0f172a)', border: '1px solid rgba(255,255,255,0.18)',
                      borderRadius: 4, maxHeight: 180, overflowY: 'auto',
                      boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
                    }}>
                      {availableFilterCols.map(c => {
                        const idx = colIndexMap[c.name] ?? 0;
                        const TYPE_COLOR: Record<string, string> = {
                          numeric: '#3b82f6', text: '#22c55e', date: '#f59e0b', boolean: '#a855f7', multi_choice: '#ec4899',
                        };
                        const TYPE_ICON: Record<string, string> = {
                          numeric: '#', text: 'Aa', date: 'D', boolean: '01', multi_choice: 'M',
                        };
                        return (
                          <div key={c.name}
                            onMouseDown={() => { addFilterCol(c.name); setAddingColSearch(''); setShowColPicker(false); }}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px',
                              cursor: 'pointer', fontSize: 11,
                            }}
                            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(251,191,36,0.12)')}
                            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                          >
                            <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace', minWidth: 24, textAlign: 'right' }}>
                              #{idx}
                            </span>
                            <span style={{
                              fontSize: 8, fontWeight: 700, padding: '1px 3px', borderRadius: 2, flexShrink: 0,
                              color: TYPE_COLOR[c.type] || '#888', background: `${TYPE_COLOR[c.type] || '#888'}22`,
                            }}>
                              {TYPE_ICON[c.type] || '?'}
                            </span>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {showColPicker && pickerRect && availableFilterCols.length === 0 && addingColSearch.trim() && (
                    <div style={{
                      position: 'fixed', top: pickerRect.top, left: pickerRect.left, width: pickerRect.width,
                      zIndex: 9999,
                      background: 'var(--bg, #0f172a)', border: '1px solid rgba(255,255,255,0.18)',
                      borderRadius: 4, padding: '8px', fontSize: 11, color: 'var(--text-dim)',
                      boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
                    }}>
                      No columns match
                    </div>
                  )}
                </div>

                {/* Value picker for expanded column */}
                {expandedFilterCol && analysisFilters[expandedFilterCol] !== undefined && (
                  <div style={{
                    border: '1px solid rgba(251,191,36,0.2)', borderRadius: 4,
                    padding: '6px 8px', background: 'rgba(0,0,0,0.2)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: '#fbbf24' }}>{expandedFilterCol}</span>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => setAnalysisFilters(prev => ({ ...prev, [expandedFilterCol]: [...(filterColValues[expandedFilterCol] || [])] }))}
                          style={{ fontSize: 10, padding: '2px 6px', cursor: 'pointer', borderRadius: 3,
                            background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', color: 'var(--text-dim)' }}>
                          All
                        </button>
                        <button onClick={() => setAnalysisFilters(prev => ({ ...prev, [expandedFilterCol]: [] }))}
                          style={{ fontSize: 10, padding: '2px 6px', cursor: 'pointer', borderRadius: 3,
                            background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', color: 'var(--text-dim)' }}>
                          None
                        </button>
                      </div>
                    </div>
                    <input
                      type="text"
                      placeholder="Search values…"
                      value={filterColSearch[expandedFilterCol] || ''}
                      onChange={e => setFilterColSearch(prev => ({ ...prev, [expandedFilterCol]: e.target.value }))}
                      style={{
                        width: '100%', padding: '3px 6px', fontSize: 11, marginBottom: 6,
                        background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.12)',
                        borderRadius: 3, color: 'inherit', boxSizing: 'border-box',
                      }}
                    />
                    {filterColLoading[expandedFilterCol] ? (
                      <div style={{ fontSize: 11, color: 'var(--text-dim)', padding: '4px 0' }}>Loading values…</div>
                    ) : (
                      <div style={{ maxHeight: 140, overflowY: 'auto', display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                        {(filterColValues[expandedFilterCol] || [])
                          .filter(v => !(filterColSearch[expandedFilterCol] || '').trim() ||
                            v.toLowerCase().includes((filterColSearch[expandedFilterCol] || '').toLowerCase()))
                          .map(v => {
                            const checked = (analysisFilters[expandedFilterCol] || []).includes(v);
                            return (
                              <label key={v} style={{
                                display: 'flex', alignItems: 'center', gap: 4, padding: '2px 7px',
                                borderRadius: 10, cursor: 'pointer', fontSize: 11,
                                background: checked ? 'rgba(251,191,36,0.15)' : 'rgba(255,255,255,0.04)',
                                border: `1px solid ${checked ? 'rgba(251,191,36,0.4)' : 'rgba(255,255,255,0.1)'}`,
                                userSelect: 'none',
                              }}>
                                <input type="checkbox" checked={checked}
                                  onChange={() => toggleFilterValue(expandedFilterCol, v)}
                                  style={{ margin: 0, width: 11, height: 11, accentColor: '#fbbf24' }} />
                                <span>{v}</span>
                              </label>
                            );
                          })}
                      </div>
                    )}
                    <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 5 }}>
                      {(analysisFilters[expandedFilterCol] || []).length === 0
                        ? 'No values selected — all data used'
                        : `${(analysisFilters[expandedFilterCol] || []).length} of ${(filterColValues[expandedFilterCol] || []).length} values selected`}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Column selection */}
          <div style={{ marginBottom: 16 }}>
            <ColPicker
              allColumns={columns}
              available={getAvailableCols()}
              selected={selectedCols}
              label={`Select Columns ${maxCols ? `(exactly ${maxCols})` : `(at least ${minCols})`}`}
              height={200}
              onToggle={name => {
                if (maxCols && !selectedCols.includes(name) && selectedCols.length >= maxCols) {
                  setSelectedCols(prev => [...prev.slice(0, -1), name]);
                } else {
                  toggleCol(name);
                }
                setResult(null);
              }}
              selectionHint={getSelectionHint()}
            />
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
          </div>{/* end LEFT column */}

          {/* ── RIGHT: Results ── */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', minWidth: 0 }}>

            {/* Empty state */}
            {!result && !loading && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', height: '100%', color: 'var(--text-dim)', textAlign: 'center' }}>
                <span style={{ fontSize: 36, marginBottom: 10 }}>📊</span>
                <p style={{ fontSize: 13 }}>Configure your analysis on the left<br />then click <strong>Run Analysis</strong></p>
              </div>
            )}

            {loading && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
                height: '100%', color: 'var(--text-dim)', fontSize: 13 }}>
                Computing…
              </div>
            )}

            {/* Summary cards */}
            {result && renderSummary()}

            {/* Table / Chart toggle */}
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
              const sc = buildStatChart(type, result);
              return sc
                ? <Chart kind={sc.kind as any} data={sc.data} title={sc.title} height={sc.height} />
                : <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>Chart unavailable for this result.</div>;
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
                          if (isCorr && isNum) {
                            const abs = Math.abs(cell);
                            const r = cell >= 0 ? 0 : 220;
                            const g = cell >= 0 ? Math.round(100 + abs * 155) : 0;
                            const b = cell >= 0 ? 0 : Math.round(100 + abs * 155);
                            cellStyle.background = `rgba(${r},${g},${b},${abs * 0.4})`;
                            cellStyle.fontWeight = abs > 0.5 ? 600 : 400;
                          }
                          if (typeof cell === 'string' && (cell === '***' || cell === '**' || cell === '*')) {
                            cellStyle.color = cell === '***' ? '#ef4444' : cell === '**' ? '#f59e0b' : '#22c55e';
                            cellStyle.fontWeight = 700;
                          }
                          if (typeof cell === 'string' && cell === 'ns') {
                            cellStyle.color = 'var(--text-dim)';
                          }
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

            {/* Interpretation + legend */}
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

            {/* Insert into workspace */}
            {result && onInsert && (() => {
              const sc = buildStatChart(type, result);
              const label = titles[type];
              const interpretation = result.interpretation || '';
              const headers: string[] = result.headers || [];
              const rows: any[][] = result.rows || [];
              const cfg = { statType: type, columns: selectedCols, alpha, analysisFilters, useProjectFilter };
              const doInsert = (mode: 'table' | 'chart' | 'both') => {
                if (mode === 'table' || !sc) {
                  onInsert({ label, headers, rows, interpretation, statConfig: cfg });
                } else if (mode === 'chart') {
                  onInsert({ label, headers, rows, interpretation, statChart: sc, chartOnly: true, statConfig: cfg });
                } else {
                  onInsert({ label, headers, rows, interpretation, statChart: sc, statConfig: cfg });
                }
                onClose();
              };
              return (
                <div style={{ display: 'flex', gap: 8, marginTop: 14, paddingTop: 12,
                  borderTop: '1px solid var(--border, #334155)', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, color: 'var(--text-dim)', alignSelf: 'center',
                    textTransform: 'uppercase', letterSpacing: 0.5, marginRight: 4 }}>
                    Insert into workspace:
                  </span>
                  <button className="btn-primary" style={{ fontSize: 12 }} onClick={() => doInsert('table')}>📋 Table</button>
                  <button className="btn-primary" style={{ fontSize: 12, opacity: sc ? 1 : 0.5 }}
                    disabled={!sc} onClick={() => doInsert('chart')}
                    title={sc ? 'Insert as a chart-only card' : 'No chart available for this test'}>
                    📊 Chart
                  </button>
                  <button className="btn-primary" style={{ fontSize: 12, opacity: sc ? 1 : 0.5 }}
                    disabled={!sc} onClick={() => doInsert('both')}
                    title={sc ? 'Insert one card showing both table and chart' : 'No chart available for this test'}>
                    📋📊 Both
                  </button>
                </div>
              );
            })()}
          </div>{/* end RIGHT column */}

        </div>{/* end two-column body */}
      </div>
    </div>
  );
}

// Build a Chart-component-compatible payload from a stat result.
// Returns null when the test has no canonical chart representation.
function buildStatChart(
  type: StatType,
  result: { headers: string[]; rows: any[][] },
): { kind: 'bar' | 'box' | 'heatmap'; data: any; title?: string; height?: number } | null {
  if (!result || !result.headers || !result.rows) return null;
  if (type === 'descriptive') {
    const data = adaptDescriptiveToBox(result.headers, result.rows);
    return data ? { kind: 'box', data, title: 'Distribution by variable (Min / Q1 / Median / Q3 / Max)' } : null;
  }
  if (type === 'frequency') {
    const data = adaptFrequencyToBar(result.headers, result.rows);
    return data ? { kind: 'bar', data, title: 'Frequency' } : null;
  }
  if (type === 'correlation' || type === 'spearman' || type === 'kendall') {
    const data = adaptMatrixToHeatmap(result.headers, result.rows, 'diverging');
    return data
      ? { kind: 'heatmap', data, title: 'Correlation heatmap (green = +, red = −)',
          height: Math.max(300, data.yLabels.length * 36 + 80) }
      : null;
  }
  if (type === 'crosstab') {
    const data = adaptMatrixToHeatmap(result.headers, result.rows, 'sequential');
    return data
      ? { kind: 'heatmap', data, title: 'Cross-tab heatmap (counts)',
          height: Math.max(300, data.yLabels.length * 36 + 80) }
      : null;
  }
  if (type === 'cramers_matrix') {
    const data = adaptMatrixToHeatmap(result.headers, result.rows, 'sequential');
    return data
      ? { kind: 'heatmap', data, title: "Cramér\u2019s V heatmap (0 = no association, 1 = perfect)",
          height: Math.max(300, data.yLabels.length * 36 + 80) }
      : null;
  }
  return null;
}
