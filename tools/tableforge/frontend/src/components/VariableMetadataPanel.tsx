import React, { useEffect, useMemo, useState } from 'react';
import { ColumnInfo, ColumnRole, ColumnRoleKind, ColumnScale } from '../types';
import {
  autoDetectRoles, bulkSetColumnRoles, deleteColumnRole, getColumnRoles, setColumnRole,
} from '../api';

interface Props {
  datasetId: string;
  columns: ColumnInfo[];
  onClose: () => void;
  onSaved?: (roles: Record<string, ColumnRole>) => void;
}

const ROLE_OPTIONS: { value: ColumnRoleKind; label: string; hint?: string }[] = [
  { value: 'outcome',         label: 'Outcome',         hint: 'Dependent variable — what you measure' },
  { value: 'treatment',       label: 'Treatment',       hint: 'The intervention / group indicator' },
  { value: 'demographic',     label: 'Demographic' },
  { value: 'mediator',        label: 'Mediator' },
  { value: 'moderator',       label: 'Moderator' },
  { value: 'geographic',      label: 'Geographic' },
  { value: 'panel_wave',      label: 'Panel wave',      hint: 'Identifies survey round (T1, T2…)' },
  { value: 'observer_rated',  label: 'Observer-rated',  hint: 'Recorded by enumerator, not self' },
  { value: 'qualitative',     label: 'Qualitative',     hint: 'Open-ended text' },
  { value: 'weight',          label: 'Survey weight' },
  { value: 'id',              label: 'ID / Key' },
  { value: 'other',           label: 'Other' },
];

const SCALE_OPTIONS: { value: ColumnScale; label: string }[] = [
  { value: 'binary',         label: 'Binary (0/1)' },
  { value: 'nominal',        label: 'Nominal (categories)' },
  { value: 'ordinal',        label: 'Ordinal (ordered)' },
  { value: 'likert',         label: 'Likert (e.g. 1–5)' },
  { value: 'count',          label: 'Count' },
  { value: 'interval',       label: 'Interval' },
  { value: 'ratio',          label: 'Ratio' },
  { value: 'multi_response', label: 'Multi-response' },
];

const ROLE_BADGE: Record<string, { label: string; color: string }> = {
  outcome:        { label: 'O',   color: '#ef4444' },
  treatment:      { label: 'T',   color: '#a855f7' },
  demographic:    { label: 'D',   color: '#22c55e' },
  geographic:     { label: 'Geo', color: '#0ea5e9' },
  observer_rated: { label: 'Obs', color: '#f59e0b' },
  qualitative:    { label: 'Q',   color: '#ec4899' },
  weight:         { label: 'Wt',  color: '#94a3b8' },
  id:             { label: 'ID',  color: '#64748b' },
};

export function roleBadge(role?: string): { label: string; color: string } | null {
  if (!role) return null;
  return ROLE_BADGE[role] || null;
}

