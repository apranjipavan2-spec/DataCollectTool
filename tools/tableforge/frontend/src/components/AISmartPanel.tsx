import React, { useState, useEffect } from 'react';
import { TableConfig, DatasetMeta, TableResult } from '../types';
import { API_BASE } from '../api';

interface Props {
  mode: 'polish' | 'interpret' | 'refine' | 'suggest' | 'smart-build' | 'auto-generate' | 'report' | 'config';
  table: TableConfig | null;
  tables: TableConfig[];
  allResults: Map<string, TableResult>;
  dataset: DatasetMeta | null;
  result: TableResult | null;
  interpretation?: string;
  onClose: () => void;
  onApplyPolish?: (title: string, subtitle: string, renames: Record<string, string>) => void;
  onApplyPolishAll?: (updates: { tableId: string; title: string; subtitle: string; renames: Record<string, string> }[]) => void;
  onApplyInterpretation?: (text: string) => void;
  onApplyInterpretationAll?: (updates: { tableId: string; text: string }[]) => void;
  onApplySuggestion?: (tables: any[]) => void;
  onApplySmartBuild?: (config: any) => void;
}

const FOCUS_TEMPLATES = [
  { key: 'general', label: 'General Overview', prompt: '' },
  { key: 'distribution', label: 'Distribution & Spread', prompt: 'Focus on how values are distributed — concentrations, spreads, and gaps between groups.' },
  { key: 'high_low', label: 'High vs Low Performers', prompt: 'Compare the highest and lowest performers — what separates them, and by how much.' },
  { key: 'comparison', label: 'Group Comparison', prompt: 'Compare groups side by side — which are similar, which differ, and what drives the differences.' },
  { key: 'equity', label: 'Equity & Disparity', prompt: 'Identify equity gaps and disparities — which groups are underserved or over-represented.' },
  { key: 'trend', label: 'Change Over Time', prompt: 'Focus on temporal patterns — what is improving, declining, or stable.' },
  { key: 'outlier', label: 'Outlier & Anomaly', prompt: 'Highlight anomalies and outliers — values that deviate significantly from the pattern.' },
  { key: 'performance', label: 'Program Performance', prompt: 'Evaluate program effectiveness — what targets are met, what needs intervention.' },
];

const REPORT_STYLES = [
  { key: 'field_survey', label: 'Field Survey' },
  { key: 'progress', label: 'Progress Report' },
  { key: 'research', label: 'Academic Research' },
  { key: 'government', label: 'Government Report' },
  { key: 'ngo', label: 'NGO Impact Report' },
  { key: 'executive', label: 'Executive Summary' },
];

