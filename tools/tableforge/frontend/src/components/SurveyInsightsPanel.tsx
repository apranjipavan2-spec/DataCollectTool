import React, { useEffect, useState } from 'react';
import { suggestSurveyCrosstabs, SurveySuggestion } from '../api';
import { TableConfig, ValueField } from '../types';

interface Props {
  datasetId: string;
  onClose: () => void;
  onAdoptTables: (configs: TableConfig[]) => void;
}

const KIND_LABELS: Record<string, { label: string; color: string }> = {
  likert_by_geo:   { label: 'Likert × Geographic',   color: '#a78bfa' },
  likert_by_demo:  { label: 'Likert × Demographic',  color: '#60a5fa' },
  binary_by_demo:  { label: 'Binary × Demographic',  color: '#34d399' },
  pre_post:        { label: 'Pre / Post',            color: '#fbbf24' },
  mr_by_demo:      { label: 'Multi-Response × Group', color: '#f472b6' },
  geo_pair:        { label: 'Geographic Hierarchy',  color: '#fb923c' },
};

function suggestionToTableConfig(s: SurveySuggestion, idx: number): TableConfig {
  const val: ValueField = {
    field: s.value_field === '*' ? (s.rows[0] || s.columns[0] || '') : s.value_field,
    agg: (s.aggregation as any) || 'count',
    label: '',
    ...(s.show_as ? { show_as: s.show_as as any } : {}),
  };
  return {
    id: `survey_${Date.now()}_${idx}`,
    name: s.title,
    title: s.title,
    subtitle: s.description,
    rows: s.rows,
    columns: s.columns,
    values: [val],
    filters: {},
    grand_total: true,
    subtotals: false,
    missing_data: '',
    _autoTitle: false,
  };
}

export function SurveyInsightsPanel({ datasetId, onClose, onAdoptTables }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [suggestions, setSuggestions] = useState<SurveySuggestion[]>([]);
  const [detected, setDetected] = useState<Record<string, any>>({});
  const [selected, setSelected] = useState<Set<number>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    suggestSurveyCrosstabs(datasetId)
      .then(data => {
        if (cancelled) return;
        setSuggestions(data.suggestions || []);
        setDetected(data.detected || {});
        setSelected(new Set((data.suggestions || []).map((_, i) => i)));
      })
      .catch(e => !cancelled && setError(String(e.message || e)))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [datasetId]);

  const toggle = (i: number) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(i)) next.delete(i); else next.add(i);
    return next;
  });

  const adopt = () => {
    const chosen = Array.from(selected).sort((a, b) => a - b).map((i, idx) => suggestionToTableConfig(suggestions[i], idx));
    if (chosen.length === 0) return;
    onAdoptTables(chosen);
    onClose();
  };

  const detectedRow = (label: string, vals: any) => {
    if (!vals) return null;
    const list = Array.isArray(vals) ? vals : [];
    if (list.length === 0) return null;
    return (
      <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', fontSize: 11 }}>
        <span style={{ color: 'var(--text-dim)', minWidth: 110 }}>{label}:</span>
        <span style={{ fontFamily: 'monospace', color: '#cbd5e1' }}>{list.slice(0, 8).join(', ')}{list.length > 8 ? ` +${list.length - 8}` : ''}</span>
      </div>
    );
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: '90vw', width: '90vw', maxHeight: '85vh' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>📊 Survey Insights — Suggested Tables</div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
              From auto-detected column roles. Likert, binary outcomes, pre/post pairs and demographics are used to propose meaningful crosstabs.
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 18 }}>×</button>
        </div>

        {loading && <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-dim)' }}>Analyzing column roles…</div>}
        {error && <div style={{ padding: 12, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.35)', borderRadius: 4, color: '#fca5a5', fontSize: 12 }}>{error}</div>}

        {!loading && !error && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 16, overflow: 'hidden', flex: 1, minHeight: 0 }}>
              {/* Sidebar — what we detected */}
              <div style={{ background: 'rgba(0,0,0,0.18)', padding: 12, borderRadius: 6, overflow: 'auto' }}>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8, color: '#a78bfa' }}>Detected in your data</div>
                {detectedRow('Likert columns', detected.likert)}
                {detectedRow('Binary outcomes', detected.binary)}
                {detectedRow('Multi-response', detected.multi_response)}
                {detectedRow('Geographic', detected.geographic)}
                {detectedRow('Demographics', detected.demographics)}
                {(detected.pre_post_pairs?.length ?? 0) > 0 && (
                  <div style={{ marginTop: 8, fontSize: 11 }}>
                    <span style={{ color: 'var(--text-dim)' }}>Pre/Post pairs:</span>
                    <ul style={{ margin: '4px 0 0 16px', padding: 0, fontFamily: 'monospace', color: '#cbd5e1' }}>
                      {detected.pre_post_pairs.slice(0, 5).map((p: any, i: number) => (
                        <li key={i}>{p.pre} → {p.post}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {detected.weight_col && (
                  <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-dim)' }}>
                    Survey weight: <span style={{ fontFamily: 'monospace', color: '#cbd5e1' }}>{detected.weight_col}</span>
                  </div>
                )}
                <div style={{ marginTop: 14, padding: 8, background: 'rgba(168,85,247,0.08)', borderRadius: 4, fontSize: 11, color: 'var(--text-dim)' }}>
                  Tip: To improve detection, set column roles via <strong>Survey Design → Variable Metadata</strong>.
                </div>
              </div>

              {/* Suggestions list */}
              <div style={{ overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{suggestions.length} suggestion{suggestions.length === 1 ? '' : 's'} · {selected.size} selected</div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn-secondary" style={{ fontSize: 11, padding: '3px 8px' }}
                      onClick={() => setSelected(new Set(suggestions.map((_, i) => i)))}>Select all</button>
                    <button className="btn-secondary" style={{ fontSize: 11, padding: '3px 8px' }}
                      onClick={() => setSelected(new Set())}>Clear</button>
                  </div>
                </div>
                {suggestions.length === 0 && (
                  <div style={{ padding: 24, color: 'var(--text-dim)', fontSize: 12, textAlign: 'center' }}>
                    No suggestions yet. The dataset may not have enough Likert / demographic structure. Try setting column roles manually via Survey Design.
                  </div>
                )}
                {suggestions.map((s, i) => {
                  const meta = KIND_LABELS[s.kind] || { label: s.kind, color: '#94a3b8' };
                  const isSelected = selected.has(i);
                  return (
                    <div key={i}
                      onClick={() => toggle(i)}
                      style={{
                        padding: 10, borderRadius: 6, cursor: 'pointer',
                        background: isSelected ? 'rgba(168,85,247,0.10)' : 'rgba(0,0,0,0.15)',
                        border: isSelected ? '1px solid rgba(168,85,247,0.5)' : '1px solid rgba(255,255,255,0.06)',
                      }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
                        <input type="checkbox" checked={isSelected} onChange={() => toggle(i)} onClick={e => e.stopPropagation()} />
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 3, background: meta.color + '22', color: meta.color }}>{meta.label}</span>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>{s.title}</span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-dim)', marginLeft: 24, marginBottom: 4 }}>{s.description}</div>
                      <div style={{ fontSize: 11, color: '#94a3b8', marginLeft: 24, fontStyle: 'italic' }}>{s.rationale}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <button className="btn-secondary" onClick={onClose}>Cancel</button>
              <button className="btn-primary" onClick={adopt} disabled={selected.size === 0}>
                Add {selected.size > 0 ? `${selected.size} ` : ''}table{selected.size === 1 ? '' : 's'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
