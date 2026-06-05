import React, { useState, useEffect } from 'react';
import { ColumnInfo } from '../types';
import { API_BASE, createMetric, createBin } from '../api';
import { MetricBuilder } from './MetricBuilder';
import { BinCreator } from './BinCreator';

interface Props {
  datasetId: string;
  columns: ColumnInfo[];
  onCreated: (name: string) => void;
  onClose: () => void;
  onOpenLibrary?: () => void;
  columnDescriptions?: Record<string, string>;
}

interface ExistingColumn {
  name: string;
  type: 'metric' | 'bin';
}

const typeColors: Record<string, string> = {
  numeric: '#3b82f6',
  text: '#22c55e',
  date: '#f59e0b',
  boolean: '#a855f7',
  multi_choice: '#ec4899',
};

const typeIcons: Record<string, string> = {
  numeric: '123',
  text: 'Aa',
  date: 'D',
  boolean: '01',
  multi_choice: 'M',
};

export function ColumnCreator({ datasetId, columns, onCreated, onClose, onOpenLibrary, columnDescriptions = {} }: Props) {
  const [tab, setTab] = useState<'ai' | 'metric' | 'bin'>('ai');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [aiResult, setAiResult] = useState<any>(null);
  const [applying, setApplying] = useState(false);
  const [existingCols, setExistingCols] = useState<ExistingColumn[]>([]);
  const [colSearch, setColSearch] = useState('');
  const [selectedRefCol, setSelectedRefCol] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<any[] | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [selectedAICols, setSelectedAICols] = useState<Set<string>>(new Set());

  const refreshExistingCols = () => {
    Promise.all([
      fetch(`${API_BASE}/metrics/${datasetId}`).then(r => r.json()).catch(() => ({ metrics: [] })),
      fetch(`${API_BASE}/bins/${datasetId}`).then(r => r.json()).catch(() => ({ bins: [] })),
    ]).then(([metricsRes, binsRes]) => {
      const metricList: any[] = metricsRes.metrics || [];
      const binList: any[] = binsRes.bins || [];
      const cols: ExistingColumn[] = [
        ...metricList.map((m: any) => ({ name: m.name || m, type: 'metric' as const })),
        ...binList.map((b: any) => ({ name: b.name || b, type: 'bin' as const })),
      ];
      setExistingCols(cols);
    });
  };

  useEffect(() => { refreshExistingCols(); }, [datasetId]);

  const handleAIGenerate = async () => {
    if (!description.trim()) return;
    setLoading(true); setError(''); setAiResult(null);
    try {
      const res = await fetch(`${API_BASE}/ai/create-column`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dataset_id: datasetId, description,
          column_descriptions: columnDescriptions,
          selected_columns: selectedAICols.size > 0 ? Array.from(selectedAICols) : [],
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setAiResult(await res.json());
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const handlePreviewAI = async () => {
    if (!aiResult?.definition) return;
    setPreviewing(true); setPreviewData(null);
    try {
      const def = aiResult.definition;
      if (aiResult.type === 'metric') {
        const res = await fetch(`${API_BASE}/metrics/preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...def, dataset_id: datasetId }),
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        setPreviewData(data.preview || []);
      }
    } catch (e: any) { setError(`Preview failed: ${e.message}`); }
    finally { setPreviewing(false); }
  };

  const handleApplyAI = async () => {
    if (!aiResult?.definition) return;
    setApplying(true); setError('');
    try {
      const def = aiResult.definition;
      if (aiResult.type === 'metric') {
        await createMetric(datasetId, { ...def, dataset_id: datasetId });
      } else if (aiResult.type === 'bin') {
        await createBin(datasetId, { ...def, dataset_id: datasetId });
      }
      onCreated(def.name);
      refreshExistingCols();
    } catch (e: any) { setError(e.message); }
    finally { setApplying(false); }
  };

  const handleDeleteColumn = async (name: string, type: 'metric' | 'bin') => {
    try {
      const endpoint = type === 'metric' ? 'metrics' : 'bins';
      await fetch(`${API_BASE}/${endpoint}/${datasetId}/${encodeURIComponent(name)}`, { method: 'DELETE' });
      setExistingCols(prev => prev.filter(c => !(c.name === name && c.type === type)));
      onCreated(name);
    } catch (e: any) { setError(e.message); }
  };

  const insertColumnRef = (colName: string) => {
    setDescription(prev => prev + (prev && !prev.endsWith(' ') ? ' ' : '') + colName);
  };

  const filteredCols = columns.filter(c =>
    c.name.toLowerCase().includes(colSearch.toLowerCase())
  );

  const renderColumnsPanel = () => (
    <div style={{
      width: 220, minWidth: 220, borderRight: '1px solid rgba(255,255,255,0.08)',
      paddingRight: 10, display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', marginBottom: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>Columns ({selectedAICols.size > 0 ? `${selectedAICols.size}/` : ''}{columns.length})</span>
        <span style={{ display: 'flex', gap: 4 }}>
          <button onClick={() => setSelectedAICols(new Set(columns.map(c => c.name)))}
            style={{ fontSize: 9, background: 'none', border: 'none', color: '#60a5fa', cursor: 'pointer', padding: 0 }}>All</button>
          <button onClick={() => setSelectedAICols(new Set())}
            style={{ fontSize: 9, background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', padding: 0 }}>None</button>
        </span>
      </div>
      <input
        value={colSearch} onChange={e => setColSearch(e.target.value)}
        placeholder="Search columns..."
        style={{
          width: '100%', padding: '4px 8px', fontSize: 11, marginBottom: 6,
          background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 4, color: 'inherit',
        }}
      />
      <div style={{ flex: 1, overflow: 'auto' }}>
        {filteredCols.map(col => (
          <div
            key={col.name}
            onClick={() => setSelectedRefCol(selectedRefCol === col.name ? null : col.name)}
            style={{
              padding: '4px 6px', fontSize: 11, cursor: 'pointer',
              borderBottom: '1px solid rgba(255,255,255,0.04)',
              background: selectedRefCol === col.name ? 'rgba(59,130,246,0.15)' : selectedAICols.has(col.name) ? 'rgba(34,197,94,0.08)' : 'transparent',
              borderRadius: 3,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input type="checkbox" checked={selectedAICols.has(col.name)}
                onChange={e => {
                  e.stopPropagation();
                  setSelectedAICols(prev => {
                    const next = new Set(prev);
                    if (next.has(col.name)) next.delete(col.name); else next.add(col.name);
                    return next;
                  });
                }}
                style={{ width: 12, height: 12, margin: 0, cursor: 'pointer', accentColor: '#22c55e' }}
              />
              <span style={{
                fontSize: 9, fontWeight: 700, color: typeColors[col.type] || '#888',
                background: `${typeColors[col.type] || '#888'}22`,
                padding: '1px 4px', borderRadius: 3, minWidth: 22, textAlign: 'center',
              }}>
                {typeIcons[col.type] || '?'}
              </span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {col.name}
              </span>
              <button
                onClick={e => { e.stopPropagation(); insertColumnRef(col.name); }}
                title="Insert into description"
                style={{
                  fontSize: 9, padding: '1px 4px', background: 'rgba(59,130,246,0.2)',
                  border: 'none', borderRadius: 3, color: '#93c5fd', cursor: 'pointer',
                  opacity: 0.7,
                }}
              >+</button>
            </div>
            {selectedRefCol === col.name && (
              <div style={{ marginTop: 4, padding: '4px 6px', background: 'rgba(0,0,0,0.2)', borderRadius: 4, fontSize: 10 }}>
                <div style={{ color: 'var(--text-dim)' }}>
                  Type: <strong style={{ color: typeColors[col.type] }}>{col.type}</strong>
                  {' | '}{col.stats.unique} unique | {col.stats.nulls} nulls
                </div>
                {col.stats.min != null && (
                  <div style={{ color: 'var(--text-dim)' }}>Range: {col.stats.min} – {col.stats.max}</div>
                )}
                {col.stats.mean != null && (
                  <div style={{ color: 'var(--text-dim)' }}>Mean: {typeof col.stats.mean === 'number' ? col.stats.mean.toFixed(2) : col.stats.mean}</div>
                )}
                <div style={{ color: '#93c5fd', marginTop: 2, wordBreak: 'break-all' }}>
                  {col.sample_values.slice(0, 5).join(', ')}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      <div style={{ marginTop: 6, padding: '4px 0', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ fontSize: 9, color: 'var(--text-dim)', lineHeight: 1.3 }}>
          Check columns to limit AI scope. Click [+] to insert name. Click row for details.
        </div>
      </div>
    </div>
  );

  const renderAITab = () => (
    <div style={{ flex: 1, display: 'flex', gap: 12, overflow: 'hidden' }}>
      {renderColumnsPanel()}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10, overflow: 'auto' }}>
        <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: 0 }}>
          Describe the column you want to create. You can use Excel-like formulas, conditional logic (IF/THEN/ELSE), or plain English.
        </p>
        <textarea value={description} onChange={e => setDescription(e.target.value)}
          placeholder={"Examples:\n• Calculate BMI from height_cm and weight_kg\n• IF gender = 'Female' AND age > 18 THEN 'Eligible' ELSE 'Not Eligible'\n• income / household_size (per capita income)\n• Categorize age into Young (<30), Middle (30-50), Senior (>50)\n• Rank districts by total_population descending\n• IF income > 50000 THEN 'High' ELSE IF income > 25000 THEN 'Medium' ELSE 'Low'\n• weight_kg / (height_cm/100)^2\n• Create percentage: female_count / total_count * 100"}
          style={{
            width: '100%', minHeight: 120, resize: 'vertical', padding: 10, fontSize: 12,
            background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: 6, color: 'inherit', lineHeight: 1.5,
          }}
        />
        {!aiResult && (
          <button className="btn-primary" onClick={handleAIGenerate}
            disabled={loading || !description.trim()}
            style={{ alignSelf: 'flex-start', padding: '8px 20px' }}>
            {loading ? 'Analyzing...' : 'Generate Column'}
          </button>
        )}
        {aiResult && (
          <div style={{
            padding: 14, background: 'rgba(59,130,246,0.08)',
            border: '1px solid rgba(59,130,246,0.25)', borderRadius: 8,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{
                fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
                background: aiResult.type === 'metric' ? 'rgba(59,130,246,0.2)' : 'rgba(34,197,94,0.2)',
                color: aiResult.type === 'metric' ? '#93c5fd' : '#86efac',
              }}>
                {aiResult.type === 'metric' ? 'CALCULATED COLUMN' : 'CATEGORIZATION (BIN)'}
              </span>
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              {aiResult.definition?.name}
            </div>
            {aiResult.type === 'metric' && (
              <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.6 }}>
                <div>Method: <strong>{aiResult.definition?.metric_type}</strong></div>
                {aiResult.definition?.column_a && <div>Column A: {aiResult.definition.column_a}</div>}
                {aiResult.definition?.column_b && <div>Column B: {aiResult.definition.column_b}</div>}
                {aiResult.definition?.operator && <div>Operator: {aiResult.definition.operator}</div>}
                {aiResult.definition?.numerator && <div>Numerator: {aiResult.definition.numerator}</div>}
                {aiResult.definition?.denominator && <div>Denominator: {aiResult.definition.denominator}</div>}
                {aiResult.definition?.cond_column && (
                  <div style={{ marginTop: 4, padding: '4px 8px', background: 'rgba(0,0,0,0.2)', borderRadius: 4 }}>
                    IF {aiResult.definition.cond_column} {aiResult.definition.cond_operator} {aiResult.definition.cond_value}
                    {' '} THEN {aiResult.definition.cond_then_type === 'column' ? aiResult.definition.cond_then_col : `"${aiResult.definition.cond_then_val}"`}
                    {' '} ELSE {aiResult.definition.cond_else_type === 'column' ? aiResult.definition.cond_else_col : `"${aiResult.definition.cond_else_val}"`}
                  </div>
                )}
              </div>
            )}
            {aiResult.type === 'bin' && (
              <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.6 }}>
                <div>Source: <strong>{aiResult.definition?.source_column}</strong> | Type: {aiResult.definition?.bin_type}</div>
                {aiResult.definition?.ranges && (
                  <div style={{ marginTop: 4 }}>
                    {aiResult.definition.ranges.map((r: any, i: number) => (
                      <div key={i} style={{ padding: '2px 8px', background: 'rgba(0,0,0,0.15)', borderRadius: 3, marginBottom: 2 }}>
                        {r.label}: {r.lower} – {r.upper}
                      </div>
                    ))}
                  </div>
                )}
                {aiResult.definition?.mapping && (
                  <div style={{ marginTop: 4 }}>
                    {Object.entries(aiResult.definition.mapping).map(([k, v]) => (
                      <div key={k} style={{ padding: '2px 8px', background: 'rgba(0,0,0,0.15)', borderRadius: 3, marginBottom: 2 }}>
                        "{k}" → "{v as string}"
                      </div>
                    ))}
                  </div>
                )}
                {aiResult.definition?.custom_labels && (
                  <div>Labels: {aiResult.definition.custom_labels.join(', ')}</div>
                )}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              {aiResult.type === 'metric' && (
                <button className="fdrop-btn-action" onClick={handlePreviewAI} disabled={previewing}
                  style={{ padding: '7px 14px' }}>
                  {previewing ? 'Loading...' : 'Preview Values'}
                </button>
              )}
              <button className="btn-primary" onClick={handleApplyAI} disabled={applying}
                style={{ padding: '7px 18px' }}>
                {applying ? 'Creating...' : 'Create Column'}
              </button>
              <button className="fdrop-btn-action" onClick={() => { setAiResult(null); setPreviewData(null); }}
                style={{ padding: '7px 14px' }}>
                Try Again
              </button>
            </div>
            {previewData && previewData.length > 0 && (
              <div style={{ marginTop: 8, padding: '8px 10px', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 6 }}>
                <div style={{ fontSize: 10, color: '#86efac', marginBottom: 4 }}>Preview (first {previewData.length} values):</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {previewData.map((v: any, i: number) => (
                    <span key={i} style={{ padding: '2px 8px', background: 'rgba(0,0,0,0.2)', borderRadius: 3, fontSize: 12, fontFamily: 'monospace' }}>
                      {typeof v === 'number' ? v.toFixed(2) : String(v)}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  const tabs = [
    { key: 'ai' as const, label: 'AI Create', icon: '✦' },
    { key: 'metric' as const, label: 'Manual Metric / Formula', icon: 'f(x)' },
    { key: 'bin' as const, label: 'Manual Bin / Categorize', icon: '⊞' },
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: '95vw', width: 1000, maxHeight: '90vh' }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Create Column</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body" style={{ display: 'flex', gap: 16, overflow: 'hidden', height: 'calc(90vh - 80px)' }}>
          {/* Left sidebar: existing custom columns */}
          <div style={{ width: 180, minWidth: 180, borderRight: '1px solid rgba(255,255,255,0.08)', paddingRight: 10, overflow: 'auto' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', marginBottom: 8 }}>Custom Columns ({existingCols.length})</div>
            {existingCols.length === 0 && <div style={{ fontSize: 11, color: 'var(--text-dim)', opacity: 0.5 }}>No custom columns yet</div>}
            {existingCols.map(c => (
              <div key={`${c.type}-${c.name}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <div style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                  <span style={{ color: c.type === 'metric' ? '#3b82f6' : '#22c55e', marginRight: 4, fontSize: 10, fontWeight: 700 }}>
                    {c.type === 'metric' ? 'f(x)' : 'BIN'}
                  </span>
                  {c.name}
                </div>
                <button onClick={() => handleDeleteColumn(c.name, c.type)}
                  style={{ fontSize: 10, color: '#f87171', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px' }}>
                  x
                </button>
              </div>
            ))}
          </div>

          {/* Main content area */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Tab bar */}
            <div style={{ display: 'flex', gap: 0, marginBottom: 12, borderBottom: '2px solid rgba(255,255,255,0.08)' }}>
              {tabs.map(t => (
                <button key={t.key} onClick={() => setTab(t.key)}
                  style={{
                    padding: '10px 20px', fontSize: 12, fontWeight: tab === t.key ? 700 : 400,
                    border: 'none', cursor: 'pointer',
                    background: tab === t.key ? 'rgba(59,130,246,0.15)' : 'transparent',
                    color: tab === t.key ? '#60a5fa' : 'var(--text-dim)',
                    borderBottom: tab === t.key ? '3px solid #3b82f6' : '3px solid transparent',
                    marginBottom: -2,
                    transition: 'all 0.15s ease',
                  }}>
                  <span style={{ marginRight: 6, fontSize: tab === t.key ? 13 : 12 }}>{t.icon}</span>
                  {t.label}
                </button>
              ))}
            </div>

            {error && <div className="error-msg" style={{ marginBottom: 10 }}>{error}</div>}

            <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
              {tab === 'ai' && renderAITab()}
              {tab === 'metric' && (
                <MetricBuilder datasetId={datasetId} columns={columns} embedded
                  onCreated={(name) => { onCreated(name); refreshExistingCols(); }}
                  onClose={onClose} onOpenLibrary={onOpenLibrary} />
              )}
              {tab === 'bin' && (
                <BinCreator datasetId={datasetId} columns={columns} embedded
                  onCreated={(name) => { onCreated(name); refreshExistingCols(); }}
                  onClose={onClose} />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
