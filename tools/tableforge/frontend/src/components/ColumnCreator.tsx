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
}

interface ExistingColumn {
  name: string;
  type: 'metric' | 'bin';
}

export function ColumnCreator({ datasetId, columns, onCreated, onClose, onOpenLibrary }: Props) {
  const [tab, setTab] = useState<'ai' | 'metric' | 'bin'>('ai');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [aiResult, setAiResult] = useState<any>(null);
  const [applying, setApplying] = useState(false);
  const [existingCols, setExistingCols] = useState<ExistingColumn[]>([]);

  useEffect(() => {
    Promise.all([
      fetch(`${API_BASE}/metrics/${datasetId}`).then(r => r.json()).catch(() => []),
      fetch(`${API_BASE}/bins/${datasetId}`).then(r => r.json()).catch(() => []),
    ]).then(([metrics, bins]) => {
      const cols: ExistingColumn[] = [
        ...(metrics || []).map((m: any) => ({ name: m.name || m, type: 'metric' as const })),
        ...(bins || []).map((b: any) => ({ name: b.name || b, type: 'bin' as const })),
      ];
      setExistingCols(cols);
    });
  }, [datasetId]);

  const handleAIGenerate = async () => {
    if (!description.trim()) return;
    setLoading(true); setError(''); setAiResult(null);
    try {
      const res = await fetch(`${API_BASE}/ai/create-column`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataset_id: datasetId, description }),
      });
      if (!res.ok) throw new Error(await res.text());
      setAiResult(await res.json());
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
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
    } catch (e: any) { setError(e.message); }
    finally { setApplying(false); }
  };

  const handleDeleteColumn = async (name: string, type: 'metric' | 'bin') => {
    try {
      const endpoint = type === 'metric' ? 'metrics' : 'bins';
      await fetch(`${API_BASE}/${endpoint}/${datasetId}/${encodeURIComponent(name)}`, { method: 'DELETE' });
      setExistingCols(prev => prev.filter(c => !(c.name === name && c.type === type)));
      onCreated('');
    } catch (e: any) { setError(e.message); }
  };

  const renderAITab = () => (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: 0 }}>
        Describe the column you want to create in natural language. AI will determine whether it's a calculation (metric) or categorization (bin).
      </p>
      <textarea value={description} onChange={e => setDescription(e.target.value)}
        placeholder={"Examples:\n• Calculate BMI from height and weight\n• Categorize age into Young (<30), Middle (30-50), Senior (>50)\n• Create income-to-expense ratio\n• Rank districts by total population\n• IF gender is Female AND age > 18 THEN 'Eligible' ELSE 'Not Eligible'"}
        style={{ width: '100%', minHeight: 100, resize: 'vertical', padding: 8, fontSize: 12, background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 4, color: 'inherit' }} />
      {!aiResult && (
        <button className="btn-primary" onClick={handleAIGenerate} disabled={loading || !description.trim()}>
          {loading ? 'Generating...' : '🤖 Generate Column Definition'}
        </button>
      )}
      {aiResult && (
        <div style={{ padding: 12, background: 'rgba(0,0,0,0.2)', borderRadius: 6 }}>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 6 }}>
            Type: <strong>{aiResult.type === 'metric' ? 'Calculated Column' : 'Categorization (Bin)'}</strong>
          </div>
          <div style={{ fontSize: 12, marginBottom: 8 }}>
            <strong>Name:</strong> {aiResult.definition?.name}
          </div>
          {aiResult.type === 'metric' && (
            <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
              Method: {aiResult.definition?.metric_type} |
              {aiResult.definition?.column_a && ` Column A: ${aiResult.definition.column_a}`}
              {aiResult.definition?.column_b && ` | Column B: ${aiResult.definition.column_b}`}
              {aiResult.definition?.operator && ` | Op: ${aiResult.definition.operator}`}
              {aiResult.definition?.numerator && ` Numerator: ${aiResult.definition.numerator}`}
              {aiResult.definition?.denominator && ` | Denominator: ${aiResult.definition.denominator}`}
            </div>
          )}
          {aiResult.type === 'bin' && (
            <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
              Source: {aiResult.definition?.source_column} | Type: {aiResult.definition?.bin_type}
              {aiResult.definition?.custom_labels && ` | Labels: ${aiResult.definition.custom_labels.join(', ')}`}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button className="btn-primary" onClick={handleApplyAI} disabled={applying}>
              {applying ? 'Creating...' : 'Create Column'}
            </button>
            <button className="fdrop-btn-action" onClick={() => { setAiResult(null); }}>Try Again</button>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: '95vw', width: 900, maxHeight: '90vh' }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Create Column</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body" style={{ display: 'flex', gap: 16, overflow: 'hidden', height: 'calc(90vh - 80px)' }}>
          {/* Left sidebar: existing custom columns */}
          <div style={{ width: 200, minWidth: 200, borderRight: '1px solid rgba(255,255,255,0.08)', paddingRight: 12, overflow: 'auto' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', marginBottom: 8 }}>Custom Columns ({existingCols.length})</div>
            {existingCols.length === 0 && <div style={{ fontSize: 11, color: 'var(--text-dim)', opacity: 0.5 }}>No custom columns yet</div>}
            {existingCols.map(c => (
              <div key={`${c.type}-${c.name}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <div style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                  <span style={{ color: c.type === 'metric' ? '#3b82f6' : '#22c55e', marginRight: 4 }}>{c.type === 'metric' ? 'f' : '⊞'}</span>
                  {c.name}
                </div>
                <button onClick={() => handleDeleteColumn(c.name, c.type)}
                  style={{ fontSize: 10, color: '#f87171', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px' }}>✕</button>
              </div>
            ))}
          </div>

          {/* Main content area */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
            {/* Tab bar */}
            <div style={{ display: 'flex', gap: 0, marginBottom: 12, borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
              {([
                { key: 'ai', label: '🤖 AI Create' },
                { key: 'metric', label: 'f(x) Manual Metric' },
                { key: 'bin', label: '⊞ Manual Bin' },
              ] as const).map(t => (
                <button key={t.key} onClick={() => setTab(t.key)}
                  style={{
                    padding: '8px 16px', fontSize: 12, border: 'none', cursor: 'pointer',
                    background: tab === t.key ? 'rgba(59,130,246,0.2)' : 'transparent',
                    color: tab === t.key ? '#3b82f6' : 'var(--text-dim)',
                    borderBottom: tab === t.key ? '2px solid #3b82f6' : '2px solid transparent',
                  }}>{t.label}</button>
              ))}
            </div>

            {error && <div className="error-msg" style={{ marginBottom: 10 }}>{error}</div>}

            {tab === 'ai' && renderAITab()}
            {tab === 'metric' && (
              <MetricBuilder datasetId={datasetId} columns={columns}
                onCreated={(name) => { onCreated(name); setExistingCols(prev => [...prev, { name, type: 'metric' }]); }}
                onClose={onClose} onOpenLibrary={onOpenLibrary} />
            )}
            {tab === 'bin' && (
              <BinCreator datasetId={datasetId} columns={columns}
                onCreated={(name) => { onCreated(name); setExistingCols(prev => [...prev, { name, type: 'bin' }]); }}
                onClose={onClose} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
