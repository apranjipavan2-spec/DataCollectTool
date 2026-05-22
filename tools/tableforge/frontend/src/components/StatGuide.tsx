import React, { useMemo, useState } from 'react';
import { GUIDES, GUIDE_INDEX, GUIDE_CATEGORIES, GuideEntry } from './statGuideData';

const SKIP_ALL_KEY = 'tf_guide_skip_all';
const SKIP_ONE_PREFIX = 'tf_guide_skip_';

export function isGuideSkipped(id: string): boolean {
  if (typeof window === 'undefined') return false;
  if (localStorage.getItem(SKIP_ALL_KEY) === '1') return true;
  return localStorage.getItem(SKIP_ONE_PREFIX + id) === '1';
}

export function resetGuideSkips() {
  try {
    localStorage.removeItem(SKIP_ALL_KEY);
    Object.keys(localStorage)
      .filter(k => k.startsWith(SKIP_ONE_PREFIX))
      .forEach(k => localStorage.removeItem(k));
  } catch {}
}

interface Props {
  initialSection?: string;
  onClose: () => void;
  /** If the guide was triggered by a specific tool click, run this when the user dismisses the guide. */
  onContinue?: () => void;
}

export function StatGuide({ initialSection, onClose, onContinue }: Props) {
  const startId = initialSection && GUIDE_INDEX[initialSection] ? initialSection : 'overview';
  const [selectedId, setSelectedId] = useState<string>(startId);
  const [skipThis, setSkipThis] = useState(false);
  const [skipAll, setSkipAll] = useState(false);

  const selected = GUIDE_INDEX[selectedId] || GUIDES[0];

  const groupedTOC = useMemo(() => {
    const map: Record<string, GuideEntry[]> = {};
    for (const g of GUIDES) {
      (map[g.category] ||= []).push(g);
    }
    return map;
  }, []);

  const persistPrefs = () => {
    try {
      if (skipThis) localStorage.setItem(SKIP_ONE_PREFIX + selectedId, '1');
      if (skipAll) localStorage.setItem(SKIP_ALL_KEY, '1');
    } catch {}
  };

  const handleClose = () => {
    persistPrefs();
    onClose();
  };

  const handleContinue = () => {
    persistPrefs();
    onClose();
    onContinue?.();
  };

  const Section = ({ label, items }: { label: string; items: string[] }) => (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--text-dim)', marginBottom: 6 }}>{label}</div>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.55 }}>
        {items.map((it, i) => <li key={i} style={{ marginBottom: 4 }}>{it}</li>)}
      </ul>
    </div>
  );

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()} style={{ maxWidth: 1080, width: '92vw', height: '82vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-header">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 22 }}>📖</span>
            <span>Statistical Tools Guide</span>
            <span style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 400, marginLeft: 6 }}>
              When, why, and how to use each test
            </span>
          </h2>
          <button className="modal-close" onClick={handleClose}>×</button>
        </div>

        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          {/* ── TOC sidebar ── */}
          <div style={{ width: 260, borderRight: '1px solid var(--border)', overflowY: 'auto', padding: '12px 0', flexShrink: 0 }}>
            {GUIDE_CATEGORIES.map(cat => (
              <div key={cat} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-dim)', padding: '0 16px 4px' }}>{cat}</div>
                {(groupedTOC[cat] || []).map(g => (
                  <button key={g.id}
                    onClick={() => { setSelectedId(g.id); setSkipThis(false); }}
                    style={{
                      width: '100%', textAlign: 'left',
                      padding: '6px 16px', background: g.id === selectedId ? 'var(--bg-hover)' : 'transparent',
                      border: 'none', color: g.id === selectedId ? 'var(--text)' : 'var(--text-dim)',
                      borderLeft: g.id === selectedId ? '3px solid var(--primary, #3b82f6)' : '3px solid transparent',
                      cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8,
                    }}>
                    <span style={{ width: 16, textAlign: 'center' }}>{g.icon}</span>
                    <span>{g.title}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>

          {/* ── Content panel ── */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px 28px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <span style={{ fontSize: 32 }}>{selected.icon}</span>
              <div>
                <h3 style={{ margin: 0, fontSize: 20 }}>{selected.title}</h3>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.6 }}>{selected.category}</div>
              </div>
            </div>

            <div style={{ background: 'var(--bg-alt, #1e293b)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', margin: '14px 0', fontSize: 13, lineHeight: 1.55 }}>
              <strong style={{ color: 'var(--primary, #3b82f6)' }}>Use when: </strong>
              {selected.useWhen}
            </div>

            <Section label="Required data" items={selected.requires} />
            <Section label="Step-by-step" items={selected.steps} />
            <Section label="What you get" items={selected.outputs} />
            <Section label="Watch out for" items={selected.pitfalls} />

            <div style={{ marginTop: 14, padding: '10px 14px', background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.35)', borderRadius: 8, fontSize: 13, lineHeight: 1.55 }}>
              <strong style={{ color: '#22c55e' }}>Example: </strong>
              {selected.example}
            </div>
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="modal-footer" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
          <div style={{ display: 'flex', gap: 18, fontSize: 12, color: 'var(--text-dim)' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input type="checkbox" checked={skipThis} onChange={e => setSkipThis(e.target.checked)} />
              Don't show this guide for <strong style={{ color: 'var(--text)' }}>{selected.title}</strong> again
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input type="checkbox" checked={skipAll} onChange={e => setSkipAll(e.target.checked)} />
              Don't show <em>any</em> guide popup again
            </label>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            {!onContinue && <button className="btn-secondary" onClick={handleClose}>Close</button>}
            {onContinue && (
              <>
                <button className="btn-secondary" onClick={handleClose}>Cancel</button>
                <button className="btn-primary" onClick={handleContinue}>Got it — Open Tool</button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
