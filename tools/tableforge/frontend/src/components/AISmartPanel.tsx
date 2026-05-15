import React, { useState, useEffect } from 'react';
import { TableConfig, DatasetMeta, TableResult } from '../types';
import { API_BASE } from '../api';
import { BatchRenameModal } from './BatchRenameModal';

interface Props {
  mode: 'polish' | 'interpret' | 'refine' | 'suggest' | 'smart-build' | 'auto-generate' | 'report' | 'config';
  table: TableConfig | null;
  tables: TableConfig[];
  allResults: Map<string, TableResult>;
  dataset: DatasetMeta | null;
  result: TableResult | null;
  interpretation?: string;
  projectFilters?: Record<string, string[]>;
  onClose: () => void;
  onApplyPolish?: (title: string, subtitle: string, renames: Record<string, string>) => void;
  onApplyPolishAll?: (updates: { tableId: string; title: string; subtitle: string; renames: Record<string, string> }[]) => void;
  onApplyInterpretation?: (text: string) => void;
  onApplyInterpretationAll?: (updates: { tableId: string; text: string }[]) => void;
  onApplySuggestion?: (tables: any[]) => void;
  onApplySmartBuild?: (config: any) => void;
  columnDescriptions?: Record<string, string>;
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

export function AISmartPanel({ mode, table, tables, allResults, dataset, result, interpretation, projectFilters = {}, onClose, onApplyPolish, onApplyPolishAll, onApplyInterpretation, onApplyInterpretationAll, onApplySuggestion, onApplySmartBuild, columnDescriptions = {} }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [aiResult, setAiResult] = useState<any>(null);
  const [showBatchRename, setShowBatchRename] = useState(false);

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
  const [objectives, setObjectives] = useState('');
  const [maxTables, setMaxTables] = useState(20);
  const [selectedAutoTables, setSelectedAutoTables] = useState<Set<number>>(new Set());
  const [phaseProgress, setPhaseProgress] = useState<{ phase: number; total: number; message: string } | null>(null);
  const [studyPlan, setStudyPlan] = useState<any>(null);
  const [selectedPhases, setSelectedPhases] = useState<Set<number>>(new Set());
  const [planLoading, setPlanLoading] = useState(false);

  // Unified build sub-mode
  const [buildSubMode, setBuildSubMode] = useState<'ask' | 'generate' | 'suggest'>('ask');

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
    if (!dataset || !table) return;
    setLoading(true); setError('');
    try {
      const r = allResults.get(table.id);
      if (!r) throw new Error('Table result not found');
      const res = await fetch(`${API_BASE}/ai/polish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dataset_id: dataset.dataset_id,
          table_title: table.title || table.name,
          rows: table.rows,
          columns: table.columns,
          values: table.values,
          headers: r.headers,
          sample_rows: r.rows.slice(0, 15),
          table_filters: table.filters || {},
          project_filters: projectFilters,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setAiResult(await res.json());
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

  const handleCreatePlan = async () => {
    if (!dataset) return;
    setPlanLoading(true); setError(''); setStudyPlan(null);
    try {
      const res = await fetch(`${API_BASE}/ai/auto-generate/plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dataset_id: dataset.dataset_id,
          objectives,
          table_descriptions: tableDescriptions,
          max_tables: maxTables,
          column_descriptions: columnDescriptions,
          selected_columns: selectedCols.length > 0 ? selectedCols : undefined,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const plan = await res.json();
      setStudyPlan(plan);
      setSelectedPhases(new Set((plan.phases || []).map((_: any, i: number) => i)));
    } catch (e: any) { setError(e.message); }
    finally { setPlanLoading(false); }
  };

  const handleExecutePlan = async () => {
    if (!dataset || !studyPlan) return;
    setLoading(true); setError(''); setPhaseProgress(null);
    const accumulated: any[] = [];
    try {
      const res = await fetch(`${API_BASE}/ai/auto-generate/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dataset_id: dataset.dataset_id,
          plan: studyPlan,
          selected_phases: Array.from(selectedPhases).sort((a, b) => a - b),
          objectives,
          table_descriptions: tableDescriptions,
          column_descriptions: columnDescriptions,
        }),
      });
      if (!res.ok) throw new Error(await res.text());

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response stream');
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const ev = JSON.parse(line.slice(6));
            if (ev.step === 'start') {
              setPhaseProgress({ phase: 0, total: ev.phases || 1, message: ev.message });
            } else if (ev.step === 'phase') {
              setPhaseProgress(prev => ({ phase: ev.phase, total: prev?.total || 1, message: ev.message }));
            } else if (ev.step === 'phase_done') {
              accumulated.push(...(ev.tables || []));
              setAiResult({ tables: [...accumulated] });
              setSelectedAutoTables(new Set(accumulated.map((_: any, i: number) => i)));
              setPhaseProgress(prev => ({ phase: ev.phase, total: prev?.total || 1, message: ev.message }));
            } else if (ev.step === 'phase_error') {
              setPhaseProgress(prev => ({ phase: ev.phase, total: prev?.total || 1, message: ev.message }));
            } else if (ev.step === 'done') {
              if (ev.tables?.length && ev.tables.length > accumulated.length) {
                accumulated.length = 0;
                accumulated.push(...ev.tables);
              }
              setAiResult({ tables: [...accumulated] });
              setSelectedAutoTables(new Set(accumulated.map((_: any, i: number) => i)));
            }
          } catch {}
        }
      }
      if (!accumulated.length) throw new Error('No tables generated');
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); setPhaseProgress(null); }
  };

  const handleAutoGenerate = handleCreatePlan;

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
            {!showBatchRename ? (
              <>
                <p className="ai-desc">AI will analyze your table and suggest a clean title, subtitle, and column labels.</p>
                {tables.length > 1 && !aiResult && (
                  <button className="btn-primary" onClick={() => setShowBatchRename(true)} style={{ marginBottom: 12, width: '100%' }}>
                    ✨ Batch Rename All {tables.length} Tables
                  </button>
                )}
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
              </>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>✨ Batch AI Rename</div>
                  <button onClick={() => setShowBatchRename(false)} style={{
                    background: 'none',
                    border: 'none',
                    fontSize: 18,
                    cursor: 'pointer',
                    color: 'var(--text-dim)',
                  }}>✕</button>
                </div>
                <BatchRenameModal
                  tables={tables}
                  allResults={allResults}
                  dataset={dataset}
                  projectFilters={projectFilters}
                  onClose={() => setShowBatchRename(false)}
                  onApplyAll={(updates) => {
                    onApplyPolishAll?.(updates);
                    setShowBatchRename(false);
                  }}
                  onRollback={() => setShowBatchRename(false)}
                />
              </>
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
      case 'smart-build':
      case 'auto-generate': {
        const effectiveSubMode = mode === 'auto-generate' ? 'generate' : mode === 'suggest' ? 'suggest' : buildSubMode;
        const colSidebarContent = dataset && (
          <div style={{ width: 320, minWidth: 280, borderRight: '1px solid rgba(255,255,255,0.08)', paddingRight: 10, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', marginBottom: 6 }}>
              Columns ({dataset.columns.length})
              {selectedCols.length > 0 && <span style={{ color: '#60a5fa' }}> — {selectedCols.length} selected</span>}
            </div>
            <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
              <button onClick={() => setSelectedCols(dataset.columns.map(c => c.name))}
                style={{ fontSize: 9, padding: '2px 6px', background: 'rgba(59,130,246,0.15)', border: 'none', borderRadius: 3, color: '#93c5fd', cursor: 'pointer' }}>All</button>
              <button onClick={() => setSelectedCols([])}
                style={{ fontSize: 9, padding: '2px 6px', background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: 3, color: 'var(--text-dim)', cursor: 'pointer' }}>None</button>
            </div>
            <div style={{ flex: 1, overflow: 'auto' }}>
              {dataset.columns.map((c, idx) => {
                const isSelected = selectedCols.includes(c.name);
                const tColor = c.type === 'numeric' ? '#3b82f6' : c.type === 'text' ? '#22c55e' : c.type === 'date' ? '#f59e0b' : c.type === 'boolean' ? '#a855f7' : '#ec4899';
                return (
                  <button key={c.name}
                    onClick={() => setSelectedCols(prev => prev.includes(c.name) ? prev.filter(x => x !== c.name) : [...prev, c.name])}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 4, width: '100%',
                      fontSize: 11, padding: '4px 6px', textAlign: 'left', cursor: 'pointer',
                      background: isSelected ? 'rgba(59,130,246,0.2)' : 'transparent',
                      border: isSelected ? '1px solid rgba(59,130,246,0.4)' : '1px solid transparent',
                      borderRadius: 4, marginBottom: 1, color: 'inherit',
                    }}>
                    <span style={{ color: 'var(--text-dim)', fontSize: 10, minWidth: 20 }}>{idx + 1}.</span>
                    <span style={{ fontSize: 8, fontWeight: 700, color: tColor, background: `${tColor}22`, padding: '1px 3px', borderRadius: 2, minWidth: 20, textAlign: 'center' }}>
                      {c.type === 'numeric' ? '123' : c.type === 'text' ? 'Aa' : c.type === 'date' ? 'D' : c.type === 'boolean' ? '01' : 'M'}
                    </span>
                    <span style={{ flex: 1, wordBreak: 'break-word', lineHeight: 1.3 }}>{c.name}</span>
                    {isSelected && <span style={{ color: '#60a5fa', fontSize: 10 }}>✓</span>}
                  </button>
                );
              })}
            </div>
          </div>
        );

        return (
          <div style={{ display: 'flex', gap: 14, height: '100%', overflow: 'hidden' }}>
            {colSidebarContent}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {/* Sub-mode tabs — only when opened from smart-build */}
              {mode === 'smart-build' && !aiResult && (
                <div style={{ display: 'flex', gap: 0, marginBottom: 12, borderBottom: '2px solid rgba(255,255,255,0.08)' }}>
                  {([
                    { key: 'ask' as const, label: 'Ask a Question', desc: 'Create one table' },
                    { key: 'generate' as const, label: 'Auto-Generate', desc: 'Create many tables' },
                    { key: 'suggest' as const, label: 'Get Suggestions', desc: 'AI recommends' },
                  ]).map(t => (
                    <button key={t.key} onClick={() => { setBuildSubMode(t.key); setAiResult(null); setError(''); }}
                      style={{
                        padding: '8px 16px', fontSize: 12, fontWeight: buildSubMode === t.key ? 700 : 400,
                        border: 'none', cursor: 'pointer',
                        background: buildSubMode === t.key ? 'rgba(59,130,246,0.15)' : 'transparent',
                        color: buildSubMode === t.key ? '#60a5fa' : 'var(--text-dim)',
                        borderBottom: buildSubMode === t.key ? '3px solid #3b82f6' : '3px solid transparent',
                        marginBottom: -2,
                      }}>
                      {t.label}
                    </button>
                  ))}
                </div>
              )}

              <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {/* ASK mode — single table */}
                {effectiveSubMode === 'ask' && (
                  <>
                    <p className="ai-desc" style={{ margin: 0 }}>Describe the table you want. AI will design the optimal configuration.</p>
                    <input type="text" value={query} onChange={e => setQuery(e.target.value)}
                      placeholder="e.g., Show average income by district and gender..."
                      className="fdrop-input" style={{ width: '100%', padding: '8px 12px', fontSize: 13 }} />
                    {!aiResult && (
                      <button className="btn-primary" onClick={handleSmartBuild} disabled={loading}
                        style={{ alignSelf: 'flex-start', padding: '8px 20px' }}>
                        {loading ? 'Building...' : 'Build Table'}
                      </button>
                    )}
                    {aiResult?.groupby_field && (
                      <div className="ai-result">
                        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>{aiResult.title}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 12 }}>{aiResult.description}</div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px', fontSize: 12, padding: '10px 12px', background: 'rgba(0,0,0,0.15)', borderRadius: 6 }}>
                          <div><span style={{ color: 'var(--text-dim)' }}>Row grouping:</span> <strong>{aiResult.groupby_field}</strong></div>
                          <div><span style={{ color: 'var(--text-dim)' }}>Value field:</span> <strong>{aiResult.value_field}</strong></div>
                          <div><span style={{ color: 'var(--text-dim)' }}>Aggregation:</span> <strong>{aiResult.aggregation}</strong></div>
                          {aiResult.secondary_groupby && (
                            <div><span style={{ color: 'var(--text-dim)' }}>Column grouping:</span> <strong>{aiResult.secondary_groupby}</strong></div>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                          <button className="btn-primary" style={{ padding: '8px 20px' }} onClick={() => {
                            onApplySmartBuild?.(aiResult);
                            onClose();
                          }}>Create This Table</button>
                          <button className="fdrop-btn-action" onClick={() => setAiResult(null)}>Try Again</button>
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* GENERATE mode — 3-stage: plan → review → execute */}
                {effectiveSubMode === 'generate' && (
                  <>
                    {/* Stage 1: Input — objectives, descriptions, max tables */}
                    {!studyPlan && !aiResult && (
                      <>
                        <p className="ai-desc" style={{ margin: 0 }}>
                          AI analyses all columns, creates a study plan, then generates tables in phases.
                          {selectedCols.length > 0 && <span style={{ color: '#60a5fa' }}> Using {selectedCols.length} selected columns.</span>}
                          {selectedCols.length === 0 && ' Select columns on the left or leave empty to use all.'}
                        </p>
                        <textarea value={objectives} onChange={e => setObjectives(e.target.value)}
                          placeholder={"Research objectives or questions (optional):\n\u2022 What is the demographic profile of beneficiaries?\n\u2022 How does income vary across districts?\n\u2022 What are the key indicators of program performance?\n\u2022 Compare male vs female participation rates"}
                          className="fdrop-input" style={{ width: '100%', minHeight: 60, resize: 'vertical', fontSize: 12 }} />
                        <textarea value={tableDescriptions} onChange={e => setTableDescriptions(e.target.value)}
                          placeholder={"Specific tables to create (optional):\n- Demographics by district\n- Income source by beneficiary type\n- Average landholding by region"}
                          className="fdrop-input" style={{ width: '100%', minHeight: 50, resize: 'vertical', fontSize: 12 }} />
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <label style={{ fontSize: 11, color: 'var(--text-dim)' }}>Max tables:</label>
                          <input type="range" min={5} max={100} value={maxTables} onChange={e => setMaxTables(Number(e.target.value))} style={{ flex: 1 }} />
                          <span style={{ fontSize: 12, minWidth: 28 }}>{maxTables}</span>
                        </div>
                        <button className="btn-primary" onClick={handleCreatePlan} disabled={planLoading}
                          style={{ padding: '8px 20px', alignSelf: 'flex-start' }}>
                          {planLoading ? 'Analyzing columns...' : 'Create Study Plan'}
                        </button>
                      </>
                    )}

                    {/* Stage 2: Plan review — show phases with toggles */}
                    {studyPlan && !aiResult && (
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                          <div>
                            <div style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0' }}>Study Plan</div>
                            <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                              {studyPlan.summary?.total_phases || studyPlan.phases?.length || 0} phases, {studyPlan.summary?.total_tables || '?'} tables planned
                            </div>
                          </div>
                          <button className="fdrop-btn-action" style={{ fontSize: 11 }}
                            onClick={() => { setStudyPlan(null); setSelectedPhases(new Set()); }}>
                            Redo Plan
                          </button>
                        </div>

                        {/* Shared demographics */}
                        {studyPlan.shared_demographics?.length > 0 && (
                          <div style={{ padding: '8px 12px', background: 'rgba(34,197,94,0.08)', borderRadius: 6, marginBottom: 10, border: '1px solid rgba(34,197,94,0.2)' }}>
                            <div style={{ fontSize: 11, fontWeight: 600, color: '#4ade80', marginBottom: 4 }}>
                              Shared Demographics (used across all phases)
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text-dim)', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                              {studyPlan.shared_demographics.map((c: string) => (
                                <span key={c} style={{ padding: '2px 8px', background: 'rgba(34,197,94,0.15)', borderRadius: 3, fontSize: 10 }}>{c}</span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Phase list */}
                        <div style={{ maxHeight: 400, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {(studyPlan.phases || []).map((phase: any, idx: number) => {
                            const isSelected = selectedPhases.has(idx);
                            const tableCount = phase.tables?.length || 0;
                            return (
                              <div key={idx} style={{
                                padding: '10px 14px', borderRadius: 8,
                                background: isSelected ? 'rgba(59,130,246,0.08)' : 'rgba(255,255,255,0.03)',
                                border: `1px solid ${isSelected ? 'rgba(59,130,246,0.3)' : 'rgba(255,255,255,0.06)'}`,
                              }}>
                                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}>
                                  <input type="checkbox" checked={isSelected}
                                    onChange={() => setSelectedPhases(prev => {
                                      const next = new Set(prev);
                                      next.has(idx) ? next.delete(idx) : next.add(idx);
                                      return next;
                                    })} style={{ marginTop: 3 }} />
                                  <div style={{ flex: 1 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                      <span style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>
                                        Phase {idx + 1}: {phase.theme}
                                      </span>
                                      <span style={{ fontSize: 10, color: '#93c5fd', padding: '2px 8px', background: 'rgba(59,130,246,0.15)', borderRadius: 10 }}>
                                        {tableCount} tables
                                      </span>
                                    </div>
                                    {phase.description && (
                                      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>{phase.description}</div>
                                    )}
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 6 }}>
                                      {(phase.columns || []).slice(0, 8).map((c: string) => (
                                        <span key={c} style={{ fontSize: 9, padding: '1px 6px', background: 'rgba(255,255,255,0.06)', borderRadius: 3, color: 'var(--text-dim)' }}>{c}</span>
                                      ))}
                                      {(phase.columns || []).length > 8 && (
                                        <span style={{ fontSize: 9, color: 'var(--text-dim)' }}>+{phase.columns.length - 8} more</span>
                                      )}
                                    </div>
                                    {/* Show planned tables */}
                                    {phase.tables?.length > 0 && (
                                      <div style={{ marginTop: 6, borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 6 }}>
                                        {phase.tables.map((t: any, ti: number) => (
                                          <div key={ti} style={{ fontSize: 10, color: 'var(--text-dim)', padding: '2px 0', display: 'flex', gap: 4 }}>
                                            <span style={{ color: '#475569' }}>{ti + 1}.</span>
                                            <span>{t.title}</span>
                                            {t.template && <span style={{ color: '#60a5fa', fontSize: 9 }}>({t.template})</span>}
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </label>
                              </div>
                            );
                          })}
                        </div>

                        {/* Execute button */}
                        <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center' }}>
                          <button className="btn-primary" onClick={handleExecutePlan}
                            disabled={loading || selectedPhases.size === 0}
                            style={{ padding: '10px 24px' }}>
                            {loading ? 'Generating...' : `Generate ${selectedPhases.size} Phase${selectedPhases.size !== 1 ? 's' : ''}`}
                          </button>
                          <button className="fdrop-btn-action" style={{ fontSize: 11 }} onClick={() => {
                            selectedPhases.size === (studyPlan.phases || []).length
                              ? setSelectedPhases(new Set())
                              : setSelectedPhases(new Set((studyPlan.phases || []).map((_: any, i: number) => i)));
                          }}>{selectedPhases.size === (studyPlan.phases || []).length ? 'Deselect All' : 'Select All'}</button>
                        </div>

                        {/* Phase execution progress */}
                        {loading && phaseProgress && (
                          <div style={{ marginTop: 10, padding: '10px 14px', background: 'rgba(59,130,246,0.08)', borderRadius: 8, fontSize: 12 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                              <span style={{ color: '#93c5fd' }}>{phaseProgress.message}</span>
                              <span style={{ color: 'var(--text-dim)' }}>Phase {phaseProgress.phase}/{phaseProgress.total}</span>
                            </div>
                            <div style={{ width: '100%', height: 4, background: 'rgba(59,130,246,0.15)', borderRadius: 3, overflow: 'hidden' }}>
                              <div style={{ width: `${Math.max(5, (phaseProgress.phase / phaseProgress.total) * 100)}%`, height: '100%', background: '#3b82f6', borderRadius: 3, transition: 'width 0.5s ease' }} />
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Stage 3 result: Generated tables — select which to create */}
                    {aiResult?.tables && (
                      <div className="ai-result">
                        <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>{aiResult.tables.length} tables generated — select which to create:</div>
                        <div style={{ maxHeight: 350, overflow: 'auto' }}>
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
                                  {t.template && <span style={{ marginLeft: 6, padding: '1px 5px', background: 'rgba(59,130,246,0.2)', borderRadius: 3, color: '#93c5fd' }}>{t.template}</span>}
                                  {t.phase && <span style={{ marginLeft: 6, padding: '1px 5px', background: 'rgba(34,197,94,0.15)', borderRadius: 3, color: '#4ade80', fontSize: 9 }}>{t.phase}</span>}
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
                          <button className="fdrop-btn-action" style={{ fontSize: 11 }} onClick={() => {
                            setAiResult(null); setStudyPlan(null); setSelectedPhases(new Set());
                          }}>Start Over</button>
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* SUGGEST mode — AI recommendations */}
                {effectiveSubMode === 'suggest' && (
                  <>
                    <p className="ai-desc" style={{ margin: 0 }}>AI will analyze your dataset and suggest optimal table configurations.</p>
                    <input type="text" value={query} onChange={e => setQuery(e.target.value)}
                      placeholder="Optional: describe what you want to analyze..."
                      className="fdrop-input" style={{ width: '100%', padding: '8px 12px', fontSize: 13 }} />
                    {!aiResult && (
                      <button className="btn-primary" onClick={handleSuggest} disabled={loading}
                        style={{ alignSelf: 'flex-start', padding: '8px 20px' }}>
                        {loading ? 'Thinking...' : 'Get Suggestions'}
                      </button>
                    )}
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
                  </>
                )}
              </div>
            </div>
          </div>
        );
      }

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
    'suggest': '🧠 AI Table Builder',
    'smart-build': '🧠 AI Table Builder',
    'auto-generate': '🧠 AI Table Builder',
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
      <div className="modal" style={{ maxWidth: (mode === 'smart-build' || mode === 'auto-generate' || mode === 'suggest') ? '95vw' : 600, width: (mode === 'smart-build' || mode === 'auto-generate' || mode === 'suggest') ? '95vw' : undefined, maxHeight: (mode === 'smart-build' || mode === 'auto-generate' || mode === 'suggest') ? '90vh' : '70vh' }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{titles[mode] || 'AI-Smart'}</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body" style={{ overflow: 'auto', position: 'relative' }}>
          {error && <div className="error-msg" style={{ marginBottom: 10 }}>{error}</div>}
          {loading && !phaseProgress && (
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
          {(!loading || mode === 'auto-generate' || (mode === 'smart-build' && buildSubMode === 'generate')) && renderContent()}
        </div>
      </div>
    </div>
  );
}
