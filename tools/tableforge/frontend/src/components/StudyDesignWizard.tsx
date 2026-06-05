import React, { useEffect, useMemo, useState } from 'react';
import { ColumnInfo, PrePostPair, StudyDesign, StudyDesignType, ColumnRole } from '../types';
import { getColumnRoles, getStudyDesign, saveStudyDesign } from '../api';

interface Props {
  datasetId: string;
  columns: ColumnInfo[];
  onClose: () => void;
  onSaved?: (design: StudyDesign) => void;
}

const DESIGN_OPTIONS: { value: StudyDesignType; label: string; hint: string }[] = [
  { value: 'cross_sectional',     label: 'Cross-sectional',     hint: 'One snapshot, one wave.' },
  { value: 'pre_post',            label: 'Pre / post',           hint: 'Same respondents measured before and after.' },
  { value: 'quasi_experimental',  label: 'Quasi-experimental',   hint: 'Treatment vs comparison, no random assignment.' },
  { value: 'panel',               label: 'Panel',                hint: '3+ waves of same respondents.' },
  { value: 'rcs',                 label: 'Repeated cross-section', hint: 'Different respondents at each wave.' },
];

export function StudyDesignWizard({ datasetId, columns, onClose, onSaved }: Props) {
  const [step, setStep] = useState(1);
  const [design, setDesign] = useState<StudyDesign>({
    design_type: 'cross_sectional',
    pre_post_pairs: [],
    strata: [],
  });
  const [roles, setRoles] = useState<Record<string, ColumnRole>>({});
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      getStudyDesign(datasetId).catch(() => ({ design: {} as StudyDesign })),
      getColumnRoles(datasetId).catch(() => ({ roles: {} })),
    ]).then(([d, r]) => {
      if (d.design && Object.keys(d.design).length) {
        setDesign({
          design_type: 'cross_sectional',
          pre_post_pairs: [],
          strata: [],
          ...d.design,
        });
      }
      setRoles(r.roles || {});
    });
  }, [datasetId]);

  const colNames = useMemo(() => columns.map(c => c.name), [columns]);

  // Pre-list columns by role to help the user.
  const byRole = useMemo(() => {
    const map: Record<string, string[]> = {};
    Object.entries(roles).forEach(([col, r]) => {
      if (r.role) (map[r.role] ||= []).push(col);
    });
    return map;
  }, [roles]);

  const pairedSuggestions = useMemo(() => {
    // Use paired_with markers from column_roles to suggest pre_post pairs.
    const seen = new Set<string>();
    const out: PrePostPair[] = [];
    Object.entries(roles).forEach(([col, r]) => {
      const partner = r.paired_with;
      if (!partner || seen.has(col) || seen.has(partner)) return;
      // Best-effort: col with "post|after|endline|t2|w2" in name is the post.
      const post = /(post|after|endline|t2|w2|wave2|round2)/i.test(partner) ? partner
        : /(post|after|endline|t2|w2|wave2|round2)/i.test(col) ? col : partner;
      const pre = post === col ? partner : col;
      out.push({ pre, post });
      seen.add(col); seen.add(partner);
    });
    return out;
  }, [roles]);

  const update = <K extends keyof StudyDesign>(field: K, value: StudyDesign[K]) => {
    setDesign(prev => ({ ...prev, [field]: value }));
  };

  const togglePair = (p: PrePostPair) => {
    setDesign(prev => {
      const pairs = prev.pre_post_pairs || [];
      const exists = pairs.find(x => x.pre === p.pre && x.post === p.post);
      return {
        ...prev,
        pre_post_pairs: exists
          ? pairs.filter(x => !(x.pre === p.pre && x.post === p.post))
          : [...pairs, p],
      };
    });
  };

  const toggleStrata = (col: string) => {
    setDesign(prev => {
      const s = prev.strata || [];
      return { ...prev, strata: s.includes(col) ? s.filter(x => x !== col) : [...s, col] };
    });
  };

  const save = async () => {
    setSaving(true);
    setStatusMsg(null);
    try {
      await saveStudyDesign(datasetId, design);
      setStatusMsg('Study design saved.');
      onSaved?.(design);
    } catch (e: any) {
      setStatusMsg('Save failed: ' + (e.message || e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: 720, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>🧭 Study Design Wizard</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div style={{ display: 'flex', gap: 4, padding: '8px 14px', borderBottom: '1px solid var(--border)', fontSize: 11 }}>
          {['Design', 'Treatment & outcome', 'Weights & clusters', 'Pairs & strata'].map((label, i) => (
            <button
              key={i}
              onClick={() => setStep(i + 1)}
              className={step === i + 1 ? 'btn-small btn-primary' : 'btn-small'}
              style={{ flex: 1, padding: '4px 8px' }}
            >
              {i + 1}. {label}
            </button>
          ))}
        </div>

        <div className="modal-body" style={{ overflow: 'auto', padding: 14, flex: 1 }}>
          {step === 1 && (
            <div>
              <h3 style={{ fontSize: 13, marginTop: 0 }}>What kind of study is this?</h3>
              {DESIGN_OPTIONS.map(o => (
                <label key={o.value} style={{ display: 'block', padding: '8px 10px', marginBottom: 6, border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer', background: design.design_type === o.value ? 'rgba(59,130,246,0.1)' : 'transparent' }}>
                  <input type="radio" name="dtype" checked={design.design_type === o.value}
                    onChange={() => update('design_type', o.value)} style={{ marginRight: 6 }} />
                  <strong>{o.label}</strong>
                  <div style={{ fontSize: 11, opacity: 0.75, marginLeft: 22 }}>{o.hint}</div>
                </label>
              ))}
            </div>
          )}

          {step === 2 && (
            <div>
              <h3 style={{ fontSize: 13, marginTop: 0 }}>Treatment & primary group indicator</h3>
              <p style={{ fontSize: 11, opacity: 0.7 }}>
                Pick the column that identifies who received the intervention. For an RCT this is the random assignment;
                for an impact evaluation it's the beneficiary / non-beneficiary marker.
              </p>
              <Row label="Treatment column">
                <ColumnSelect value={design.treatment_col} columns={colNames}
                  hint={byRole['treatment']}
                  onChange={v => update('treatment_col', v)} />
              </Row>
              <Row label="Value that counts as 'treated'">
                <input type="text" value={design.treatment_value || ''}
                  placeholder="e.g. Beneficiary, 1, Yes"
                  onChange={e => update('treatment_value', e.target.value)}
                  style={input} />
              </Row>
              <hr style={{ opacity: 0.2, margin: '14px 0' }} />
              <div style={{ fontSize: 11, opacity: 0.8 }}>
                <strong>Tagged outcomes:</strong>{' '}
                {(byRole['outcome'] || []).join(', ') || <em>none yet — tag columns as "outcome" in Variable Metadata.</em>}
              </div>
            </div>
          )}

          {step === 3 && (
            <div>
              <h3 style={{ fontSize: 13, marginTop: 0 }}>Survey weights, clustering, panel IDs</h3>
              <Row label="Weight column">
                <ColumnSelect value={design.weight_col} columns={colNames}
                  hint={byRole['weight']}
                  onChange={v => update('weight_col', v)} />
              </Row>
              <Row label="Cluster column (PSU / village)">
                <ColumnSelect value={design.cluster_col} columns={colNames}
                  onChange={v => update('cluster_col', v)} />
              </Row>
              <Row label="Panel respondent-ID column">
                <ColumnSelect value={design.panel_id_col} columns={colNames}
                  hint={byRole['id']}
                  onChange={v => update('panel_id_col', v)} />
              </Row>
              <Row label="Panel wave column">
                <ColumnSelect value={design.panel_wave_col} columns={colNames}
                  hint={byRole['panel_wave']}
                  onChange={v => update('panel_wave_col', v)} />
              </Row>
            </div>
          )}

          {step === 4 && (
            <div>
              <h3 style={{ fontSize: 13, marginTop: 0 }}>Pre/post pairs & stratification</h3>
              <p style={{ fontSize: 11, opacity: 0.7 }}>
                Pre/post pairs power paired t-tests, Wilcoxon, McNemar, and DiD. Suggestions come from columns you
                paired in Variable Metadata.
              </p>

              {pairedSuggestions.length > 0 ? (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Suggested pairs</div>
                  {pairedSuggestions.map(p => {
                    const checked = !!(design.pre_post_pairs || []).find(x => x.pre === p.pre && x.post === p.post);
                    return (
                      <label key={`${p.pre}__${p.post}`} style={{ display: 'block', padding: '4px 6px', fontSize: 12 }}>
                        <input type="checkbox" checked={checked} onChange={() => togglePair(p)} style={{ marginRight: 6 }} />
                        <strong>{p.pre}</strong> → <strong>{p.post}</strong>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 14 }}>
                  No pairs suggested. You can mark pairs from the Variable Metadata panel.
                </div>
              )}

              <hr style={{ opacity: 0.2, margin: '14px 0' }} />

              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Stratification columns</div>
              <p style={{ fontSize: 11, opacity: 0.7, margin: '0 0 6px' }}>
                Used as geographic / sub-group strata in survey-weighted estimates.
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {(byRole['geographic'] || colNames.slice(0, 24)).map(c => {
                  const on = (design.strata || []).includes(c);
                  return (
                    <button key={c} onClick={() => toggleStrata(c)}
                      style={{
                        fontSize: 11, padding: '3px 8px', borderRadius: 12,
                        background: on ? '#0ea5e9' : 'rgba(255,255,255,0.05)',
                        border: '1px solid var(--border)',
                        color: on ? '#fff' : 'var(--text-dim)',
                        cursor: 'pointer',
                      }}>{c}</button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {statusMsg && (
          <div style={{ padding: '6px 14px', fontSize: 12, background: 'rgba(59,130,246,0.1)', borderTop: '1px solid var(--border)' }}>
            {statusMsg}
          </div>
        )}

        <div style={{ padding: 10, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between' }}>
          <div>
            <button className="btn-small" disabled={step <= 1} onClick={() => setStep(s => s - 1)}>← Back</button>
            <button className="btn-small" disabled={step >= 4} onClick={() => setStep(s => s + 1)} style={{ marginLeft: 6 }}>Next →</button>
          </div>
          <div>
            <button className="btn-small" onClick={onClose} style={{ marginRight: 6 }}>Cancel</button>
            <button className="btn-small btn-primary" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : '💾 Save design'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
      <div style={{ minWidth: 220, fontSize: 12, opacity: 0.85 }}>{label}</div>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}

function ColumnSelect({ value, columns, onChange, hint }: {
  value: string | null | undefined;
  columns: string[];
  onChange: (v: string | null) => void;
  hint?: string[];
}) {
  const grouped = useMemo(() => {
    const hinted = new Set(hint || []);
    return {
      hinted: columns.filter(c => hinted.has(c)),
      rest: columns.filter(c => !hinted.has(c)),
    };
  }, [columns, hint]);
  return (
    <select value={value || ''} onChange={e => onChange(e.target.value || null)} style={{ ...input, width: '100%' }}>
      <option value="">— Select column —</option>
      {grouped.hinted.length > 0 && (
        <optgroup label="From your tagged columns">
          {grouped.hinted.map(c => <option key={c} value={c}>{c}</option>)}
        </optgroup>
      )}
      <optgroup label="All columns">
        {grouped.rest.map(c => <option key={c} value={c}>{c}</option>)}
      </optgroup>
    </select>
  );
}

const input: React.CSSProperties = {
  fontSize: 12, padding: '4px 8px',
  background: 'rgba(0,0,0,0.25)', border: '1px solid var(--border)', borderRadius: 4,
  color: 'inherit',
};