export function VariableMetadataPanel({ datasetId, columns, onClose, onSaved }: Props) {
  const [roles, setRoles] = useState<Record<string, ColumnRole>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [autoLoading, setAutoLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [pairEditor, setPairEditor] = useState<string | null>(null);
  const [labelEditor, setLabelEditor] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    getColumnRoles(datasetId)
      .then(r => setRoles(r.roles || {}))
      .catch(() => setRoles({}))
      .finally(() => setLoading(false));
  }, [datasetId]);

  const updateRole = (col: string, patch: Partial<ColumnRole>) => {
    setRoles(prev => ({ ...prev, [col]: { ...(prev[col] || {}), ...patch } }));
    setDirty(prev => new Set(prev).add(col));
  };

  const clearRole = async (col: string) => {
    setRoles(prev => { const next = { ...prev }; delete next[col]; return next; });
    setDirty(prev => { const next = new Set(prev); next.delete(col); return next; });
    try { await deleteColumnRole(datasetId, col); } catch {}
  };

  const saveAll = async () => {
    if (dirty.size === 0) { setStatusMsg('Nothing to save'); return; }
    setSaving(true);
    try {
      const payload: Record<string, ColumnRole> = {};
      dirty.forEach(c => { if (roles[c]) payload[c] = roles[c]; });
      await bulkSetColumnRoles(datasetId, payload);
      setDirty(new Set());
      setStatusMsg(`Saved roles for ${Object.keys(payload).length} column(s)`);
      onSaved?.(roles);
    } catch (e: any) {
      setStatusMsg('Save failed: ' + (e.message || e));
    } finally {
      setSaving(false);
    }
  };

  const saveSingle = async (col: string) => {
    if (!roles[col]) return;
    try {
      await setColumnRole(datasetId, col, roles[col]);
      setDirty(prev => { const next = new Set(prev); next.delete(col); return next; });
    } catch (e: any) {
      setStatusMsg('Save failed: ' + (e.message || e));
    }
  };

  const runAutoDetect = async () => {
    setAutoLoading(true);
    setStatusMsg(null);
    try {
      const res = await autoDetectRoles(datasetId);
      // Merge — only overwrite cells that are not already manually set.
      setRoles(prev => {
        const next = { ...prev };
        Object.entries(res.suggested_roles || {}).forEach(([col, sug]) => {
          if (!next[col] || (!next[col].role && !next[col].scale)) {
            next[col] = { ...sug };
          }
        });
        return next;
      });
      // Mark all suggested as dirty so user can review then save.
      setDirty(prev => {
        const next = new Set(prev);
        Object.keys(res.suggested_roles || {}).forEach(c => next.add(c));
        return next;
      });
      setStatusMsg(`Auto-detected roles for ${res.column_count} column(s). Review and Save.`);
    } catch (e: any) {
      setStatusMsg('Auto-detect failed: ' + (e.message || e));
    } finally {
      setAutoLoading(false);
    }
  };

  const filtered = useMemo(() => {
    const q = filter.toLowerCase();
    return columns.filter(c => !q || c.name.toLowerCase().includes(q));
  }, [columns, filter]);

  const columnNames = useMemo(() => columns.map(c => c.name), [columns]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: 1100, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>🏷️ Variable Metadata</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="text" placeholder="Search columns…" value={filter}
            onChange={e => setFilter(e.target.value)}
            style={{ flex: 1, minWidth: 180, padding: '4px 8px', background: 'rgba(0,0,0,0.25)', border: '1px solid var(--border)', borderRadius: 4, color: 'inherit', fontSize: 12 }}
          />
          <button className="btn-small" onClick={runAutoDetect} disabled={autoLoading}>
            {autoLoading ? 'Detecting…' : '🪄 Auto-detect'}
          </button>
          <button className="btn-small btn-primary" onClick={saveAll} disabled={saving || dirty.size === 0}>
            {saving ? 'Saving…' : `💾 Save (${dirty.size})`}
          </button>
          <span style={{ fontSize: 11, opacity: 0.75 }}>
            {Object.keys(roles).length} of {columns.length} tagged
          </span>
        </div>

        {statusMsg && (
          <div style={{ padding: '6px 14px', fontSize: 12, background: 'rgba(59,130,246,0.1)', borderBottom: '1px solid var(--border)' }}>
            {statusMsg}
          </div>
        )}

        <div className="modal-body" style={{ overflow: 'auto', padding: 0, flex: 1 }}>
          {loading && <div style={{ padding: 12 }}>Loading…</div>}
          {!loading && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead style={{ position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 1 }}>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th style={th}>Column</th>
                  <th style={th}>Type</th>
                  <th style={th}>Role</th>
                  <th style={th}>Scale</th>
                  <th style={th}>Paired with</th>
                  <th style={th}>MR set / Units / Benchmark</th>
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(col => {
                  const r = roles[col.name] || {};
                  const isDirty = dirty.has(col.name);
                  const badge = roleBadge(r.role || undefined);
                  return (
                    <tr key={col.name} style={{ borderBottom: '1px solid var(--border)', background: isDirty ? 'rgba(245,158,11,0.06)' : 'transparent' }}>
                      <td style={{ ...td, fontWeight: 500 }}>
                        {badge && (
                          <span title={r.role || ''} style={{
                            display: 'inline-block', minWidth: 18, padding: '0 4px',
                            marginRight: 6, fontSize: 9, borderRadius: 3, background: badge.color,
                            color: '#fff', textAlign: 'center', verticalAlign: 'middle',
                          }}>{badge.label}</span>
                        )}
                        {col.name}
                      </td>
                      <td style={{ ...td, opacity: 0.7 }}>{col.type}</td>
                      <td style={td}>
                        <select value={r.role || ''} onChange={e => updateRole(col.name, { role: e.target.value || null })} style={sel}>
                          <option value="">—</option>
                          {ROLE_OPTIONS.map(o => (
                            <option key={o.value} value={o.value} title={o.hint}>{o.label}</option>
                          ))}
                        </select>
                      </td>
                      <td style={td}>
                        <select value={r.scale || ''} onChange={e => updateRole(col.name, { scale: e.target.value || null })} style={sel}>
                          <option value="">—</option>
                          {SCALE_OPTIONS.map(o => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                        {(r.scale === 'likert' || r.scale === 'nominal' || r.scale === 'ordinal' || r.scale === 'binary') && (
                          <button className="btn-small" onClick={() => setLabelEditor(col.name)} style={{ marginLeft: 4, fontSize: 10, padding: '1px 6px' }}>
                            Labels ({Object.keys(r.value_labels || {}).length})
                          </button>
                        )}
                      </td>
                      <td style={td}>
                        <button className="btn-small" onClick={() => setPairEditor(col.name)} style={{ fontSize: 11, padding: '2px 6px' }}>
                          {r.paired_with || '—'}
                        </button>
                      </td>
                      <td style={td}>
                        <input type="text" placeholder="MR set id" value={r.mr_set_id || ''}
                          onChange={e => updateRole(col.name, { mr_set_id: e.target.value || null })}
                          style={{ ...input, width: 70, marginRight: 4 }} />
                        <input type="text" placeholder="units" value={r.units || ''}
                          onChange={e => updateRole(col.name, { units: e.target.value || null })}
                          style={{ ...input, width: 60, marginRight: 4 }} />
                        <input type="text" placeholder="benchmark id" value={r.benchmark_link || ''}
                          onChange={e => updateRole(col.name, { benchmark_link: e.target.value || null })}
                          style={{ ...input, width: 90 }} />
                      </td>
                      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {isDirty && <button className="btn-small btn-primary" onClick={() => saveSingle(col.name)} style={{ fontSize: 10, padding: '2px 8px', marginRight: 4 }}>Save</button>}
                        {(r.role || r.scale) && <button className="btn-small" onClick={() => clearRole(col.name)} style={{ fontSize: 10, padding: '2px 8px' }}>Clear</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {pairEditor && (
          <PairPicker
            column={pairEditor}
            current={roles[pairEditor]?.paired_with || null}
            candidates={columnNames.filter(n => n !== pairEditor)}
            onPick={(other) => {
              updateRole(pairEditor, { paired_with: other });
              if (other) {
                // Bidirectional update for convenience.
                updateRole(other, { paired_with: pairEditor });
              }
              setPairEditor(null);
            }}
            onClose={() => setPairEditor(null)}
          />
        )}

        {labelEditor && (
          <ValueLabelsEditor
            column={labelEditor}
            sampleValues={columns.find(c => c.name === labelEditor)?.sample_values || []}
            current={roles[labelEditor]?.value_labels || {}}
            onSave={(labels) => { updateRole(labelEditor, { value_labels: labels }); setLabelEditor(null); }}
            onClose={() => setLabelEditor(null)}
          />
        )}
      </div>
    </div>
  );
}

// ── Sub-modals ──────────────────────────────────────────────

function PairPicker({ column, current, candidates, onPick, onClose }: {
  column: string;
  current: string | null;
  candidates: string[];
  onPick: (other: string | null) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const filtered = candidates.filter(c => !q || c.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 1200 }}>
      <div className="modal-content" style={{ maxWidth: 460, maxHeight: '70vh' }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 style={{ fontSize: 14 }}>Pair "{column}" with…</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div style={{ padding: 10 }}>
          <input type="text" autoFocus placeholder="Filter columns…" value={q}
            onChange={e => setQ(e.target.value)}
            style={{ width: '100%', padding: '4px 8px', fontSize: 12, background: 'rgba(0,0,0,0.25)', border: '1px solid var(--border)', borderRadius: 4, color: 'inherit' }} />
        </div>
        <div style={{ overflow: 'auto', maxHeight: 380, padding: '0 10px 10px' }}>
          <button className="btn-small" onClick={() => onPick(null)} style={{ marginBottom: 6, fontSize: 11 }}>
            Clear pairing {current && `(was: ${current})`}
          </button>
          {filtered.map(c => (
            <div key={c}
              onClick={() => onPick(c)}
              style={{ padding: '5px 8px', cursor: 'pointer', borderRadius: 3, background: c === current ? 'rgba(59,130,246,0.15)' : 'transparent' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
              onMouseLeave={e => (e.currentTarget.style.background = c === current ? 'rgba(59,130,246,0.15)' : 'transparent')}>
              {c}{c === current ? '  ✓' : ''}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ValueLabelsEditor({ column, sampleValues, current, onSave, onClose }: {
  column: string;
  sampleValues: string[];
  current: Record<string, string>;
  onSave: (labels: Record<string, string>) => void;
  onClose: () => void;
}) {
  const initialPairs = useMemo(() => {
    const known = Object.entries(current).map(([k, v]) => ({ k, v }));
    const knownKeys = new Set(Object.keys(current));
    const extras = Array.from(new Set(sampleValues.map(s => String(s))))
      .filter(s => !knownKeys.has(s)).slice(0, 10)
      .map(s => ({ k: s, v: '' }));
    return known.concat(extras);
  }, [current, sampleValues]);
  const [pairs, setPairs] = useState(initialPairs);

  const update = (i: number, field: 'k' | 'v', val: string) => {
    setPairs(prev => prev.map((p, idx) => idx === i ? { ...p, [field]: val } : p));
  };

  const addRow = () => setPairs(prev => [...prev, { k: '', v: '' }]);
  const removeRow = (i: number) => setPairs(prev => prev.filter((_, idx) => idx !== i));

  const handleSave = () => {
    const out: Record<string, string> = {};
    pairs.forEach(p => { if (p.k && p.v) out[p.k] = p.v; });
    onSave(out);
  };

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 1200 }}>
      <div className="modal-content" style={{ maxWidth: 480, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 style={{ fontSize: 14 }}>Value labels — {column}</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div style={{ padding: 10, fontSize: 11, opacity: 0.75 }}>
          Map raw values to human-readable labels (e.g. 1 → "Strongly Disagree").
        </div>
        <div style={{ overflow: 'auto', padding: '0 10px', flex: 1 }}>
          {pairs.map((p, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
              <input value={p.k} onChange={e => update(i, 'k', e.target.value)} placeholder="raw"
                style={{ ...input, width: 100 }} />
              <span style={{ opacity: 0.4 }}>→</span>
              <input value={p.v} onChange={e => update(i, 'v', e.target.value)} placeholder="label"
                style={{ ...input, flex: 1 }} />
              <button className="btn-small" onClick={() => removeRow(i)} style={{ fontSize: 10, padding: '2px 6px' }}>✕</button>
            </div>
          ))}
          <button className="btn-small" onClick={addRow} style={{ fontSize: 11, marginTop: 6 }}>+ Add row</button>
        </div>
        <div style={{ padding: 10, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
          <button className="btn-small" onClick={onClose}>Cancel</button>
          <button className="btn-small btn-primary" onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  );
}

const th: React.CSSProperties = { textAlign: 'left', padding: '6px 8px', fontWeight: 600, fontSize: 11, opacity: 0.85 };
const td: React.CSSProperties = { padding: '5px 8px', verticalAlign: 'middle' };
const sel: React.CSSProperties = { fontSize: 11, padding: '2px 4px', background: 'rgba(0,0,0,0.25)', border: '1px solid var(--border)', borderRadius: 3, color: 'inherit', maxWidth: 140 };
const input: React.CSSProperties = { fontSize: 11, padding: '2px 5px', background: 'rgba(0,0,0,0.25)', border: '1px solid var(--border)', borderRadius: 3, color: 'inherit' };