export function AISmartPanel({ mode, table, tables, allResults, dataset, result, interpretation, onClose, onApplyPolish, onApplyPolishAll, onApplyInterpretation, onApplyInterpretationAll, onApplySuggestion, onApplySmartBuild }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [aiResult, setAiResult] = useState<any>(null);

  // Scope: single table or all tables
  const [scope, setScope] = useState<'single' | 'all'>('single');

  // Interpret state
  const [focus, setFocus] = useState('');
  const [customFocus, setCustomFocus] = useState('');
  const [interpretLength, setInterpretLength] = useState<'auto' | 'short' | 'medium' | 'long'>('auto');
  const [includeRecommendations, setIncludeRecommendations] = useState(true);

  // Smart build state
  const [query, setQuery] = useState('');
  const [selectedCols, setSelectedCols] = useState<string[]>([]);

  // Auto-generate state
  const [tableDescriptions, setTableDescriptions] = useState('');
  const [maxTables, setMaxTables] = useState(20);
  const [selectedAutoTables, setSelectedAutoTables] = useState<Set<number>>(new Set());

  // Report state
  const [reportStyle, setReportStyle] = useState('field_survey');
  const [customContext, setCustomContext] = useState('');

  // Config state
  const [configProvider, setConfigProvider] = useState('');
  const [configApiKey, setConfigApiKey] = useState('');
  const [configModel, setConfigModel] = useState('');
  const [configHasKey, setConfigHasKey] = useState(false);
  const [availableModels, setAvailableModels] = useState<Record<string, { id: string; name: string }[]>>({});

  useEffect(() => {
    if (mode === 'config') {
      fetch(`${API_BASE}/ai/config`).then(r => r.json()).then(d => {
        setConfigProvider(d.provider || '');
        setConfigModel(d.model || '');
        setConfigHasKey(d.has_key || false);
        if (d.models) setAvailableModels(d.models);
      }).catch(() => {});
    }
  }, [mode]);

  const handlePolish = async () => {
    if (!dataset) return;
    setLoading(true); setError('');
    try {
      const targetTables = scope === 'all' ? tables : (table ? [table] : []);
      const allPolishResults: any[] = [];
      for (const t of targetTables) {
        const r = allResults.get(t.id);
        if (!r) continue;
        const res = await fetch(`${API_BASE}/ai/polish`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            dataset_id: dataset.dataset_id,
            table_title: t.title || t.name,
            rows: t.rows,
            columns: t.columns,
            values: t.values,
            headers: r.headers,
            sample_rows: r.rows.slice(0, 15),
          }),
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        allPolishResults.push({ tableId: t.id, tableName: t.title || t.name, ...data });
      }
      setAiResult(scope === 'all' ? { allTables: allPolishResults } : allPolishResults[0]);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const handleInterpret = async (refine = false) => {
    if (!dataset) return;
    setLoading(true); setError('');
    const templateFocus = FOCUS_TEMPLATES.find(f => f.key === focus)?.prompt || '';
    const focusText = [templateFocus, customFocus].filter(Boolean).join(' Additionally: ');
    try {
      const targetTables = scope === 'all' ? tables : (table ? [table] : []);
      const allInterpretResults: any[] = [];
      for (const t of targetTables) {
        const r = allResults.get(t.id);
        if (!r) continue;
        const res = await fetch(`${API_BASE}/ai/interpret`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            dataset_id: dataset.dataset_id,
            table_title: t.title || t.name,
            subtitle: t.subtitle || '',
            headers: r.headers,
            rows_data: r.rows.slice(0, 80),
            row_fields: t.rows,
            column_fields: t.columns,
            value_fields: t.values,
            focus: focusText,
            length: interpretLength,
            include_recommendations: includeRecommendations,
            previous_interpretation: refine ? (interpretation || '') : '',
          }),
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        allInterpretResults.push({ tableId: t.id, tableName: t.title || t.name, ...data });
      }
      setAiResult(scope === 'all' ? { allTables: allInterpretResults } : allInterpretResults[0]);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const handleSuggest = async () => {
    if (!dataset) return;
    setLoading(true); setError('');
    try {
      const res = await fetch(`${API_BASE}/ai/suggest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataset_id: dataset.dataset_id, prompt: query }),
      });
      if (!res.ok) throw new Error(await res.text());
      setAiResult(await res.json());
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const handleSmartBuild = async () => {
    if (!dataset) return;
    setLoading(true); setError('');
    try {
      const res = await fetch(`${API_BASE}/ai/smart-build`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataset_id: dataset.dataset_id, selected_columns: selectedCols, query }),
      });
      if (!res.ok) throw new Error(await res.text());
      setAiResult(await res.json());
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const handleAutoGenerate = async () => {
    if (!dataset) return;
    setLoading(true); setError('');
    try {
      const res = await fetch(`${API_BASE}/ai/auto-generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataset_id: dataset.dataset_id, table_descriptions: tableDescriptions, max_tables: maxTables }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setAiResult(data);
      if (data.tables) setSelectedAutoTables(new Set(data.tables.map((_: any, i: number) => i)));
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const handleReport = async () => {
    if (!dataset) return;
    setLoading(true); setError('');
    try {
      const tablesData = result && table ? [{ title: table.title || table.name, headers: result.headers, rows: result.rows }] : [];
      const res = await fetch(`${API_BASE}/ai/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dataset_id: dataset.dataset_id,
          tables_data: tablesData,
          style: reportStyle,
          custom_context: customContext,
          filename: dataset.filename,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setAiResult(await res.json());
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const handleSaveConfig = async () => {
    setLoading(true); setError('');
    try {
      const res = await fetch(`${API_BASE}/ai/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: configProvider, api_key: configApiKey, model: configModel }),
      });
      if (!res.ok) throw new Error(await res.text());
      setAiResult({ status: 'Configuration saved!' });
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const renderContent = () => {
    switch (mode) {
      case 'polish':
        return (
          <div className="ai-panel-body">
            <p className="ai-desc">AI will analyze your table and suggest a clean title, subtitle, and column labels.</p>
            {tables.length > 1 && !aiResult && (
              <div className="ai-scope-select" style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <button className={`fdrop-token ${scope === 'single' ? 'active' : ''}`}
                  style={{ padding: '4px 12px', background: scope === 'single' ? 'rgba(59,130,246,0.3)' : undefined }}
                  onClick={() => setScope('single')}>Current Table</button>
                <button className={`fdrop-token ${scope === 'all' ? 'active' : ''}`}
                  style={{ padding: '4px 12px', background: scope === 'all' ? 'rgba(59,130,246,0.3)' : undefined }}
                  onClick={() => setScope('all')}>All Tables ({tables.length})</button>
              </div>
            )}
            {!aiResult && <button className="btn-primary" onClick={handlePolish} disabled={loading}>{loading ? 'Generating...' : '✨ Polish Title & Headers'}</button>}
            {aiResult?.allTables ? (
              <div className="ai-result">
                {aiResult.allTables.map((tr: any, idx: number) => (
                  <div key={tr.tableId} style={{ marginBottom: 16, padding: 10, background: 'rgba(0,0,0,0.1)', borderRadius: 6 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>Table {idx + 1}: {tr.tableName}</div>
                    <div className="ai-result-field"><label>Title:</label><strong>{tr.title}</strong></div>
                    <div className="ai-result-field"><label>Subtitle:</label><em>{tr.subtitle}</em></div>
                    {tr.column_labels && Object.keys(tr.column_labels).length > 0 && (
                      <div className="ai-result-field">
                        <label>Column Labels:</label>
                        <div className="ai-labels-grid">
                          {Object.entries(tr.column_labels).map(([k, v]) => (
                            <div key={k} className="ai-label-row"><span className="ai-label-key">{k}</span><span>→</span><span className="ai-label-val">{v as string}</span></div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                <button className="btn-primary" style={{ marginTop: 12 }} onClick={() => {
                  onApplyPolishAll?.(aiResult.allTables.map((tr: any) => ({ tableId: tr.tableId, title: tr.title, subtitle: tr.subtitle, renames: tr.column_labels || {} })));
                  onClose();
                }}>Apply All Changes</button>
              </div>
            ) : aiResult && (
              <div className="ai-result">
                <div className="ai-result-field"><label>Title:</label><strong>{aiResult.title}</strong></div>
                <div className="ai-result-field"><label>Subtitle:</label><em>{aiResult.subtitle}</em></div>
                {aiResult.column_labels && Object.keys(aiResult.column_labels).length > 0 && (
                  <div className="ai-result-field">
                    <label>Column Labels:</label>
                    <div className="ai-labels-grid">
                      {Object.entries(aiResult.column_labels).map(([k, v]) => (
                        <div key={k} className="ai-label-row"><span className="ai-label-key">{k}</span><span>→</span><span className="ai-label-val">{v as string}</span></div>
                      ))}
                    </div>
                  </div>
                )}
                <button className="btn-primary" style={{ marginTop: 12 }} onClick={() => {
                  onApplyPolish?.(aiResult.title, aiResult.subtitle, aiResult.column_labels || {});
                  onClose();
                }}>Apply Changes</button>
              </div>
            )}
          </div>
        );

      case 'interpret':
      case 'refine':
        return (
          <div className="ai-panel-body">
            <p className="ai-desc">{mode === 'refine' ? 'AI will refine your existing interpretation.' : 'AI will generate a narrative interpretation of the table data.'}</p>
            {tables.length > 1 && !aiResult && (
              <div className="ai-scope-select" style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <button className={`fdrop-token ${scope === 'single' ? 'active' : ''}`}
                  style={{ padding: '4px 12px', background: scope === 'single' ? 'rgba(59,130,246,0.3)' : undefined }}
                  onClick={() => setScope('single')}>Current Table</button>
                <button className={`fdrop-token ${scope === 'all' ? 'active' : ''}`}
                  style={{ padding: '4px 12px', background: scope === 'all' ? 'rgba(59,130,246,0.3)' : undefined }}
                  onClick={() => setScope('all')}>All Tables ({tables.length})</button>
              </div>
            )}
            <div className="ai-focus-select">
              <label>Focus:</label>
              <select value={focus} onChange={e => setFocus(e.target.value)} className="fdrop-select">
                {FOCUS_TEMPLATES.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
            </div>
            <div className="ai-focus-custom">
              <input type="text" value={customFocus} onChange={e => setCustomFocus(e.target.value)}
                placeholder="Add custom instructions (combines with focus above)..." className="fdrop-input" style={{ width: '100%' }} />
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <label style={{ fontSize: 11, color: 'var(--text-dim)' }}>Length:</label>
              {(['auto', 'short', 'medium', 'long'] as const).map(l => (
                <button key={l} className={`fdrop-token ${interpretLength === l ? 'active' : ''}`}
                  style={{ fontSize: 11, padding: '2px 8px', textTransform: 'capitalize', background: interpretLength === l ? 'rgba(59,130,246,0.3)' : undefined }}
                  onClick={() => setInterpretLength(l)}>{l}</button>
              ))}
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-dim)', marginBottom: 10, cursor: 'pointer' }}>
              <input type="checkbox" checked={includeRecommendations} onChange={e => setIncludeRecommendations(e.target.checked)} />
              Include recommendations & conclusions
            </label>
            {!aiResult && <button className="btn-primary" onClick={() => handleInterpret(mode === 'refine')} disabled={loading}>
              {loading ? 'Generating...' : mode === 'refine' ? '🔄 Refine Interpretation' : '📝 Generate Interpretation'}
            </button>}
            {aiResult?.allTables ? (
              <div className="ai-result">
                {aiResult.allTables.map((tr: any, idx: number) => (
                  <div key={tr.tableId} style={{ marginBottom: 16, padding: 10, background: 'rgba(0,0,0,0.1)', borderRadius: 6 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>Table {idx + 1}: {tr.tableName}</div>
                    <div className="ai-interpretation-text">{tr.interpretation}</div>
                  </div>
                ))}
                <button className="btn-primary" style={{ marginTop: 12 }} onClick={() => {
                  onApplyInterpretationAll?.(aiResult.allTables.map((tr: any) => ({ tableId: tr.tableId, text: tr.interpretation })));
                  onClose();
                }}>Apply All Interpretations</button>
              </div>
            ) : aiResult?.interpretation && (
              <div className="ai-result">
                <div className="ai-interpretation-text">{aiResult.interpretation}</div>
                <button className="btn-primary" style={{ marginTop: 12 }} onClick={() => {
                  onApplyInterpretation?.(aiResult.interpretation);
                  onClose();
                }}>Apply Interpretation</button>
              </div>
            )}
          </div>
        );

      case 'suggest':
        return (
          <div className="ai-panel-body">
            <p className="ai-desc">AI will analyze your dataset and suggest optimal table configurations.</p>
            <input type="text" value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Optional: describe what you want to analyze..." className="fdrop-input" style={{ width: '100%', marginBottom: 10 }} />
            {!aiResult && <button className="btn-primary" onClick={handleSuggest} disabled={loading}>{loading ? 'Thinking...' : '💡 Suggest Tables'}</button>}
            {aiResult?.tables && (
              <div className="ai-result">
                {aiResult.rationale && <p className="ai-rationale"><em>{aiResult.rationale}</em></p>}
                <div className="ai-suggestions">
                  {aiResult.tables.map((t: any, i: number) => (
                    <div key={i} className="ai-suggestion-card">
                      <strong>{t.title || `Table ${i + 1}`}</strong>
                      <p>{t.description}</p>
                      <div className="ai-suggestion-meta">
                        Rows: {t.groupby_field} | Values: {t.value_field} ({t.aggregation})
                        {t.secondary_groupby && ` | Columns: ${t.secondary_groupby}`}
                      </div>
                    </div>
                  ))}
                </div>
                <button className="btn-primary" style={{ marginTop: 12 }} onClick={() => {
                  onApplySuggestion?.(aiResult.tables);
                  onClose();
                }}>Create These Tables</button>
              </div>
            )}
          </div>
        );

      case 'smart-build':
        return (
          <div className="ai-panel-body">
            <p className="ai-desc">AI designs one optimized table from your columns or question.</p>
            <input type="text" value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Ask a question about your data (or leave empty for best suggestion)..." className="fdrop-input" style={{ width: '100%', marginBottom: 10 }} />
            {dataset && (
              <div className="ai-col-picker" style={{ maxHeight: 180, overflow: 'auto', marginBottom: 10 }}>
                <label style={{ fontSize: 11, color: 'var(--text-dim)' }}>Select columns (optional):</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4 }}>
                  {dataset.columns.map((c, idx) => (
                    <button key={c.name}
                      className={`fdrop-token ${selectedCols.includes(c.name) ? 'active' : ''}`}
                      style={{ fontSize: 11, padding: '3px 8px', textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', background: selectedCols.includes(c.name) ? 'rgba(59,130,246,0.3)' : undefined }}
                      onClick={() => setSelectedCols(prev => prev.includes(c.name) ? prev.filter(x => x !== c.name) : [...prev, c.name])}>
                      <span style={{ color: 'var(--text-dim)', marginRight: 6, minWidth: 18, display: 'inline-block' }}>{idx + 1}.</span>{c.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {!aiResult && <button className="btn-primary" onClick={handleSmartBuild} disabled={loading}>{loading ? 'Building...' : '🧠 Smart Build Table'}</button>}
            {aiResult?.groupby_field && (
              <div className="ai-result">
                <div className="ai-result-field"><label>Title:</label><strong>{aiResult.title}</strong></div>
                <div className="ai-result-field"><label>Description:</label>{aiResult.description}</div>
                <div className="ai-suggestion-meta" style={{ marginTop: 8 }}>
                  Rows: {aiResult.groupby_field} | Values: {aiResult.value_field} ({aiResult.aggregation})
                  {aiResult.secondary_groupby && ` | Columns: ${aiResult.secondary_groupby}`}
                </div>
                <button className="btn-primary" style={{ marginTop: 12 }} onClick={() => {
                  onApplySmartBuild?.(aiResult);
                  onClose();
                }}>Create This Table</button>
              </div>
            )}
          </div>
        );

      case 'auto-generate':
        return (
          <div className="ai-panel-body">
            <p className="ai-desc">AI analyzes all columns and generates a comprehensive set of tables. Optionally provide a list of tables you need.</p>
            <textarea value={tableDescriptions} onChange={e => setTableDescriptions(e.target.value)}
              placeholder={"Describe the tables you need (optional). Example:\n- Demographics by district\n- Income source by beneficiary type\n- Average landholding by region\n\nLeave empty for AI to decide."}
              className="fdrop-input" style={{ width: '100%', minHeight: 80, resize: 'vertical', marginBottom: 10, fontSize: 12 }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <label style={{ fontSize: 11, color: 'var(--text-dim)' }}>Max tables:</label>
              <input type="range" min={5} max={50} value={maxTables} onChange={e => setMaxTables(Number(e.target.value))}
                style={{ flex: 1 }} />
              <span style={{ fontSize: 12, minWidth: 24 }}>{maxTables}</span>
            </div>
            {!aiResult && <button className="btn-primary" onClick={handleAutoGenerate} disabled={loading}>{loading ? 'Generating...' : '🚀 Auto-Generate Tables'}</button>}
            {aiResult?.tables && (
              <div className="ai-result">
                <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>{aiResult.tables.length} tables generated — select which to create:</div>
                <div style={{ maxHeight: 300, overflow: 'auto' }}>
                  {aiResult.tables.map((t: any, i: number) => (
                    <label key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, padding: '6px 4px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      <input type="checkbox" checked={selectedAutoTables.has(i)}
                        onChange={() => setSelectedAutoTables(prev => {
                          const next = new Set(prev);
                          next.has(i) ? next.delete(i) : next.add(i);
                          return next;
                        })} style={{ marginTop: 2 }} />
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600 }}>{t.title || `Table ${i + 1}`}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{t.description}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-dim)', opacity: 0.7 }}>
                          Rows: {t.groupby_field} | Values: {t.value_field} ({t.aggregation}){t.secondary_groupby && ` | Columns: ${t.secondary_groupby}`}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button className="btn-primary" onClick={() => {
                    const selected = aiResult.tables.filter((_: any, i: number) => selectedAutoTables.has(i));
                    onApplySuggestion?.(selected);
                    onClose();
                  }}>Create {selectedAutoTables.size} Tables</button>
                  <button className="fdrop-btn-action" style={{ fontSize: 11 }} onClick={() => {
                    selectedAutoTables.size === aiResult.tables.length
                      ? setSelectedAutoTables(new Set())
                      : setSelectedAutoTables(new Set(aiResult.tables.map((_: any, i: number) => i)));
                  }}>{selectedAutoTables.size === aiResult.tables.length ? 'Deselect All' : 'Select All'}</button>
                </div>
              </div>
            )}
          </div>
        );

      case 'report':
        return (
          <div className="ai-panel-body">
            <p className="ai-desc">Generate a full analysis report from your tables.</p>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <select value={reportStyle} onChange={e => setReportStyle(e.target.value)} className="fdrop-select">
                {REPORT_STYLES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </div>
            <textarea value={customContext} onChange={e => setCustomContext(e.target.value)}
              placeholder="Additional context for the report (optional)..." className="fdrop-input"
              style={{ width: '100%', minHeight: 60, resize: 'vertical', marginBottom: 10 }} />
            {!aiResult && <button className="btn-primary" onClick={handleReport} disabled={loading}>{loading ? 'Writing Report...' : '📄 Generate Report'}</button>}
            {aiResult?.report && (
              <div className="ai-result">
                <div className="ai-report-text" style={{ whiteSpace: 'pre-wrap', maxHeight: 400, overflow: 'auto', padding: 12, background: 'rgba(0,0,0,0.2)', borderRadius: 6, fontSize: 13 }}>
                  {aiResult.report}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button className="btn-primary" onClick={() => {
                    navigator.clipboard.writeText(aiResult.report);
                  }}>Copy to Clipboard</button>
                  <button className="fdrop-btn-action" onClick={() => {
                    const blob = new Blob([aiResult.report], { type: 'text/markdown' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a'); a.href = url; a.download = 'report.md';
                    document.body.appendChild(a); a.click(); document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                  }}>Download .md</button>
                </div>
              </div>
            )}
          </div>
        );

      case 'config':
        const providerModels = availableModels[configProvider] || [];
        return (
          <div className="ai-panel-body">
            <p className="ai-desc">Configure your AI provider for TableForge analysis features.</p>
            <div className="ai-config-form">
              <div className="ai-result-field">
                <label>Provider:</label>
                <select value={configProvider} onChange={e => { setConfigProvider(e.target.value); setConfigModel(''); }} className="fdrop-select" style={{ width: '100%' }}>
                  <option value="">-- Select --</option>
                  <option value="openai">OpenAI (GPT-4o)</option>
                  <option value="anthropic">Anthropic (Claude)</option>
                  <option value="gemini">Google Gemini</option>
                  <option value="deepseek">DeepSeek</option>
                </select>
              </div>
              <div className="ai-result-field">
                <label>API Key:{configHasKey && !configApiKey && <span style={{ fontSize: 11, color: '#22c55e', marginLeft: 6 }}>(saved)</span>}</label>
                <input type="password" value={configApiKey} onChange={e => setConfigApiKey(e.target.value)}
                  placeholder={configHasKey ? '••••••••  (leave blank to keep current)' : 'Enter API key...'}
                  className="fdrop-input" style={{ width: '100%' }} />
                {configHasKey && configApiKey && (
                  <button style={{ fontSize: 11, color: '#f87171', background: 'none', border: 'none', cursor: 'pointer', marginTop: 4, padding: 0 }}
                    onClick={() => setConfigApiKey('')}>Clear (keep saved key)</button>
                )}
              </div>
              <div className="ai-result-field">
                <label>Model:</label>
                {providerModels.length > 0 ? (
                  <select value={configModel} onChange={e => setConfigModel(e.target.value)} className="fdrop-select" style={{ width: '100%' }}>
                    <option value="">Auto (recommended)</option>
                    {providerModels.map(m => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                ) : (
                  <input type="text" value={configModel} onChange={e => setConfigModel(e.target.value)}
                    placeholder="Select a provider first" className="fdrop-input" style={{ width: '100%' }} />
                )}
              </div>
              <button className="btn-primary" onClick={handleSaveConfig} disabled={loading} style={{ marginTop: 12 }}>
                {loading ? 'Saving...' : 'Save Configuration'}
              </button>
            </div>
            {aiResult?.status && <div className="success-msg" style={{ marginTop: 10 }}>{aiResult.status}</div>}
          </div>
        );
    }
  };

  const titles: Record<string, string> = {
    'polish': '✨ AI Polish — Title & Headers',
    'interpret': '📝 AI Interpret Table',
    'refine': '🔄 AI Refine Interpretation',
    'suggest': '💡 AI Table Suggestions',
    'smart-build': '🧠 AI Smart Build',
    'auto-generate': '🚀 AI Auto-Generate Tables',
    'report': '📄 AI Report Writer',
    'config': '⚙ AI Configuration',
  };

  const loadingMessages: Record<string, string> = {
    'polish': 'Analyzing table structure and generating polished labels…',
    'interpret': 'Reading data patterns and writing interpretation…',
    'refine': 'Refining interpretation with new focus…',
    'suggest': 'Analyzing dataset and recommending table configurations…',
    'smart-build': 'Designing optimal table from your columns…',
    'auto-generate': 'Analyzing all columns and generating comprehensive tables…',
    'report': 'Composing full analysis report…',
    'config': 'Saving configuration…',
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: mode === 'smart-build' ? 480 : mode === 'auto-generate' ? 700 : 600, maxHeight: mode === 'auto-generate' ? '85vh' : '70vh' }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{titles[mode] || 'AI-Smart'}</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body" style={{ overflow: 'auto', position: 'relative' }}>
          {error && <div className="error-msg" style={{ marginBottom: 10 }}>{error}</div>}
          {loading && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '32px 20px' }}>
              <div style={{ width: 36, height: 36, border: '3px solid rgba(59,130,246,0.15)', borderTop: '3px solid #3b82f6', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
              <span style={{ fontSize: 13, color: 'var(--text-dim, #94a3b8)', textAlign: 'center' }}>
                {loadingMessages[mode] || 'Processing…'}
              </span>
              <div style={{ width: '80%', height: 3, background: 'rgba(59,130,246,0.1)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ width: '100%', height: '100%', background: '#3b82f6', animation: 'indeterminate 1.5s ease-in-out infinite' }} />
              </div>
              <style>{`@keyframes spin{to{transform:rotate(360deg)}}@keyframes indeterminate{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}`}</style>
            </div>
          )}
          {!loading && renderContent()}
        </div>
      </div>
    </div>
  );
}
