import React, { useState, useEffect, useRef, useCallback } from 'react';
import { TableConfig, NumberFormat, ConditionalFormat, ColumnInfo, TableResult } from '../types';
import { API_BASE, fgListUserProjects, fgArchiveProject, fgRestoreProject } from '../api';

interface FgContext { fgUrl: string; token: string; programId?: string }

interface Props {
  table: TableConfig | null;
  dataset: boolean;
  result?: TableResult | null;   // last computed result for `table` — used to offer real output columns (incl. Grand Total / Subtotal) as sort keys
  onAction: (action: string) => void;
  onUpdate: (update: Partial<TableConfig>) => void;
  theme: 'dark' | 'light';
  activeTab?: string;
  columns?: ColumnInfo[];
  onColumnTypeChange?: (column: string, newType: string) => void;
  projectFilterCount?: number;   // number of active project-level filters
  onAskAI?: (query: string) => void;  // #15 Talk-to-your-data: NL query → smart-build modal
  fgContext?: FgContext | null;  // FieldGovern account → per-user saved projects
  onLoadProject?: (tables: TableConfig[], annotationsMap?: Record<string, any[]>, extra?: Record<string, any>) => void;
}

type TabKey = 'home' | 'insert' | 'data' | 'statistics' | 'format' | 'view' | 'ai-smart';

// ── Constants ──────────────────────────────────────────────
const BUILT_IN_THEMES = [
  { value: 'default',        label: 'Default Dark',    icon: '🌑' },
  { value: 'corporate_blue', label: 'Corporate Blue',  icon: '🔵' },
  { value: 'minimal_bw',     label: 'Minimalist B&W',  icon: '⬜' },
  { value: 'financial',      label: 'Financial',       icon: '💹' },
  { value: 'government',     label: 'Government',      icon: '🏛' },
  { value: 'teal',           label: 'Modern Teal',     icon: '🟢' },
];

const BORDER_PRESETS = [
  { value: 'full',        label: 'Full Grid',   icon: '▦' },
  { value: 'horizontal',  label: 'Horizontal',  icon: '▤' },
  { value: 'booktabs',    label: 'Booktabs',    icon: '═' },
  { value: 'dashed',      label: 'Dashed',      icon: '┄' },
  { value: 'dotted',      label: 'Dotted',      icon: '┈' },
  { value: 'double_line', label: 'Double',      icon: '║' },
  { value: 'minimal',     label: 'Minimal',     icon: '─' },
  { value: 'none',        label: 'None',        icon: '○' },
];

const DATE_FORMATS = [
  { value: 'YYYY-MM-DD', label: '2024-03-15' },
  { value: 'DD/MM/YYYY', label: '15/03/2024' },
  { value: 'MM/DD/YYYY', label: '03/15/2024' },
  { value: 'D MMM YYYY', label: '15 Mar 2024' },
  { value: 'MMMM YYYY',  label: 'March 2024'  },
  { value: 'MMM YYYY',   label: 'Mar 2024'    },
  { value: 'Q[Q] YYYY',  label: 'Q1 2024'     },
  { value: 'YYYY',       label: '2024'         },
  { value: 'WW-YYYY',    label: 'W12-2024'    },
];

const DEFAULT_NUM_FMT: NumberFormat = {
  style: 'number', decimals: 2, separator: true, prefix: '', suffix: '', currency_symbol: '$',
};

// ── Table Templates ───────────────────────────────────────
export interface TableTemplate {
  id: string;
  label: string;
  icon: string;
  description: string;
  apply: (table: TableConfig) => Partial<TableConfig>;
}

export const TABLE_TEMPLATES: TableTemplate[] = [
  {
    id: 'count_pct_row',
    label: 'Count + % of Row',
    icon: '#',
    description: 'Count with row percentages. Subtotals if cross-tab.',
    apply: (t) => ({
      values: t.values.map(v => ({ ...v, agg: 'count', show_as: 'normal', combo_show_as: 'pct_row', combo_decimals: 2, decimals: 1 })),
      grand_total: true, grand_total_rows: true, grand_total_columns: true,
      subtotals: t.columns.length > 0,
    }),
  },
  {
    id: 'count_pct_col',
    label: 'Count + % of Column',
    icon: '#',
    description: 'Count with column percentages and totals.',
    apply: (t) => ({
      values: t.values.map(v => ({ ...v, agg: 'count', show_as: 'normal', combo_show_as: 'pct_col', combo_decimals: 2, decimals: 1 })),
      grand_total: true, grand_total_rows: true, grand_total_columns: true,
      subtotals: t.columns.length > 0,
    }),
  },
  {
    id: 'count_pct_grand',
    label: 'Count + % of Grand Total',
    icon: '%',
    description: 'Count with percentage of grand total.',
    apply: (t) => ({
      values: t.values.map(v => ({ ...v, agg: 'count', show_as: 'normal', combo_show_as: 'pct_grand', combo_decimals: 2, decimals: 1 })),
      grand_total: true, grand_total_rows: true, grand_total_columns: true,
      subtotals: t.columns.length > 0,
    }),
  },
  {
    id: 'frequency',
    label: 'Frequency Distribution',
    icon: 'F',
    description: 'Simple count table — frequency distribution.',
    apply: () => ({
      values: [{ field: '', agg: 'count', label: 'Count' } as any],
      grand_total: true, grand_total_rows: true,
      subtotals: false,
    }),
  },
  {
    id: 'average_totals',
    label: 'Average + Totals',
    icon: 'x',
    description: 'Average aggregation with subtotals and grand totals.',
    apply: (t) => ({
      values: t.values.map(v => ({ ...v, agg: 'average', show_as: 'normal', combo_show_as: undefined, decimals: 2 })),
      grand_total: true, grand_total_rows: true, grand_total_columns: true,
      subtotals: t.columns.length > 0,
    }),
  },
  {
    id: 'sum_pct_row',
    label: 'Sum + % of Row',
    icon: 'S',
    description: 'Sum aggregation with row percentages.',
    apply: (t) => ({
      values: t.values.map(v => ({ ...v, agg: 'sum', show_as: 'normal', combo_show_as: 'pct_row', combo_decimals: 2, decimals: 2 })),
      grand_total: true, grand_total_rows: true, grand_total_columns: true,
      subtotals: t.columns.length > 0,
    }),
  },
  {
    id: 'count_only',
    label: 'Count Only',
    icon: 'N',
    description: 'Plain count without percentages.',
    apply: () => ({
      values: [{ field: '', agg: 'count', show_as: 'normal', combo_show_as: undefined, label: 'Count' } as any],
      grand_total: true, grand_total_rows: true,
      subtotals: false,
    }),
  },
  {
    id: 'crosstab_full',
    label: 'Cross-tab Full',
    icon: '+',
    description: 'Count + row % + subtotals + grand totals. Full cross-tabulation.',
    apply: (t) => ({
      values: t.values.map(v => ({ ...v, agg: 'count', show_as: 'normal', combo_show_as: 'pct_row', combo_decimals: 2, decimals: 1 })),
      grand_total: true, grand_total_rows: true, grand_total_columns: true,
      subtotals: true, subtotals_position: 'bottom' as const,
    }),
  },
];

