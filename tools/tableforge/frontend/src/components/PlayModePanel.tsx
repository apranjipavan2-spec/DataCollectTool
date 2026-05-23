import React, { useEffect, useMemo, useState } from 'react';
import { API_BASE } from '../api';

interface Props {
  datasetId: string;
  onClose: () => void;
  onAction: (action: string, opts?: { columns?: string[] }) => void;
}

interface ColumnProfile {
  name: string;
  inferred_type: string;
  suggested_scale: string;
  effective_scale: string;
  n_total: number;
  n_unique: number;
  n_missing: number;
  missingness: number;
  top_values: { v: string; count: number }[];
  fingerprint_tags: string[];
  numeric_stats?: Record<string, any> | null;
  text_stats?: Record<string, any> | null;
  eligible_analyses: {
    id: string; label: string; kind: string; priority: number; why: string;
  }[];
}

interface ProfileResp {
  dataset_id: string;
  n_rows: number;
  n_cols: number;
  columns: ColumnProfile[];
  scale_tally: Record<string, number>;
}

interface AISuggestion {
  outcome: string;
  predictors: string[];
  test: string;
  why: string;
}

const SCALE_OPTIONS = [
  'binary', 'continuous', 'likert', 'ordinal', 'nominal', 'multi_response',
  'date', 'free_text', 'id', 'unknown',
];

const TAG_COLORS: Record<string, string> = {
  'binary': '#3b82f6', 'binary-text': '#3b82f6',
  'continuous': '#22c55e',
  'likert-like': '#a855f7', 'likert-text': '#a855f7',
  'ordinal-int': '#a855f7',
  'mr-comma': '#f59e0b',
  'free-text': '#64748b',
  'id-like': '#ef4444',
  'high-missing': '#ef4444', 'moderate-missing': '#f97316',
  'datetime': '#06b6d4', 'date-like-name': '#06b6d4',
  'geographic': '#14b8a6',
  'nominal-low': '#8b5cf6', 'nominal-medium': '#8b5cf6', 'nominal-high': '#8b5cf6',
  'low-cardinality-numeric': '#22c55e',
};

function Badge({ text, color }: { text: string; color: string }) {
  return (
    <span style={{
      fontSize: 10, padding: '2px 6px', borderRadius: 4,
      background: color + '22', color, border: `1px solid ${color}55`,
      whiteSpace: 'nowrap', textTransform: 'lowercase',
    }}>{text}</span>
  );
}

function PriorityChip({ a, onClick }: {
  a: ColumnProfile['eligible_analyses'][number];
  onClick: () => void;
}) {
  const tone = a.priority === 1
    ? { bg: 'rgba(59,130,246,0.15)', bd: 'rgba(59,130,246,0.5)', fg: '#60a5fa' }
    : a.priority === 2
      ? { bg: 'rgba(168,85,247,0.12)', bd: 'rgba(168,85,247,0.45)', fg: '#c084fc' }
      : { bg: 'rgba(100,116,139,0.12)', bd: 'rgba(100,116,139,0.4)', fg: '#94a3b8' };
  return (
    <button
      onClick={onClick}
      title={a.why}
      style={{
        fontSize: 11, padding: '3px 8px', borderRadius: 12,
        background: tone.bg, border: `1px solid ${tone.bd}`, color: tone.fg,
        cursor: 'pointer', whiteSpace: 'nowrap',
      }}
    >{a.label}</button>
  );
}

