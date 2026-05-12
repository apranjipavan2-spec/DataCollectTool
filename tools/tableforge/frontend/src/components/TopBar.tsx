import React, { useRef, useState, useEffect, useCallback } from 'react';
import { DatasetMeta } from '../types';

interface Props {
  onFileUpload: (file: File) => void;
  dataset: DatasetMeta | null;
  onAction: (action: string) => void;
  onToggleTheme: () => void;
  theme: 'dark' | 'light';
  ribbonTab?: string;
  onRibbonTabChange?: (tab: string) => void;
  fgHomeUrl?: string;
}

const ribbonTabs = ['Home', 'Insert', 'Data', 'Statistics', 'Format', 'View', 'AI-Smart'];

interface MenuItem {
  label: string;
  icon: string;
  action: string;
  shortcut?: string;
  divider?: boolean;
  disabled?: boolean;
}

interface MenuDef {
  label: string;
  items: (MenuItem | { divider: true })[];
}

export function TopBar({ onFileUpload, dataset, onAction, onToggleTheme, theme, ribbonTab, onRibbonTabChange, fgHomeUrl }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const menus: MenuDef[] = [
    {
      label: 'File',
      items: [
        { label: 'Import File…', icon: '📂', action: 'import', shortcut: 'Ctrl+O' },
        { divider: true },
        { label: 'Save Project', icon: '💾', action: 'save', shortcut: 'Ctrl+S', disabled: !dataset },
        { label: 'Projects & Templates', icon: '🗂', action: 'projects' },
        { divider: true },
        { label: 'Export…', icon: '↓', action: 'export', shortcut: 'Ctrl+E', disabled: !dataset },
        { label: 'Batch Export', icon: '📦', action: 'export', disabled: !dataset },
        { divider: true },
        { label: 'Refresh Data', icon: '🔄', action: 'refresh', disabled: !dataset },
      ],
    },
    {
      label: 'Data',
      items: [
        { label: 'Import CSV / Excel…', icon: '📂', action: 'import' },
        { divider: true },
        { label: 'Metrics Builder', icon: '𝑓', action: 'metrics', disabled: !dataset },
        { label: 'Bin Creator', icon: '⊕', action: 'bins', disabled: !dataset },
        { label: 'Period Comparisons', icon: '↔', action: 'comparison', disabled: !dataset },
        { divider: true },
        { label: 'Data Quality Report', icon: '🔍', action: 'quality', disabled: !dataset },
        { label: 'Metric Library', icon: '📚', action: 'metric_library' },
      ],
    },
    {
      label: 'View',
      items: [
        { label: 'Format Panel', icon: '🎨', action: 'format', disabled: !dataset },
        { label: 'Chart Builder', icon: '📊', action: 'charts', disabled: !dataset },
        { label: 'Summary Dashboard', icon: '📈', action: 'dashboard', disabled: !dataset },
        { divider: true },
        { label: 'Report Builder', icon: '📋', action: 'report', disabled: !dataset },
        { label: 'Audit Trail', icon: '📝', action: 'audit', disabled: !dataset },
        { divider: true },
        { label: `${theme === 'dark' ? '☀' : '☾'} Toggle Theme`, icon: '', action: 'theme' },
      ],
    },
    {
      label: 'Tools',
      items: [
        { label: 'Transpose Table', icon: '⇄', action: 'transpose', disabled: !dataset },
        { label: 'Duplicate Table', icon: '⧉', action: 'duplicate', disabled: !dataset },
        { label: 'Compare Tables', icon: '⊞', action: 'table_compare', disabled: !dataset },
        { divider: true },
        { label: 'Undo', icon: '↩', action: 'undo', shortcut: 'Ctrl+Z', disabled: !dataset },
        { label: 'Redo', icon: '↪', action: 'redo', shortcut: 'Ctrl+Y', disabled: !dataset },
        { divider: true },
        { label: 'Help Tour', icon: '❓', action: 'tour', disabled: !dataset },
      ],
    },
  ];

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenMenu(null); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const handleAction = useCallback((action: string) => {
    setOpenMenu(null);
    if (action === 'import') { fileRef.current?.click(); return; }
    if (action === 'theme') { onToggleTheme(); return; }
    onAction(action);
  }, [onAction, onToggleTheme]);

  const toggleMenu = (label: string) => {
    setOpenMenu(prev => prev === label ? null : label);
  };

  return (
    <div className="topbar">
      {/* Brand */}
      <div className="topbar-brand"
        style={{ cursor: fgHomeUrl ? 'pointer' : 'default' }}
        onClick={() => { if (fgHomeUrl) window.location.href = fgHomeUrl; }}
        title={fgHomeUrl ? 'Back to FieldGovern dashboard' : undefined}>
        <img src={import.meta.env.BASE_URL + 'logo-wide.png'} alt="FieldGovern" className="logo-img" style={{ height: 26, width: 'auto', marginRight: 8 }} />
      </div>

      {/* Ribbon tab buttons inline */}
      {ribbonTab && onRibbonTabChange && (
        <div className="topbar-ribbon-tabs">
          {ribbonTabs.map(t => (
            <button key={t}
              className={`topbar-rtab ${ribbonTab === t.toLowerCase() ? 'active' : ''}`}
              onClick={() => onRibbonTabChange(t.toLowerCase())}>
              {t}
            </button>
          ))}
        </div>
      )}
      <div style={{ flex: 1 }} />

      {/* Right side: file badge + quick actions */}
      <div className="topbar-right">
        {dataset && (
          <>
            <span className="filename-badge" title={dataset.filename}>
              {dataset.filename.length > 28 ? dataset.filename.slice(0, 26) + '…' : dataset.filename}
            </span>
            {'is_large_file' in dataset && (dataset as any).is_large_file && (
              <span className="large-file-badge">⚡ Large</span>
            )}
          </>
        )}
        <button className="btn-icon topbar-icon-btn" onClick={() => handleAction('export')} title="Export (Ctrl+E)" disabled={!dataset}
          style={{ opacity: dataset ? 1 : 0.4 }}>
          ↓
        </button>
        <button className="btn-icon topbar-icon-btn" onClick={onToggleTheme} title="Toggle Theme">
          {theme === 'dark' ? '☀' : '☾'}
        </button>
      </div>

      <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.tsv" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) onFileUpload(f); e.target.value = ''; }} />
    </div>
  );
}