function TemplateDropdown({ table, onAction, disabled }: { table: TableConfig | null; onAction: (a: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button className={`ribbon-btn ${open ? 'active' : ''}`} onClick={() => setOpen(!open)} disabled={disabled} title="Apply a table template">
        <span className="ribbon-btn-icon">T</span>
        <span className="ribbon-btn-label">Templates</span>
      </button>
      {open && (
        <div className="import-drop-panel" style={{ width: 280 }}>
          <div className="import-drop-section-title">Table Templates</div>
          {TABLE_TEMPLATES.map(tpl => (
            <button key={tpl.id} className="import-drop-item"
              onClick={() => { onAction('apply_template:' + tpl.id); setOpen(false); }}
              title={tpl.description}>
              <span className="import-drop-icon" style={{ fontWeight: 700, fontSize: 14 }}>{tpl.icon}</span>
              <span className="import-drop-info">
                <span className="import-drop-name">{tpl.label}</span>
                <span className="import-drop-meta">{tpl.description}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Root component ─────────────────────────────────────────
export function RibbonBar({ table, dataset, result, onAction, onUpdate, theme, activeTab: externalTab, columns, onColumnTypeChange, projectFilterCount = 0, onAskAI, fgContext, onLoadProject }: Props) {
  const [internalTab, setInternalTab] = useState<TabKey>('home');
  const activeTab = (externalTab as TabKey) || internalTab;

  return (
    <div className="ribbon-content">
      {activeTab === 'home'       && <HomeRibbon      table={table} dataset={dataset} result={result} onAction={onAction} onUpdate={onUpdate} projectFilterCount={projectFilterCount} onAskAI={onAskAI} fgContext={fgContext} onLoadProject={onLoadProject} />}
      {activeTab === 'insert'     && <InsertRibbon    dataset={dataset} onAction={onAction} />}
      {activeTab === 'data'       && <DataRibbon      dataset={dataset} onAction={onAction} />}
      {activeTab === 'statistics' && <StatisticsRibbon dataset={dataset} onAction={onAction} />}
      {activeTab === 'format'     && <FormatRibbon    table={table} onUpdate={onUpdate} columns={columns} onColumnTypeChange={onColumnTypeChange} />}
      {activeTab === 'view'       && <ViewRibbon      table={table} dataset={dataset} onAction={onAction} onUpdate={onUpdate} theme={theme} />}
      {activeTab === 'ai-smart'   && <AISmartRibbon   table={table} dataset={dataset} onAction={onAction} onUpdate={onUpdate} />}
    </div>
  );
}

// ── Shared helpers ─────────────────────────────────────────
function RGroup({ label, children, style }: { label: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div className="ribbon-group" style={style}>
      <div className="ribbon-group-items">{children}</div>
      <span className="ribbon-group-label">{label}</span>
    </div>
  );
}

function RBtn({ icon, label, onClick, disabled, active }: {
  icon: string; label: string; onClick: () => void; disabled?: boolean; active?: boolean;
}) {
  return (
    <button className={`ribbon-btn ${active ? 'active' : ''}`} onClick={onClick} disabled={disabled} title={label}>
      <span className="ribbon-btn-icon">{icon}</span>
      <span className="ribbon-btn-label">{label}</span>
    </button>
  );
}

// ── Format Ribbon dropdown helpers ─────────────────────────
function FDrop({ children, width = 260 }: { children: React.ReactNode; width?: number }) {
  return (
    <div className="fdrop-panel" style={{ width }}>
      {children}
    </div>
  );
}

function FTitle({ children }: { children: React.ReactNode }) {
  return <div className="fdrop-title">{children}</div>;
}

function FDivider() {
  return <hr className="fdrop-divider" />;
}

function FField({ label, children, row, style }: { label: string; children: React.ReactNode; row?: boolean; style?: React.CSSProperties }) {
  return (
    <div className={`fdrop-field ${row ? 'fdrop-field-row' : ''}`} style={style}>
      <label className="fdrop-label">{label}</label>
      {children}
    </div>
  );
}

function FToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="fdrop-toggle">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

// ── Import dropdown (shows the user's FieldGovern account projects) ─────────
interface FgProjectEntry {
  id: string;
  name: string;
  program_id: string | null;
  data: any;
  updated_at: string;
  archived_at?: string | null;
}

function ImportDropdownBtn({ onAction, fgContext, onLoadProject }: {
  onAction: (action: string) => void;
  fgContext?: FgContext | null;
  onLoadProject?: (tables: TableConfig[], annotationsMap?: Record<string, any[]>, extra?: Record<string, any>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<FgProjectEntry[]>([]);
  const [archived, setArchived] = useState<FgProjectEntry[]>([]);
  const [showArchive, setShowArchive] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [fetched, setFetched] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Close when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const fetchProjects = useCallback(async () => {
    if (fetched || !fgContext) return;
    setFetching(true);
    try {
      const [active, arch] = await Promise.all([
        fgListUserProjects(fgContext.fgUrl, fgContext.token, 'analyzer', false),
        fgListUserProjects(fgContext.fgUrl, fgContext.token, 'analyzer', true),
      ]);
      const clean = (list: any[]) => list.filter(p => p.name && p.name !== '__autosave__');
      setProjects(clean(active));
      setArchived(clean(arch));
      setFetched(true);
    } catch {
      setProjects([]); setArchived([]);
    } finally {
      setFetching(false);
    }
  }, [fetched, fgContext]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !fetched) fetchProjects();
  };

  const loadProject = (p: FgProjectEntry) => {
    if (p.data?.tables && onLoadProject) {
      const extra: Record<string, any> = {};
      if (p.data.comparisonState) extra.comparisonState = p.data.comparisonState;
      if (p.data.projectFilters) extra.projectFilters = p.data.projectFilters;
      if (p.data.columnTypeOverrides) extra.columnTypeOverrides = p.data.columnTypeOverrides;
      onLoadProject(p.data.tables, p.data.annotationsMap, extra);
    } else {
      onAction('projects');  // fall back to the full manager
    }
    setOpen(false);
  };

  const archiveProject = async (p: FgProjectEntry, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!fgContext) return;
    setBusyId(p.id);
    try {
      await fgArchiveProject(fgContext.fgUrl, fgContext.token, p.id);
      setProjects(prev => prev.filter(x => x.id !== p.id));
      setArchived(prev => [{ ...p, archived_at: new Date().toISOString() }, ...prev]);
    } catch { /* no-op */ } finally { setBusyId(null); }
  };

  const restoreProject = async (p: FgProjectEntry, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!fgContext) return;
    setBusyId(p.id);
    try {
      await fgRestoreProject(fgContext.fgUrl, fgContext.token, p.id);
      setArchived(prev => prev.filter(x => x.id !== p.id));
      setProjects(prev => [{ ...p, archived_at: null }, ...prev]);
    } catch { /* no-op */ } finally { setBusyId(null); }
  };

  const fmtDate = (d?: string) =>
    d ? new Date(d).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '';

  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button
        className={`ribbon-btn ${open ? 'active' : ''}`}
        onClick={toggle}
        title="Import — open a previous project or load a data file"
      >
        <span className="ribbon-btn-icon">📂</span>
        <span className="ribbon-btn-label">Import ▾</span>
      </button>

      {open && (
        <div className="import-drop-panel">
          <div className="import-drop-section-title">
            {showArchive ? 'Archived Projects' : 'Recent Projects'}
          </div>

          {!fgContext && (
            <div className="import-drop-empty">Sign in via FieldGovern to see your saved projects.</div>
          )}
          {fgContext && fetching && (
            <div className="import-drop-empty">Loading…</div>
          )}

          {fgContext && !fetching && (() => {
            const list = showArchive ? archived : projects;
            if (list.length === 0) {
              return (
                <div className="import-drop-empty">
                  {showArchive ? 'No archived projects.' : 'No saved projects yet.'}
                </div>
              );
            }
            return (
              <div className="import-drop-list">
                {list.slice(0, 12).map(p => (
                  <button
                    key={p.id}
                    className="import-drop-item"
                    onClick={() => loadProject(p)}
                    title={p.name}
                  >
                    <span className="import-drop-icon">{showArchive ? '🗄' : '🗂'}</span>
                    <span className="import-drop-info">
                      <span className="import-drop-name">{p.name}</span>
                      <span className="import-drop-meta">{fmtDate(p.archived_at || p.updated_at)}</span>
                    </span>
                    {showArchive ? (
                      <span
                        role="button"
                        className="import-drop-rowbtn"
                        title="Restore to active projects"
                        onClick={(e) => restoreProject(p, e)}
                        style={{ opacity: busyId === p.id ? 0.5 : 1 }}
                      >↩ Restore</span>
                    ) : (
                      <span
                        role="button"
                        className="import-drop-rowbtn"
                        title="Archive (never deleted — restorable from the Archive folder)"
                        onClick={(e) => archiveProject(p, e)}
                        style={{ opacity: busyId === p.id ? 0.5 : 1 }}
                      >🗄 Archive</span>
                    )}
                  </button>
                ))}
                {list.length > 12 && (
                  <div className="import-drop-more">+{list.length - 12} more — browse all below</div>
                )}
              </div>
            );
          })()}

          <div className="import-drop-divider" />

          {fgContext && (
            <button
              className="import-drop-action"
              onClick={() => setShowArchive(s => !s)}
            >
              <span>🗄</span> {showArchive ? `← Back to Recent` : `Archive folder${archived.length ? ` (${archived.length})` : ''}`}
            </button>
          )}
          <button
            className="import-drop-action"
            onClick={() => { onAction('projects'); setOpen(false); }}
          >
            <span>🗂</span> Browse All Projects…
          </button>
          <button
            className="import-drop-action"
            onClick={() => { onAction('import_file'); setOpen(false); }}
          >
            <span>📁</span> Open Data File (Excel / CSV)…
          </button>
        </div>
      )}
    </div>
  );
}

// ── HOME ───────────────────────────────────────────────────
function HomeRibbon({ table, dataset, result, onAction, onUpdate, projectFilterCount = 0, onAskAI, fgContext, onLoadProject }: {
  table: TableConfig | null; dataset: boolean;
  result?: TableResult | null;
  onAction: (action: string) => void; onUpdate: (update: Partial<TableConfig>) => void;
  projectFilterCount?: number;
  onAskAI?: (query: string) => void;
  fgContext?: FgContext | null;
  onLoadProject?: (tables: TableConfig[], annotationsMap?: Record<string, any[]>, extra?: Record<string, any>) => void;
}) {
  const [openDrop, setOpenDrop] = useState<string | null>(null);
  const [askQuery, setAskQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const t = table;
  const dis = !t;

  const submitAsk = () => {
    const q = askQuery.trim();
    if (!q || !onAskAI) return;
    onAskAI(q);
    setAskQuery('');
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpenDrop(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const tog = (name: string) => setOpenDrop(o => o === name ? null : name);

  return (
    <div ref={containerRef} style={{ display: 'contents' }}>
      <RGroup label="Ask AI">
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <input
            type="text"
            value={askQuery}
            onChange={e => setAskQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submitAsk(); }}
            placeholder="Ask: e.g., avg income by district…"
            disabled={!dataset}
            className="ribbon-ask-input"
            style={{
              fontSize: 12, padding: '6px 10px', minWidth: 220, height: 30,
              background: 'rgba(15,23,42,0.6)', color: 'inherit',
              border: '1px solid rgba(168,85,247,0.45)', borderRadius: 4,
            }}
            title="Talk to your data — AI designs a table from your question"
          />
          <button className="ribbon-btn" onClick={submitAsk} disabled={!dataset || !askQuery.trim()} title="Build table from question">
            <span className="ribbon-btn-icon">💬</span>
            <span className="ribbon-btn-label">Ask</span>
          </button>
        </div>
      </RGroup>
      <RGroup label="File">
        <ImportDropdownBtn onAction={onAction} fgContext={fgContext} onLoadProject={onLoadProject} />
        <RBtn icon="💾" label="Save"    onClick={() => onAction('save')}   disabled={!dataset} />
        <RBtn icon="↓"  label="Export"  onClick={() => onAction('export')} disabled={!dataset} />
        <RBtn icon="🔄" label="Reload"  onClick={() => onAction('reload_data')} disabled={!dataset} />
      </RGroup>
      <RGroup label="Edit">
        <RBtn icon="↩" label="Undo"      onClick={() => onAction('undo')}      disabled={!dataset} />
        <RBtn icon="↪" label="Redo"      onClick={() => onAction('redo')}      disabled={!dataset} />
        <RBtn icon="⧉" label="Duplicate" onClick={() => onAction('duplicate')} disabled={!dataset} />
      </RGroup>
      <RGroup label="Table">
        <TemplateDropdown table={table} onAction={onAction} disabled={!dataset} />
        <RBtn icon="⇄" label="Transpose" onClick={() => onAction('transpose')} disabled={!dataset} />
      </RGroup>
      <RGroup label="Totals & Subtotals" style={{ position: 'relative' }}>
        <button className={`ribbon-btn fdrop-btn ${openDrop === 'totals' ? 'active' : ''}`}
          onClick={() => tog('totals')} disabled={dis}>
          <span className="ribbon-btn-icon">Σ</span>
          <span className="ribbon-btn-label">Totals ▾</span>
        </button>
        {openDrop === 'totals' && t && (
          <FDrop width={270}>
            <FTitle>Totals & Subtotals</FTitle>
            <div className="fdrop-toggle-stack">
              <FToggle label="Grand Totals (All)"       checked={t.grand_total}    onChange={v => onUpdate({ grand_total: v, grand_total_rows: v, grand_total_columns: v })} />
              <FToggle label="Row Total (bottom row)"    checked={t.grand_total_rows ?? t.grand_total}  onChange={v => onUpdate({ grand_total_rows: v, grand_total: v && (t.grand_total_columns ?? t.grand_total) })} />
              <FToggle label="Column Total (last column)" checked={t.grand_total_columns ?? t.grand_total} onChange={v => onUpdate({ grand_total_columns: v, grand_total: v && (t.grand_total_rows ?? t.grand_total) })} />
              <FToggle label="Combined Grand Total" checked={!!t.grand_total_combined} onChange={v => onUpdate({ grand_total_combined: v })} />
              <FToggle label="Subtotals (hierarchical)" checked={t.subtotals}      onChange={v => onUpdate({ subtotals: v })} />
            </div>
            <FField label="Grand Total Calculation" style={{ marginTop: 8 }}>
              <select value={t.grand_total_agg || 'auto'} className="fdrop-select"
                onChange={e => onUpdate({ grand_total_agg: e.target.value as any })}>
                <option value="auto">Auto (average if all values are averages)</option>
                <option value="sum">Total (sum the values)</option>
                <option value="average">Average (mean of the values)</option>
              </select>
            </FField>
            {t.subtotals && (
              <>
              <FField label="Subtotal Position" style={{ marginTop: 8 }}>
                <select value={t.subtotals_position || 'bottom'} className="fdrop-select"
                  onChange={e => onUpdate({ subtotals_position: e.target.value as any })}>
                  <option value="bottom">Bottom of Group</option>
                  <option value="top">Top of Group</option>
                </select>
              </FField>
              <FField label="Percentage Base" style={{ marginTop: 8 }}>
                <select value={t.subtotal_pct_base || 'grand_total'} className="fdrop-select"
                  onChange={e => onUpdate({ subtotal_pct_base: e.target.value as any })}>
                  <option value="grand_total">100% = Grand Total (full row)</option>
                  <option value="subtotal">100% = Each Subtotal Group</option>
                </select>
              </FField>
              <FToggle label="Hide subtotal rows/columns" checked={t.hide_subgroup ?? false}
                onChange={v => onUpdate({ hide_subgroup: v })} />
              <div style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.4, padding: '4px 2px' }}>
                {(t.subtotal_pct_base || 'grand_total') === 'subtotal'
                  ? 'Each subtotal group sums to 100%. Use when comparing within groups.'
                  : 'Full row sums to 100%. Subtotals show their share of the grand total.'}
              </div>
              </>
            )}
            <FDivider />
            <FField label="Missing Data Display">
              <select value={t.missing_data || ''} className="fdrop-select"
                onChange={e => onUpdate({ missing_data: e.target.value })}>
                <option value="">Leave Blank</option>
                <option value="0">0</option>
                <option value="N/A">N/A</option>
                <option value="–">– (dash)</option>
                <option value="n/a">n/a</option>
                <option value=".">.</option>
              </select>
            </FField>
            <FDivider />
            <FTitle>Multi-Column Sort</FTitle>
            {(t.multi_sort || []).map((sk, i) => (
              <div key={i} className="fdrop-sort-row">
                <select value={sk.field} className="fdrop-select" style={{ flex: 2 }}
                  onChange={e => {
                    const arr = [...(t.multi_sort || [])];
                    arr[i] = { ...arr[i], field: e.target.value };
                    onUpdate({ multi_sort: arr });
                  }}>
                  <option value="">-- field --</option>
                  {t.rows.map(r => <option key={r} value={r}>{r} (row label)</option>)}
                  {result?.headers && result.headers.length > 0
                    ? result.headers
                        .filter(h => !t.rows.includes(h))
                        .map(h => <option key={h} value={h}>{h}</option>)
                    : t.values.map(v => <option key={v.field} value={v.label || v.field}>{v.label || v.field}</option>)}
                </select>
                <select value={sk.order} className="fdrop-select" style={{ flex: 1 }}
                  onChange={e => {
                    const arr = [...(t.multi_sort || [])];
                    arr[i] = { ...arr[i], order: e.target.value as any };
                    onUpdate({ multi_sort: arr });
                  }}>
                  <option value="asc">Asc ▲</option>
                  <option value="desc">Desc ▼</option>
                </select>
                <button className="fdrop-reset-btn"
                  onClick={() => onUpdate({ multi_sort: (t.multi_sort || []).filter((_, j) => j !== i) })}>✕</button>
              </div>
            ))}
            <button className="fdrop-ghost-btn" style={{ marginTop: 4 }}
              onClick={() => onUpdate({ multi_sort: [...(t.multi_sort || []), { field: '', order: 'asc' as const }] })}>
              + Add Sort Key
            </button>
          </FDrop>
        )}
      </RGroup>
      <RGroup label="Sort & Filter">
        <RBtn icon="↕" label="Sort A-Z" onClick={() => { if (table?.rows[0]) onUpdate({ sort_by: table.rows[0], sort_order: 'asc', multi_sort: [] }); }}  disabled={!dataset || !table?.rows[0]} />
        <RBtn icon="↕" label="Sort Z-A" onClick={() => { if (table?.rows[0]) onUpdate({ sort_by: table.rows[0], sort_order: 'desc', multi_sort: [] }); }} disabled={!dataset || !table?.rows[0]} />
        <RBtn icon="🔍" label="Filters" onClick={() => onAction('filter_panel')} disabled={!dataset} />
        <div style={{ position: 'relative', display: 'inline-flex' }}>
          <button
            className={`ribbon-btn ${projectFilterCount > 0 ? 'active' : ''}`}
            onClick={() => onAction('project_filter')}
            disabled={!dataset}
            title={projectFilterCount > 0
              ? `Project Filters: ${projectFilterCount} active — applies to all tables`
              : 'Project Filters — apply a filter across all tables at once'}
          >
            <span className="ribbon-btn-icon">🌐</span>
            <span className="ribbon-btn-label">Project Filter</span>
          </button>
          {projectFilterCount > 0 && (
            <span style={{
              position: 'absolute', top: 2, right: 2,
              background: 'var(--primary, #3b82f6)', color: '#fff',
              fontSize: 9, fontWeight: 700, lineHeight: 1,
              padding: '2px 4px', borderRadius: 8, pointerEvents: 'none',
            }}>
              {projectFilterCount}
            </span>
          )}
        </div>
        <RBtn icon="↻" label="Refresh Stats" onClick={() => onAction('refresh_stat_tables')} disabled={!dataset} />
      </RGroup>
      <RGroup label="Number">
        <select className="ribbon-select" disabled={!dataset}
          value={table?.values?.[0]?.decimals ?? 2}
          onChange={e => {
            if (!table?.values?.length) return;
            onUpdate({ values: table.values.map(v => ({ ...v, decimals: Number(e.target.value) })) });
          }}>
          {[0,1,2,3,4,6].map(n => <option key={n} value={n}>{n} dec</option>)}
        </select>
      </RGroup>
      <RGroup label="Empty Cells">
        <select className="ribbon-select" disabled={!dataset}
          value={table?.missing_data ?? ''}
          onChange={e => onUpdate({ missing_data: e.target.value })}>
          <option value="">Blank</option>
          <option value="0">0</option>
          <option value="-">-</option>
          <option value="—">—</option>
          <option value="n/a">n/a</option>
          <option value="N/A">N/A</option>
          <option value=".">.</option>
        </select>
      </RGroup>
    </div>
  );
}

// ── INSERT ─────────────────────────────────────────────────
function InsertRibbon({ dataset, onAction }: { dataset: boolean; onAction: (action: string) => void }) {
  return (
    <>
      <RGroup label="Computed">
        <RBtn icon="➕" label="Create Column" onClick={() => onAction('column-creator')} disabled={!dataset} />
        <RBtn icon="𝑓" label="Metric" onClick={() => onAction('metrics')} disabled={!dataset} />
        <RBtn icon="⊕" label="Bin"    onClick={() => onAction('bins')}    disabled={!dataset} />
      </RGroup>
      <RGroup label="Manual">
        <RBtn icon="✎" label="Manual Column" onClick={() => onAction('manual_column')} disabled={!dataset} />
        <RBtn icon="🔗" label="Merge Tables"  onClick={() => onAction('merge_tables')}  disabled={!dataset} />
      </RGroup>
      <RGroup label="Visual">
        <RBtn icon="📊" label="Chart"     onClick={() => onAction('charts')}    disabled={!dataset} />
        <RBtn icon="📈" label="Dashboard" onClick={() => onAction('dashboard')} disabled={!dataset} />
      </RGroup>
      <RGroup label="Reports">
        <RBtn icon="📋" label="Report"  onClick={() => onAction('report')}       disabled={!dataset} />
        <RBtn icon="⊞" label="Compare" onClick={() => onAction('table_compare')} disabled={!dataset} />
        <RBtn icon="↔" label="Period"   onClick={() => onAction('comparison')}   disabled={!dataset} />
      </RGroup>
      <RGroup label="Annotations">
        <RBtn icon="📝" label="Footnote" onClick={() => onAction('add_footnote')}     disabled={!dataset} />
        <RBtn icon="📌" label="Note"     onClick={() => onAction('add_annotation')}   disabled={!dataset} />
        <RBtn icon="🏷" label="Header"   onClick={() => onAction('add_header_note')}  disabled={!dataset} />
      </RGroup>
    </>
  );
}

// ── DATA ───────────────────────────────────────────────────
function DataRibbon({ dataset, onAction }: { dataset: boolean; onAction: (action: string) => void }) {
  return (
    <>
      <RGroup label="Source">
        <ImportDropdownBtn onAction={onAction} />
        <RBtn icon="🔄" label="Refresh" onClick={() => onAction('refresh')} disabled={!dataset} />
        <RBtn icon="📚" label="Library" onClick={() => onAction('metric_library')} />
      </RGroup>
      <RGroup label="Quality & Clean">
        <RBtn icon="🔍" label="Quality & Clean" onClick={() => onAction('quality')} disabled={!dataset} />
        <RBtn icon="🧹" label="Open in Cleaner" onClick={() => onAction('clean_open')} disabled={!dataset} />
        <RBtn icon="🚨" label="Anomalies" onClick={() => onAction('anomalies')} disabled={!dataset} />
        <RBtn icon="📝" label="Audit"   onClick={() => onAction('audit')}   disabled={!dataset} />
      </RGroup>
      <RGroup label="Text Clean">
        <RBtn icon="✂" label="Trim All" onClick={() => onAction('clean_trim')} disabled={!dataset} />
        <RBtn icon="AA" label="UPPER"    onClick={() => onAction('clean_upper')} disabled={!dataset} />
        <RBtn icon="aa" label="lower"    onClick={() => onAction('clean_lower')} disabled={!dataset} />
        <RBtn icon="Aa" label="Proper"   onClick={() => onAction('clean_proper')} disabled={!dataset} />
      </RGroup>
      <RGroup label="Manage">
        <RBtn icon="🗂" label="Projects" onClick={() => onAction('projects')} />
      </RGroup>
    </>
  );
}

// ── STATISTICS ─────────────────────────────────────────────
type StatMenuItem = { icon: string; label: string; action: string; alwaysEnabled?: boolean };

const STAT_MENUS: { key: string; icon: string; label: string; items: StatMenuItem[] }[] = [
  { key: 'survey_design', icon: '🧭', label: 'Survey Design', items: [
    { icon: '🏷️', label: 'Variables',         action: 'variable_metadata' },
    { icon: '🧭', label: 'Study Design',      action: 'study_design' },
    { icon: '💡', label: 'Suggest Crosstabs', action: 'survey_insights' },
    { icon: '🎮', label: 'Play Mode',         action: 'play_mode' },
  ]},
  { key: 'data_quality', icon: '🩺', label: 'Data Quality', items: [
    { icon: '🩺', label: 'SDQ Checks', action: 'survey_quality' },
  ]},
  { key: 'survey_analyses', icon: '📊', label: 'Survey Analyses', items: [
    { icon: '⚡',  label: 'Run Full',    action: 'auto_analyze' },
    { icon: '📊', label: 'Likert',      action: 'likert' },
    { icon: '☑️', label: 'Multi-Resp',  action: 'multi_response' },
    { icon: '👁️', label: 'Observer',    action: 'observer' },
    { icon: '💬', label: 'Verbatims',   action: 'verbatim' },
  ]},
  { key: 'impact', icon: '🎯', label: 'Impact / Driver', items: [
    { icon: '⚖️', label: 'Balance',  action: 'balance' },
    { icon: '🎯', label: 'Drivers',  action: 'driver' },
    { icon: '🔮', label: 'Clusters', action: 'cluster' },
    { icon: '🗺', label: 'Geo',      action: 'geo_summary' },
  ]},
  { key: 'descriptive', icon: '📋', label: 'Descriptive', items: [
    { icon: '📋', label: 'Summary',   action: 'stat_descriptive' },
    { icon: '📊', label: 'Frequency', action: 'stat_frequency' },
  ]},
  { key: 'relationships', icon: '📐', label: 'Relationships', items: [
    { icon: '📐', label: 'Correlation', action: 'stat_correlation' },
    { icon: '📈', label: 'Regression',  action: 'stat_regression' },
    { icon: 'V',  label: "Cramér's V",  action: 'stat_cramers_matrix' },
  ]},
  { key: 'hypothesis', icon: '𝑡', label: 'Hypothesis Tests', items: [
    { icon: '𝑡',  label: 't-Test',    action: 'stat_ttest' },
    { icon: 'F',  label: 'ANOVA',     action: 'stat_anova' },
    { icon: 'χ²', label: 'Cross-tab', action: 'stat_crosstab' },
  ]},
  { key: 'paired', icon: '↔', label: 'Paired / Pre-Post', items: [
    { icon: '↔', label: 'Paired t', action: 'stat_paired_ttest' },
    { icon: 'W', label: 'Wilcoxon', action: 'stat_wilcoxon' },
    { icon: '±', label: 'McNemar',  action: 'stat_mcnemar' },
  ]},
  { key: 'nonparam', icon: 'K', label: 'Non-parametric', items: [
    { icon: 'K',  label: 'Kruskal',  action: 'stat_kruskal' },
    { icon: 'Fr', label: 'Friedman', action: 'stat_friedman' },
    { icon: 'ρ',  label: 'Spearman', action: 'stat_spearman' },
    { icon: 'τ',  label: 'Kendall',  action: 'stat_kendall' },
  ]},
  { key: 'models', icon: '📐', label: 'Models', items: [
    { icon: '📐', label: 'Multi-Reg',   action: 'stat_multiple_regression' },
    { icon: 'OR', label: 'Logistic',    action: 'stat_logistic_regression' },
    { icon: 'MN', label: 'Multinomial', action: 'stat_multinomial_logistic' },
    { icon: '⇄',  label: 'Post-hoc',    action: 'stat_posthoc' },
    { icon: 'α',  label: 'Reliability', action: 'stat_reliability' },
  ]},
  { key: 'distribution', icon: '📉', label: 'Distribution', items: [
    { icon: '📉', label: 'Normality', action: 'stat_normality' },
    { icon: '⚠',  label: 'Outliers',  action: 'stat_outlier' },
  ]},
  { key: 'advanced', icon: '⚡', label: 'Advanced Analysis', items: [
    { icon: '📐', label: 'DiD',        action: 'causal_did' },
    { icon: '≈',  label: 'PSM',        action: 'causal_psm' },
    { icon: '🏘', label: 'Mixed LM',   action: 'causal_mixed_lm' },
    { icon: '⚡', label: 'Power',      action: 'power_planner', alwaysEnabled: true },
    { icon: '📖', label: 'Codebook',   action: 'export_codebook' },
    { icon: '✨', label: 'AI Summary', action: 'exec_summary' },
  ]},
];

function StatisticsRibbon({ dataset, onAction }: { dataset: boolean; onAction: (action: string) => void }) {
  const [openDrop, setOpenDrop] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpenDrop(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const tog = (name: string) => setOpenDrop(o => o === name ? null : name);
  const pick = (action: string) => { onAction(action); setOpenDrop(null); };

  return (
    <div ref={containerRef} style={{ display: 'contents' }}>
      <RGroup label="Help">
        <RBtn icon="📖" label="Guide" onClick={() => onAction('stat_guide')} />
      </RGroup>
      {STAT_MENUS.map(menu => {
        const groupDisabled = !dataset && !menu.items.some(i => i.alwaysEnabled);
        const isOpen = openDrop === menu.key;
        return (
          <RGroup key={menu.key} label={menu.label} style={{ position: 'relative' }}>
            <button
              className={`ribbon-btn fdrop-btn ${isOpen ? 'active' : ''}`}
              onClick={() => tog(menu.key)}
              disabled={groupDisabled}
              title={menu.label}
            >
              <span className="ribbon-btn-icon">{menu.icon}</span>
              <span className="ribbon-btn-label">{menu.label} ▾</span>
            </button>
            {isOpen && (
              <div className="fdrop-panel rmenu-panel" style={{ width: 220 }}>
                {menu.items.map(it => {
                  const itemDisabled = !dataset && !it.alwaysEnabled;
                  return (
                    <button
                      key={it.action}
                      className="rmenu-item"
                      onClick={() => pick(it.action)}
                      disabled={itemDisabled}
                      title={it.label}
                    >
                      <span className="rmenu-item-icon">{it.icon}</span>
                      <span className="rmenu-item-label">{it.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </RGroup>
        );
      })}
    </div>
  );
}

// ── FORMAT RIBBON ──────────────────────────────────────────
function FormatRibbon({ table, onUpdate, columns = [], onColumnTypeChange }: {
  table: TableConfig | null;
  onUpdate: (update: Partial<TableConfig>) => void;
  columns?: ColumnInfo[];
  onColumnTypeChange?: (column: string, newType: string) => void;
}) {
  const [openDrop, setOpenDrop] = useState<string | null>(null);
  const [customThemeName, setCustomThemeName] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpenDrop(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const tog = (name: string) => setOpenDrop(o => o === name ? null : name);
  const t = table;
  const dis = !t;

  // Custom themes from localStorage
  const savedThemes: { value: string; label: string }[] = (() => {
    try { return JSON.parse(localStorage.getItem('tableforge_custom_themes') || '[]'); } catch { return []; }
  })();
  const THEMES = [...BUILT_IN_THEMES, ...savedThemes.map(s => ({ ...s, icon: '🎨' }))];

  const saveCustomTheme = () => {
    if (!customThemeName.trim() || !t) return;
    const key = `custom_${customThemeName.trim().toLowerCase().replace(/\s+/g, '_')}`;
    const existing = savedThemes.filter(s => s.value !== key);
    localStorage.setItem('tableforge_custom_themes', JSON.stringify([...existing, { value: key, label: customThemeName.trim() }]));
    localStorage.setItem(`tableforge_theme_${key}`, JSON.stringify({
      zebra: t.zebra, zebra_color: t.zebra_color, border_preset: t.border_preset,
    }));
    onUpdate({ theme: key });
    setCustomThemeName('');
  };

  const updateNumFmt = (field: string, upd: Partial<NumberFormat>) => {
    if (!t) return;
    onUpdate({
      values: t.values.map(v => v.field === field
        ? { ...v, number_format: { ...DEFAULT_NUM_FMT, ...(v.number_format || {}), ...upd } }
        : v),
    });
  };

  const updateHeaderRename = (original: string, newName: string) => {
    if (!t) return;
    const renames = { ...(t.header_renames || {}) };
    if (newName && newName !== original) renames[original] = newName;
    else delete renames[original];
    onUpdate({ header_renames: renames });
  };

  const updateDateFmt = (field: string, format: string) => {
    if (!t) return;
    const existing = t.date_formats || [];
    const idx = existing.findIndex(df => df.field === field);
    if (format === '') onUpdate({ date_formats: existing.filter(df => df.field !== field) });
    else if (idx >= 0) {
      const arr = [...existing]; arr[idx] = { field, format }; onUpdate({ date_formats: arr });
    } else onUpdate({ date_formats: [...existing, { field, format }] });
  };

  const allFields = t ? [...t.rows, ...t.columns, ...t.values.map(v => v.label || v.field)] : [];

  return (
    <div ref={containerRef} className="format-ribbon-wrap">

      {/* ── 1. THEME ─────────────────────────────────── */}
      <RGroup label="Theme" style={{ position: 'relative' }}>
        <button className={`ribbon-btn fdrop-btn ${openDrop === 'theme' ? 'active' : ''}`}
          onClick={() => tog('theme')} disabled={dis}>
          <span className="ribbon-btn-icon">🎨</span>
          <span className="ribbon-btn-label">Theme ▾</span>
        </button>
        {openDrop === 'theme' && (
          <FDrop width={280}>
            <FTitle>Table Theme</FTitle>
            <div className="fdrop-theme-grid">
              {THEMES.map(th => (
                <button key={th.value}
                  className={`fdrop-theme-btn ${(t?.theme || 'default') === th.value ? 'active' : ''}`}
                  onClick={() => onUpdate({
                    theme: th.value,
                    header_bg_color: '', header_text_color: '',
                    row_bg_color: '', bg_color: '', total_bg_color: '',
                  })}>
                  <span className="fdrop-theme-icon">{th.icon}</span>
                  <span>{th.label}</span>
                </button>
              ))}
            </div>
            <FDivider />
            <div className="fdrop-row" style={{ gap: 6 }}>
              <input type="text" value={customThemeName} onChange={e => setCustomThemeName(e.target.value)}
                placeholder="Save current as theme…" className="fdrop-input" style={{ flex: 1 }} />
              <button className="fdrop-btn-action" onClick={saveCustomTheme} disabled={!customThemeName.trim()}>Save</button>
            </div>
          </FDrop>
        )}
      </RGroup>

      {/* ── 2. COLORS ────────────────────────────────── */}
      <RGroup label="Colors" style={{ position: 'relative' }}>
        <button className={`ribbon-btn fdrop-btn ${openDrop === 'colors' ? 'active' : ''}`}
          onClick={() => tog('colors')} disabled={dis}>
          <span className="ribbon-btn-icon">🖌</span>
          <span className="ribbon-btn-label">Colors ▾</span>
        </button>
        {openDrop === 'colors' && (
          <FDrop width={260}>
            <FTitle>Section Background Colors</FTitle>
            {([
              { label: 'Header Row',   key: 'header_bg_color',   def: '#1a1e2e' },
              { label: 'Row Labels',   key: 'row_bg_color',      def: '#0d1117' },
              { label: 'Values Area',  key: 'bg_color',          def: '#0d1117' },
              { label: 'Grand Total',  key: 'total_bg_color',    def: '#1a2030' },
              { label: 'Header Text',  key: 'header_text_color', def: '#ffffff' },
            ] as { label: string; key: keyof TableConfig; def: string }[]).map(({ label, key, def }) => (
              <div key={key as string} className="fdrop-color-row">
                <span className="fdrop-color-label">{label}</span>
                <input type="color"
                  value={(t as any)?.[key] || def}
                  onChange={e => onUpdate({ [key]: e.target.value } as any)}
                  className="fdrop-color-input" />
                <button className="fdrop-reset-btn" onClick={() => onUpdate({ [key]: '' } as any)} title="Reset">↺</button>
              </div>
            ))}
            <FDivider />
            <FTitle>Row Shading</FTitle>
            <FToggle label="Alternating Zebra Rows"
              checked={t?.zebra ?? false} onChange={v => onUpdate({ zebra: v })} />
            {t?.zebra && (
              <div className="fdrop-color-row" style={{ marginTop: 8 }}>
                <span className="fdrop-color-label">Stripe Color</span>
                <input type="color" value={t.zebra_color || '#f0f4ff'}
                  onChange={e => onUpdate({ zebra_color: e.target.value })} className="fdrop-color-input" />
              </div>
            )}
          </FDrop>
        )}
      </RGroup>

      {/* ── 3. BORDERS ───────────────────────────────── */}
      <RGroup label="Borders" style={{ position: 'relative' }}>
        <button className={`ribbon-btn fdrop-btn ${openDrop === 'borders' ? 'active' : ''}`}
          onClick={() => tog('borders')} disabled={dis}>
          <span className="ribbon-btn-icon">▦</span>
          <span className="ribbon-btn-label">Borders ▾</span>
        </button>
        {openDrop === 'borders' && (
          <FDrop width={240}>
            <FTitle>Border Style</FTitle>
            <div className="fdrop-border-grid">
              {BORDER_PRESETS.map(b => (
                <button key={b.value}
                  className={`fdrop-border-btn ${(t?.border_preset || 'full') === b.value ? 'active' : ''}`}
                  onClick={() => onUpdate({ border_preset: b.value })}>
                  <span className="fdrop-border-icon">{b.icon}</span>
                  <span>{b.label}</span>
                </button>
              ))}
            </div>
          </FDrop>
        )}
      </RGroup>

      {/* ── 4. FONT / TITLE ──────────────────────────── */}
      <RGroup label="Title" style={{ position: 'relative' }}>
        <button className={`ribbon-btn fdrop-btn ${openDrop === 'title' ? 'active' : ''}`}
          onClick={() => tog('title')} disabled={dis}>
          <span className="ribbon-btn-icon">T</span>
          <span className="ribbon-btn-label">Title ▾</span>
        </button>
        {openDrop === 'title' && t && (
          <FDrop width={290}>
            <FTitle>Table Title</FTitle>
            <FField label="Title">
              <input type="text" value={t.title || ''} className="fdrop-input"
                onChange={e => onUpdate({ title: e.target.value })} placeholder="Table title…" />
            </FField>
            <div className="fdrop-token-row">
              {['{filename}', '{date}', '{sheet_name}'].map(tok => (
                <button key={tok} className="fdrop-token"
                  onClick={() => onUpdate({ title: (t.title || '') + tok })}>+{tok}</button>
              ))}
            </div>
            <FField label="Subtitle">
              <input type="text" value={t.subtitle || ''} className="fdrop-input"
                onChange={e => onUpdate({ subtitle: e.target.value })} placeholder="Source, date range…" />
            </FField>
            <FField label="Tab Name">
              <input type="text" value={t.name || ''} className="fdrop-input"
                onChange={e => onUpdate({ name: e.target.value })} />
            </FField>
            <FDivider />
            <FTitle>Title Style</FTitle>
            <div className="fdrop-row" style={{ gap: 8 }}>
              <FField label="Size">
                <input type="number" min={10} max={36} value={t.title_size || 18} className="fdrop-input"
                  style={{ width: 60 }} onChange={e => onUpdate({ title_size: parseInt(e.target.value) })} />
              </FField>
              <FField label="Align">
                <select value={t.title_align || 'left'} className="fdrop-select"
                  onChange={e => onUpdate({ title_align: e.target.value })}>
                  <option value="left">Left</option>
                  <option value="center">Center</option>
                  <option value="right">Right</option>
                </select>
              </FField>
            </div>
            <div className="fdrop-row" style={{ gap: 12, marginTop: 8, alignItems: 'center' }}>
              <FToggle label="Bold"   checked={t.title_bold ?? true}  onChange={v => onUpdate({ title_bold: v })} />
              <FToggle label="Italic" checked={t.title_italic ?? false} onChange={v => onUpdate({ title_italic: v })} />
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Color</span>
                <input type="color" value={t.title_color || '#ffffff'} className="fdrop-color-input"
                  onChange={e => onUpdate({ title_color: e.target.value })} />
              </div>
            </div>
            <FDivider />
            <FTitle>Auto Numbering</FTitle>
            <FToggle label="Enable Auto Table Numbering"
              checked={t.auto_number ?? false} onChange={v => onUpdate({ auto_number: v })} />
            {t.auto_number && (
              <div className="fdrop-row" style={{ gap: 8, marginTop: 8 }}>
                <FField label="Prefix">
                  <input type="text" value={t.table_number_prefix || 'Table'} className="fdrop-input"
                    onChange={e => onUpdate({ table_number_prefix: e.target.value })} />
                </FField>
                <FField label="Number">
                  <input type="text" value={t.table_number || ''} className="fdrop-input" placeholder="1, 1.1, A-1"
                    onChange={e => onUpdate({ table_number: e.target.value })} />
                </FField>
              </div>
            )}
            <FDivider />
            <FField label="Footnote / Source">
              <textarea rows={2} value={t.footnote || ''} className="fdrop-input"
                style={{ resize: 'vertical', minHeight: 48 }}
                onChange={e => onUpdate({ footnote: e.target.value })}
                placeholder="Source: Dataset, 2024" />
            </FField>
          </FDrop>
        )}
      </RGroup>

      {/* ── 5. NUMBERS ───────────────────────────────── */}
      <RGroup label="Numbers" style={{ position: 'relative' }}>
        <button className={`ribbon-btn fdrop-btn ${openDrop === 'numbers' ? 'active' : ''}`}
          onClick={() => tog('numbers')} disabled={dis}>
          <span className="ribbon-btn-icon">#</span>
          <span className="ribbon-btn-label">Numbers ▾</span>
        </button>
        {openDrop === 'numbers' && t && (
          <FDrop width={300}>
            <FTitle>Number Formats — per Value Field</FTitle>
            {t.values.length === 0
              ? <p className="fdrop-hint">Add value fields first</p>
              : t.values.map(v => {
                  const fmt = { ...DEFAULT_NUM_FMT, ...(v.number_format || {}) };
                  return (
                    <div key={v.field} className="fdrop-num-block">
                      <div className="fdrop-num-name">{v.label || v.field}</div>
                      <div className="fdrop-row" style={{ gap: 8 }}>
                        <FField label="Style">
                          <select value={fmt.style} className="fdrop-select"
                            onChange={e => updateNumFmt(v.field, { style: e.target.value as any })}>
                            <option value="number">Number</option>
                            <option value="currency">Currency</option>
                            <option value="percent">Percent</option>
                          </select>
                        </FField>
                        <FField label="Decimals">
                          <input type="number" min={0} max={6} value={fmt.decimals} className="fdrop-input"
                            style={{ width: 54 }}
                            onChange={e => updateNumFmt(v.field, { decimals: parseInt(e.target.value) || 0 })} />
                        </FField>
                      </div>
                      <div className="fdrop-row" style={{ gap: 12, flexWrap: 'wrap' }}>
                        <FToggle label="1,000 Sep" checked={fmt.separator ?? true}
                          onChange={s => updateNumFmt(v.field, { separator: s })} />
                        {fmt.style === 'currency' && (
                          <FField label="Symbol">
                            <input type="text" value={fmt.currency_symbol || '$'} className="fdrop-input"
                              style={{ width: 40 }}
                              onChange={e => updateNumFmt(v.field, { currency_symbol: e.target.value })} />
                          </FField>
                        )}
                      </div>
                      <div className="fdrop-row" style={{ gap: 8 }}>
                        <FField label="Prefix">
                          <input type="text" value={fmt.prefix || ''} className="fdrop-input"
                            onChange={e => updateNumFmt(v.field, { prefix: e.target.value })} />
                        </FField>
                        <FField label="Suffix">
                          <input type="text" value={fmt.suffix || ''} className="fdrop-input" placeholder="pts"
                            onChange={e => updateNumFmt(v.field, { suffix: e.target.value })} />
                        </FField>
                      </div>
                    </div>
                  );
                })
            }
          </FDrop>
        )}
      </RGroup>

      {/* ── 6. LAYOUT ────────────────────────────────── */}
      <RGroup label="Layout" style={{ position: 'relative' }}>
        <button className={`ribbon-btn fdrop-btn ${openDrop === 'layout' ? 'active' : ''}`}
          onClick={() => tog('layout')} disabled={dis}>
          <span className="ribbon-btn-icon">⊞</span>
          <span className="ribbon-btn-label">Layout ▾</span>
        </button>
        {openDrop === 'layout' && t && (
          <FDrop width={280}>
            <FTitle>Display Options</FTitle>
            <div className="fdrop-toggle-stack">
              <FToggle label="Freeze First Column"  checked={t.frozen_first_col ?? false}  onChange={v => onUpdate({ frozen_first_col: v })} />
              <FToggle label="Wrap Header Text"     checked={t.header_word_wrap ?? false}  onChange={v => onUpdate({ header_word_wrap: v })} />
              <FToggle label="Show Serial Numbers"  checked={t.serial_number ?? false}     onChange={v => onUpdate({ serial_number: v })} />
              {t.serial_number && (
                <FField label="Numbering Style">
                  <select value={t.serial_number_mode || 'continuous'} className="fdrop-select"
                    onChange={e => onUpdate({ serial_number_mode: e.target.value as any })}>
                    <option value="continuous">Continuous (1, 2, 3…)</option>
                    <option value="per_group">Restart per Group</option>
                  </select>
                </FField>
              )}
              <FToggle label="Hide Zero / Blank Rows" checked={t.blank_suppress ?? false} onChange={v => onUpdate({ blank_suppress: v })} />
            </div>
            <FDivider />
            <FTitle>Cell Alignment</FTitle>
            <div className="fdrop-row" style={{ gap: 8 }}>
              <FField label="Headers">
                <select value={t.header_align || 'center'} className="fdrop-select"
                  onChange={e => onUpdate({ header_align: e.target.value as any })}>
                  <option value="left">Left</option>
                  <option value="center">Center</option>
                  <option value="right">Right</option>
                </select>
              </FField>
              <FField label="Row Labels">
                <select value={t.row_label_align || 'left'} className="fdrop-select"
                  onChange={e => onUpdate({ row_label_align: e.target.value as any })}>
                  <option value="left">Left</option>
                  <option value="center">Center</option>
                  <option value="right">Right</option>
                </select>
              </FField>
              <FField label="Values">
                <select value={t.cell_align || 'right'} className="fdrop-select"
                  onChange={e => onUpdate({ cell_align: e.target.value as any })}>
                  <option value="left">Left</option>
                  <option value="center">Center</option>
                  <option value="right">Right</option>
                </select>
              </FField>
            </div>
            <FDivider />
            <div className="fdrop-row" style={{ gap: 8 }}>
              <FField label="Zoom">
                <select value={t.zoom_level || 100} className="fdrop-select"
                  onChange={e => onUpdate({ zoom_level: Number(e.target.value) })}>
                  {[50,75,100,125,150,200].map(z => <option key={z} value={z}>{z}%</option>)}
                </select>
              </FField>
              <FField label="Row Height (px)">
                <input type="number" min={20} max={100} value={t.row_height || 32} className="fdrop-input"
                  style={{ width: 64 }} onChange={e => onUpdate({ row_height: parseInt(e.target.value) || 32 })} />
              </FField>
            </div>
            {allFields.length > 0 && (
              <>
                <FDivider />
                <FTitle>Column Widths</FTitle>
                {allFields.map(f => (
                  <div key={f} className="fdrop-color-row">
                    <span className="fdrop-color-label" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{f}</span>
                    <input type="number" min={40} max={500}
                      value={(t.column_widths || {})[f] || ''}
                      placeholder="Auto" className="fdrop-input" style={{ width: 64 }}
                      onChange={e => {
                        const widths = { ...(t.column_widths || {}) };
                        const val = parseInt(e.target.value);
                        if (val > 0) widths[f] = val; else delete widths[f];
                        onUpdate({ column_widths: widths });
                      }} />
                    <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>px</span>
                  </div>
                ))}
                <button className="fdrop-ghost-btn" style={{ marginTop: 4 }}
                  onClick={() => onUpdate({ column_widths: {} })}>↺ Reset All Widths</button>
              </>
            )}
          </FDrop>
        )}
      </RGroup>

      {/* ── 7. LABELS / HEADERS ──────────────────────── */}
      <RGroup label="Labels" style={{ position: 'relative' }}>
        <button className={`ribbon-btn fdrop-btn ${openDrop === 'labels' ? 'active' : ''}`}
          onClick={() => tog('labels')} disabled={dis}>
          <span className="ribbon-btn-icon">🏷</span>
          <span className="ribbon-btn-label">Labels ▾</span>
        </button>
        {openDrop === 'labels' && t && (
          <FDrop width={300}>
            <FTitle>Rename Column Headers</FTitle>
            {allFields.length === 0
              ? <p className="fdrop-hint">Add fields to the table first</p>
              : allFields.map(h => (
                  <div key={h} className="fdrop-rename-row">
                    <span className="fdrop-rename-orig" title={h}>{h}</span>
                    <span className="fdrop-rename-arrow">→</span>
                    <input type="text" className="fdrop-input" style={{ flex: 1 }}
                      value={(t.header_renames || {})[h] || ''}
                      onChange={e => updateHeaderRename(h, e.target.value)}
                      placeholder={h} />
                  </div>
                ))
            }
            <FDivider />
            <FTitle>Date Display Format</FTitle>
            {[...t.rows, ...t.columns].length === 0
              ? <p className="fdrop-hint">Add date fields to rows or columns</p>
              : [...t.rows, ...t.columns].map(f => (
                  <div key={f} className="fdrop-color-row">
                    <span className="fdrop-color-label">{f}</span>
                    <select className="fdrop-select" style={{ flex: 1 }}
                      value={(t.date_formats || []).find(df => df.field === f)?.format || ''}
                      onChange={e => updateDateFmt(f, e.target.value)}>
                      <option value="">Default</option>
                      {DATE_FORMATS.map(df => <option key={df.value} value={df.value}>{df.label}</option>)}
                    </select>
                  </div>
                ))
            }
          </FDrop>
        )}
      </RGroup>

      {/* ── 9. CONDITIONAL RULES ─────────────────────── */}
      <RGroup label="Rules" style={{ position: 'relative' }}>
        <button className={`ribbon-btn fdrop-btn ${openDrop === 'rules' ? 'active' : ''}`}
          onClick={() => tog('rules')} disabled={dis}>
          <span className="ribbon-btn-icon">🎯</span>
          <span className="ribbon-btn-label">Rules ▾</span>
        </button>
        {openDrop === 'rules' && t && (
          <FDrop width={310}>
            <FTitle>Conditional Formatting</FTitle>
            {t.values.length === 0
              ? <p className="fdrop-hint">Add value fields first</p>
              : <>
                  {(t.conditional_formats || []).map((cf, i) => (
                    <div key={cf.id} className="fdrop-cf-block">
                      <div className="fdrop-row" style={{ gap: 6, marginBottom: 6 }}>
                        <select value={cf.type} className="fdrop-select" style={{ flex: 1 }}
                          onChange={e => {
                            const arr = [...(t.conditional_formats || [])];
                            arr[i] = { ...arr[i], type: e.target.value as any };
                            onUpdate({ conditional_formats: arr });
                          }}>
                          <option value="color_scale">🌈 Color Scale</option>
                          <option value="data_bar">📊 Data Bar</option>
                          <option value="icon_set">⬆ Icon Set</option>
                          <option value="rule">📏 Rule-Based</option>
                        </select>
                        <button className="fdrop-reset-btn"
                          onClick={() => onUpdate({ conditional_formats: (t.conditional_formats || []).filter((_, j) => j !== i) })}>✕</button>
                      </div>
                      <FField label="Applies To">
                        <select value={cf.applies_to} className="fdrop-select"
                          onChange={e => {
                            const arr = [...(t.conditional_formats || [])];
                            arr[i] = { ...arr[i], applies_to: e.target.value };
                            onUpdate({ conditional_formats: arr });
                          }}>
                          {t.values.map(v => <option key={v.field} value={v.label || v.field}>{v.label || v.field}</option>)}
                        </select>
                      </FField>
                      {(cf.type === 'color_scale' || cf.type === 'data_bar') && (
                        <div className="fdrop-row" style={{ gap: 12, marginTop: 8 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Min</span>
                            <input type="color" value={cf.min_color || '#ff4444'} className="fdrop-color-input"
                              onChange={e => {
                                const arr = [...(t.conditional_formats || [])];
                                arr[i] = { ...arr[i], min_color: e.target.value };
                                onUpdate({ conditional_formats: arr });
                              }} />
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Max</span>
                            <input type="color" value={cf.max_color || '#44bb44'} className="fdrop-color-input"
                              onChange={e => {
                                const arr = [...(t.conditional_formats || [])];
                                arr[i] = { ...arr[i], max_color: e.target.value };
                                onUpdate({ conditional_formats: arr });
                              }} />
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                  <button className="fdrop-btn-action" style={{ marginTop: 4 }}
                    onClick={() => onUpdate({
                      conditional_formats: [...(t.conditional_formats || []), {
                        id: String(Date.now()), type: 'color_scale' as const,
                        applies_to: t.values[0]?.label || t.values[0]?.field || '',
                        min_color: '#ff4444', max_color: '#44bb44',
                      }],
                    })}>+ Add Rule</button>
                </>
            }
          </FDrop>
        )}
      </RGroup>

      {/* ── 10. COLUMN DATA TYPES ───────────────────── */}
      {onColumnTypeChange && (
        <RGroup label="Col Types" style={{ position: 'relative' }}>
          <button className={`ribbon-btn fdrop-btn ${openDrop === 'coltypes' ? 'active' : ''}`}
            onClick={() => tog('coltypes')} disabled={dis}>
            <span className="ribbon-btn-icon">🔢</span>
            <span className="ribbon-btn-label">Col Types ▾</span>
          </button>
          {openDrop === 'coltypes' && t && (
            <FDrop width={300}>
              <FTitle>Column Data Types</FTitle>
              <p className="fdrop-hint" style={{ marginBottom: 8 }}>
                Change how a column is treated. "Multi-choice" splits comma-separated values (e.g. "1,3,5") into separate rows for counting.
              </p>
              {(() => {
                const usedCols = [...new Set([...t.rows, ...t.columns])];
                if (usedCols.length === 0) return <p className="fdrop-hint">Add columns to Rows or Columns zones first.</p>;
                return usedCols.map(colName => {
                  const colInfo = columns.find(c => c.name === colName);
                  const currentType = colInfo?.type || 'text';
                  return (
                    <div key={colName} className="fdrop-color-row" style={{ alignItems: 'center' }}>
                      <span className="fdrop-color-label" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 11 }} title={colName}>{colName}</span>
                      <select className="fdrop-select" style={{ minWidth: 110 }}
                        value={currentType}
                        onChange={e => onColumnTypeChange!(colName, e.target.value)}>
                        <option value="text">Text / Category</option>
                        <option value="numeric">Numeric</option>
                        <option value="multi_choice">Multi-Choice</option>
                        <option value="date">Date</option>
                        <option value="boolean">Boolean</option>
                      </select>
                    </div>
                  );
                });
              })()}
            </FDrop>
          )}
        </RGroup>
      )}

    </div>  // end format-ribbon-wrap
  );
}

// ── VIEW ───────────────────────────────────────────────────
function ViewRibbon({ table, dataset, onAction, onUpdate, theme }: {
  table: TableConfig | null; dataset: boolean;
  onAction: (action: string) => void; onUpdate: (update: Partial<TableConfig>) => void;
  theme: 'dark' | 'light';
}) {
  return (
    <>
      <RGroup label="Zoom">
        <select className="ribbon-select"
          value={table?.zoom_level || 100}
          onChange={e => onUpdate({ zoom_level: Number(e.target.value) })}>
          {[50,75,100,125,150,200].map(z => <option key={z} value={z}>{z}%</option>)}
        </select>
      </RGroup>
      <RGroup label="Panels">
        <RBtn icon="📊" label="Chart"     onClick={() => onAction('charts')}    disabled={!dataset} />
        <RBtn icon="📈" label="Dashboard" onClick={() => onAction('dashboard')} disabled={!dataset} />
      </RGroup>
      <RGroup label="Table Theme">
        <RBtn icon={theme === 'dark' ? '☀' : '☾'} label={theme === 'dark' ? 'Light Table' : 'Dark Table'}
          onClick={() => onAction('theme')} />
      </RGroup>
      <RGroup label="Help">
        <RBtn icon="❓" label="Tour"     onClick={() => onAction('tour')} />
        <RBtn icon="🗂" label="Projects" onClick={() => onAction('projects')} />
      </RGroup>
    </>
  );
}


// ── AI-Smart Ribbon ───────────────────────────────────────────
function AISmartRibbon({ table, dataset, onAction, onUpdate }: { table: TableConfig | null; dataset: boolean; onAction: (a: string) => void; onUpdate: (u: Partial<TableConfig>) => void }) {
  return (
    <>
      <RGroup label="AI Rename">
        <RBtn icon="✨" label="Polish Title & Headers" onClick={() => onAction('ai-polish')} disabled={!table || !dataset} />
      </RGroup>
      <RGroup label="AI Interpret">
        <RBtn icon="📝" label="Interpret Table" onClick={() => onAction('ai-interpret')} disabled={!table || !dataset} />
        <RBtn icon="🔄" label="Refine" onClick={() => onAction('ai-refine')} disabled={!table || !dataset} />
      </RGroup>
      <RGroup label="AI Build">
        <RBtn icon="🧠" label="AI Table Builder" onClick={() => onAction('ai-smart-build')} disabled={!dataset} />
      </RGroup>
      <RGroup label="AI Report">
        <RBtn icon="📄" label="Generate Report" onClick={() => onAction('ai-report')} disabled={!dataset} />
      </RGroup>
      <RGroup label="Settings">
        <RBtn icon="⚙" label="AI Config" onClick={() => onAction('ai-config')} />
      </RGroup>
    </>
  );
}
