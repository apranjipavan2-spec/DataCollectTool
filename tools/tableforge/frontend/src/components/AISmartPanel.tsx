import React, { useState, useEffect } from 'react';
import { TableConfig, DatasetMeta, TableResult } from '../types';
import { API_BASE } from '../api';

interface Props {
  mode: 'polish' | 'interpret' | 'refine' | 'suggest' | 'smart-build' | 'report' | 'config';
  table: TableConfig | null;
  dataset: DatasetMeta | null;
  result: TableResult | null;
  interpretation?: string;
  onClose: () => void;
  onApplyPolish?: (title: string, subtitle: string, renames: Record<string, string>) => void;
  onApplyInterpretation?: (text: string) => void;
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

export function AISmartPanel({ mode, table, dataset, result, interpretation, onClose, onApplyPolish, onApplyInterpretation, onApplySuggestion, onApplySmartBuild }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [aiResult, setAiResult] = useState<any>(null);

  // Interpret state
  const [focus, setFocus] = useState('');
  const [customFocus, setCustomFocus] = useState('');

  // Smart build state
  const [query, setQuery] = useState('');
  const [selectedCols, setSelectedCols] = useState<string[]>([]);

  // Report state
  const [reportStyle, setReportStyle] = useState('field_survey');
  const [customContext, setCustomContext] = useState('');

  // Config state
  const [configProvider, setConfigProvider] = useState('');
  const [configApiKey, setConfigApiKey] = useState('');
  const [configModel, setConfigModel] = useState('');

  useEffect(() => {
    if (mode === 'config') {
      fetch(`${API_BASE}/ai/config`).then(r => r.json()).then(d => {
        setConfigProvider(d.provider || '');
        setConfigModel(d.model || '');
      }).catch(() => {});
    }
  }, [mode]);

  const handlePolish = async () => {
    if (!table || !dataset || !result) return;
    setLoading(true); setError('');
    try {
      const res = await fetch(`${API_BASE}/ai/polish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dataset_id: dataset.dataset_id,
          table_title: table.title || table.name,
          rows: table.rows,
          columns: table.columns,
          values: table.values,
          headers: result.headers,
          sample_rows: result.rows.slice(0, 15),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setAiResult(data);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const handleInterpret = async (refine = false) => {
    if (!table || !dataset || !result) return;
    setLoading(true); setError('');
    const focusText = customFocus || FOCUS_TEMPLATES.find(f => f.key === focus)?.prompt || '';
    try {
      const res = await fetch(`${API_BASE}/ai/interpret`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dataset_id: dataset.dataset_id,
          table_title: table.title || table.name,
          subtitle: table.subtitle || '',
          headers: result.headers,
          rows_data: result.rows.slice(0, 80),
          row_fields: table.rows,
          column_fields: table.columns,
          value_fields: table.values,
          focus: focusText,
          previous_interpretation: refine ? (interpretation || '') : '',
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setAiResult(data);
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
            {!aiResult && <button className="btn-primary" onClick={handlePolish} disabled={loading}>{loading ? 'Generating...' : '✨ Polish Title & Headers'}</button>}
            {aiResult && (
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
            <div className="ai-focus-select">
              <label>Focus:</label>
              <select value={focus} onChange={e => setFocus(e.target.value)} className="fdrop-select">
                {FOCUS_TEMPLATES.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
            </div>
            <div className="ai-focus-custom">
              <input type="text" value={customFocus} onChange={e => setCustomFocus(e.target.value)}
                placeholder="Or type custom focus prompt..." className="fdrop-input" style={{ width: '100%' }} />
            </div>
            {!aiResult && <button className="btn-primary" onClick={() => handleInterpret(mode === 'refine')} disabled={loading}>
              {loading ? 'Generating...' : mode === 'refine' ? '🔄 Refine Interpretation' : '📝 Generate Interpretation'}
            </button>}
            {aiResult?.interpretation && (
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
              <div className="ai-col-picker" style={{ maxHeight: 150, overflow: 'auto', marginBottom: 10 }}>
                <label style={{ fontSize: 11, color: 'var(--text-dim)' }}>Select columns (optional):</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                  {dataset.columns.map(c => (
                    <button key={c.name}
                      className={`fdrop-token ${selectedCols.includes(c.name) ? 'active' : ''}`}
                      style={{ fontSize: 11, padding: '2px 6px', background: selectedCols.includes(c.name) ? 'rgba(59,130,246,0.3)' : undefined }}
                      onClick={() => setSelectedCols(prev => prev.includes(c.name) ? prev.filter(x => x !== c.name) : [...prev, c.name])}>
                      {c.name}
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
        return (
          <div className="ai-panel-body">
            <p className="ai-desc">Configure your AI provider for TableForge analysis features.</p>
            <div className="ai-config-form">
              <div className="ai-result-field">
                <label>Provider:</label>
                <select value={configProvider} onChange={e => setConfigProvider(e.target.value)} className="fdrop-select" style={{ width: '100%' }}>
                  <option value="">-- Select --</option>
                  <option value="openai">OpenAI (GPT-4o)</option>
                  <option value="anthropic">Anthropic (Claude)</option>
                  <option value="gemini">Google Gemini</option>
                  <option value="deepseek">DeepSeek</option>
                </select>
              </div>
              <div className="ai-result-field">
                <label>API Key:</label>
                <input type="password" value={configApiKey} onChange={e => setConfigApiKey(e.target.value)}
                  placeholder="Enter API key..." className="fdrop-input" style={{ width: '100%' }} />
              </div>
              <div className="ai-result-field">
                <label>Model (optional):</label>
                <input type="text" value={configModel} onChange={e => setConfigModel(e.target.value)}
                  placeholder={configProvider === 'deepseek' ? 'deepseek-v4-flash' : configProvider === 'gemini' ? 'gemini-2.0-flash' : 'auto'}
                  className="fdrop-input" style={{ width: '100%' }} />
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
    'report': '📄 AI Report Writer',
    'config': '⚙ AI Configuration',
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 600, maxHeight: '80vh' }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{titles[mode] || 'AI-Smart'}</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body" style={{ overflow: 'auto' }}>
          {error && <div className="error-msg" style={{ marginBottom: 10 }}>{error}</div>}
          {renderContent()}
        </div>
      </div>
    </div>
  );
}