export function PlayModePanel({ datasetId, onClose, onAction }: Props) {
  const [profile, setProfile] = useState<ProfileResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [filterScale, setFilterScale] = useState<string>('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<AISuggestion[] | null>(null);
  const [aiNote, setAiNote] = useState<string>('');
  const [aiError, setAiError] = useState<string | null>(null);

  const runProfile = async (newOverrides: Record<string, string>) => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`${API_BASE}/play/profile`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataset_id: datasetId, overrides: newOverrides }),
      });
      if (!res.ok) throw new Error(await res.text());
      setProfile(await res.json());
    } catch (e: any) {
      setError(e?.message || 'Failed to profile dataset');
    } finally { setLoading(false); }
  };

  useEffect(() => { runProfile({}); /* on mount */ }, []);

  const setOverride = (col: string, scale: string) => {
    const next = { ...overrides };
    if (scale === '__auto__') delete next[col]; else next[col] = scale;
    setOverrides(next);
    runProfile(next);
  };

  const runAI = async () => {
    setAiBusy(true); setAiError(null); setAiSuggestions(null); setAiNote('');
    try {
      const res = await fetch(`${API_BASE}/play/ai-combinations`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataset_id: datasetId, overrides, max_suggestions: 15 }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setAiSuggestions(data.suggestions || []);
      if (data.truncated) setAiNote(`Note: ${data.n_columns_sent} columns sent (truncated from full set).`);
      else if (data.n_columns_sent) setAiNote(`Sent ${data.n_columns_sent} columns to ${data.provider}/${data.model || 'default'}.`);
    } catch (e: any) {
      setAiError(e?.message || 'AI request failed. Check that an AI key is configured.');
    } finally { setAiBusy(false); }
  };

  const filtered = useMemo(() => {
    if (!profile) return [];
    const q = search.trim().toLowerCase();
    return profile.columns.filter(c => {
      if (filterScale && c.effective_scale !== filterScale) return false;
      if (q && !c.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [profile, search, filterScale]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}
        style={{ width: '88vw', height: '88vh', maxWidth: '88vw', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-header">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 22 }}>🎮</span>
            <span>Play Mode — Analysis Recommender</span>
            <span style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 400, marginLeft: 6 }}>
              Auto-profile every column and surface eligible analyses
            </span>
          </h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div style={{ padding: '10px 18px', borderBottom: '1px solid var(--border)',
          display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search column…"
            style={{ flex: '0 1 240px', padding: '6px 10px', background: 'var(--bg-alt)',
              color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4, fontSize: 12 }} />
          <select value={filterScale} onChange={e => setFilterScale(e.target.value)}
            style={{ padding: '6px 10px', background: 'var(--bg-alt)', color: 'var(--text)',
              border: '1px solid var(--border)', borderRadius: 4, fontSize: 12 }}>
            <option value="">All scales</option>
            {SCALE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          {profile && (
            <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
              {profile.n_rows} rows · {profile.n_cols} cols · scales: {Object.entries(profile.scale_tally)
                .map(([k, v]) => `${k}=${v}`).join(' · ')}
            </span>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button className="btn-secondary" onClick={() => { setOverrides({}); runProfile({}); }}
              style={{ fontSize: 11 }}>Reset overrides</button>
            <button className="btn-primary" onClick={runAI} disabled={aiBusy || !profile}
              style={{ fontSize: 11 }}>
              {aiBusy ? 'Thinking…' : '✨ Ask AI for combinations'}
            </button>
          </div>
        </div>

        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          {/* Column list */}
          <div style={{ flex: 1.4, overflowY: 'auto', padding: '12px 18px' }}>
            {loading && <div style={{ color: 'var(--text-dim)' }}>Profiling columns…</div>}
            {error && <div style={{ color: '#f87171' }}>{error}</div>}
            {!loading && !error && filtered.length === 0 && profile && (
              <div style={{ color: 'var(--text-dim)' }}>No columns match the filter.</div>
            )}
            {filtered.map(c => (
              <div key={c.name} style={{
                padding: 12, marginBottom: 8, background: 'var(--bg-alt)',
                border: '1px solid var(--border)', borderRadius: 6,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: 13 }}>{c.name}</strong>
                  <Badge text={c.inferred_type} color="#94a3b8" />
                  {c.fingerprint_tags.map(t => (
                    <Badge key={t} text={t} color={TAG_COLORS[t] || '#64748b'} />
                  ))}
                  <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>
                    {c.n_unique} uniques · {c.n_missing}/{c.n_total} missing ({Math.round(c.missingness * 100)}%)
                  </span>
                  <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>Treat as:</span>
                    <select
                      value={overrides[c.name] || '__auto__'}
                      onChange={e => setOverride(c.name, e.target.value)}
                      style={{ fontSize: 11, padding: '3px 6px', background: 'var(--surface)',
                        color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 3 }}>
                      <option value="__auto__">auto ({c.suggested_scale})</option>
                      {SCALE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </span>
                </div>

                {c.top_values.length > 0 && (
                  <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 6 }}>
                    Top: {c.top_values.map(t => `${t.v} (${t.count})`).join(' · ')}
                  </div>
                )}
                {c.numeric_stats && c.numeric_stats.min !== undefined && (
                  <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4 }}>
                    {typeof c.numeric_stats.min === 'number' && (
                      <>min={c.numeric_stats.min} · max={c.numeric_stats.max} · mean={c.numeric_stats.mean?.toFixed?.(2)} · sd={c.numeric_stats.std?.toFixed?.(2)}</>
                    )}
                    {typeof c.numeric_stats.min === 'string' && (
                      <>range: {c.numeric_stats.min} → {c.numeric_stats.max}</>
                    )}
                  </div>
                )}

                {c.eligible_analyses.length > 0 ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                    {c.eligible_analyses.map(a => (
                      <PriorityChip key={a.id + a.label} a={a}
                        onClick={() => onAction(a.id, { columns: [c.name] })} />
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 8, fontStyle: 'italic' }}>
                    No deterministic analyses suggested for this column profile.
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* AI suggestions side panel */}
          <div style={{
            flex: 1, borderLeft: '1px solid var(--border)', padding: '12px 18px',
            overflowY: 'auto', background: 'rgba(255,255,255,0.015)',
          }}>
            <h3 style={{ fontSize: 13, margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>✨</span>
              <span>AI Cross-column Suggestions</span>
            </h3>
            <p style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 0 }}>
              Click <strong>Ask AI for combinations</strong> above to get test recommendations across
              columns. Requires an AI key in Org Settings → AI.
            </p>
            {aiNote && <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 8 }}>{aiNote}</div>}
            {aiError && (
              <div style={{ padding: 10, background: 'rgba(239,68,68,0.1)',
                border: '1px solid rgba(239,68,68,0.4)', borderRadius: 4,
                color: '#f87171', fontSize: 11, whiteSpace: 'pre-wrap' }}>{aiError}</div>
            )}
            {aiSuggestions && aiSuggestions.length === 0 && !aiError && (
              <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>No suggestions returned.</div>
            )}
            {aiSuggestions && aiSuggestions.map((s, i) => (
              <div key={i} style={{
                padding: 10, marginBottom: 8, background: 'var(--bg-alt)',
                border: '1px solid var(--border)', borderRadius: 6,
              }}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>{s.test}</div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
                  {s.outcome && <><strong>Outcome:</strong> {s.outcome}<br /></>}
                  {s.predictors?.length > 0 && <><strong>Predictor(s):</strong> {s.predictors.join(', ')}</>}
                </div>
                {s.why && <div style={{ fontSize: 11, marginTop: 6, lineHeight: 1.45 }}>{s.why}</div>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
