import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ColumnInfo, ColumnRole, TableConfig, TableResult, TableSection, NumberingConfig } from '../types';

interface Props {
  columns: ColumnInfo[];
  onDragStart: (name: string) => void;
  onDragEnd: () => void;
  onMultiDrop?: (zone: 'rows' | 'columns' | 'values', fields: string[]) => void;
  metricNames?: string[];
  binNames?: string[];
  usedColumns?: { rows: string[]; columns: string[]; values: string[] };
  columnDescriptions?: Record<string, string>;
  onColumnDescriptionChange?: (column: string, description: string) => void;
  columnRoles?: Record<string, ColumnRole>;
  // Table list props
  tables?: TableConfig[];
  activeTableIdx?: number;
  results?: Map<string, TableResult>;
  error?: string | null;
  onTableSelect?: (idx: number) => void;
  onAddTable?: () => void;
  onDuplicateTable?: () => void;
  onDuplicateTables?: (indices: number[]) => void;
  onRenameTable?: (idx: number, newName: string) => void;
  onDeleteTable?: (idx: number) => void;
  onDeleteTables?: (indices: number[]) => void;
  onReorderTables?: (fromIdx: number, toIdx: number) => void;
  onTogglePin?: (idx: number) => void;
  onOpenChartFor?: (idx: number) => void;
  // Sections + numbering
  sections?: TableSection[];
  onSectionsChange?: (sections: TableSection[]) => void;
  onAssignSection?: (tableIdx: number, sectionId: string | undefined) => void;
  numberingConfig?: NumberingConfig;
  onNumberingConfigChange?: (cfg: NumberingConfig) => void;
  onApplyNumbering?: () => void;
}

const typeIcons: Record<string, string> = {
  numeric: '123',
  text: 'Aa',
  date: '📅',
  boolean: '☑',
  multi_choice: '☰',
};

const typeColors: Record<string, string> = {
  numeric: '#3b82f6',
  text: '#22c55e',
  date: '#f59e0b',
  boolean: '#a855f7',
  multi_choice: '#ec4899',
};

const zoneColors: Record<string, string> = {
  rows: '#3b82f6',
  columns: '#f59e0b',
  values: '#ef4444',
};

function HighlightText({ text, search }: { text: string; search: string }) {
  if (!search) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(search.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="search-highlight">{text.slice(idx, idx + search.length)}</mark>
      {text.slice(idx + search.length)}
    </>
  );
}

const ROLE_BADGE_STYLES: Record<string, { label: string; color: string }> = {
  outcome:        { label: 'O',   color: '#ef4444' },
  treatment:      { label: 'T',   color: '#a855f7' },
  demographic:    { label: 'D',   color: '#22c55e' },
  geographic:     { label: 'Geo', color: '#0ea5e9' },
  observer_rated: { label: 'Obs', color: '#f59e0b' },
  qualitative:    { label: 'Q',   color: '#ec4899' },
  weight:         { label: 'Wt',  color: '#94a3b8' },
  id:             { label: 'ID',  color: '#64748b' },
};

export function SourcePanel({
  columns, onDragStart, onDragEnd, onMultiDrop, metricNames = [], binNames = [],
  usedColumns, columnDescriptions = {}, onColumnDescriptionChange, columnRoles = {},
  tables = [], activeTableIdx = 0, results, error,
  onTableSelect, onAddTable, onDuplicateTable, onDuplicateTables, onRenameTable, onDeleteTable, onDeleteTables,
  onReorderTables, onTogglePin, onOpenChartFor,
  sections = [], onSectionsChange, onAssignSection,
  numberingConfig, onNumberingConfigChange, onApplyNumbering,
}: Props) {
  const [search, setSearch] = useState('');
  const [hoveredCol, setHoveredCol] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showUsed, setShowUsed] = useState(true);
  const [tableSearch, setTableSearch] = useState('');
  const [editingDesc, setEditingDesc] = useState<string | null>(null);
  const [descDraft, setDescDraft] = useState('');
  const [selectedTables, setSelectedTables] = useState<Set<string>>(new Set());
  const [showNumberingModal, setShowNumberingModal] = useState(false);
  const [renamingSection, setRenamingSection] = useState<string | null>(null);

  // Resizable sidebars
  const [tablesWidth, setTablesWidth] = useState(170);
  const [columnsWidth, setColumnsWidth] = useState(220);
  const resizingRef = useRef<'tables' | 'columns' | null>(null);
  const resizeStartXRef = useRef(0);
  const resizeStartWRef = useRef(0);

  const startResize = useCallback((which: 'tables' | 'columns') => (e: React.MouseEvent) => {
    resizingRef.current = which;
    resizeStartXRef.current = e.clientX;
    resizeStartWRef.current = which === 'tables' ? tablesWidth : columnsWidth;
    e.preventDefault();
  }, [tablesWidth, columnsWidth]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizingRef.current) return;
      const delta = e.clientX - resizeStartXRef.current;
      const newW = Math.max(120, Math.min(380, resizeStartWRef.current + delta));
      if (resizingRef.current === 'tables') setTablesWidth(newW);
      else setColumnsWidth(newW);
    };
    const onUp = () => { resizingRef.current = null; };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, []);

  // Drag-to-reorder tables
  const [tableDragIdx, setTableDragIdx] = useState<number | null>(null);
  const [tableDragOverIdx, setTableDragOverIdx] = useState<number | null>(null);

  const [colNumSearch, setColNumSearch] = useState('');

  // Map column name → 1-based index (original import order)
  const colNumMap = new Map<string, number>();
  columns.forEach((c, i) => { colNumMap.set(c.name, i + 1); });

  const usedSet = new Set([
    ...(usedColumns?.rows || []),
    ...(usedColumns?.columns || []),
    ...(usedColumns?.values || []),
  ]);

  const filtered = columns.filter(c => {
    const num = colNumMap.get(c.name) || 0;
    const matchesName = !search || c.name.toLowerCase().includes(search.toLowerCase());
    const matchesNum = !colNumSearch || String(num) === colNumSearch.trim() || String(num).startsWith(colNumSearch.trim());
    return matchesName && matchesNum;
  });

  // Separate used vs available columns
  const usedCols = filtered.filter(c => usedSet.has(c.name));
  const availableCols = filtered.filter(c => !usedSet.has(c.name));

  const grouped = {
    numeric: availableCols.filter(c => c.type === 'numeric'),
    text: availableCols.filter(c => c.type === 'text'),
    multi_choice: availableCols.filter(c => c.type === 'multi_choice'),
    date: availableCols.filter(c => c.type === 'date'),
    boolean: availableCols.filter(c => c.type === 'boolean'),
  };

  const getZone = (name: string): string | null => {
    if (usedColumns?.rows.includes(name)) return 'rows';
    if (usedColumns?.columns.includes(name)) return 'columns';
    if (usedColumns?.values.includes(name)) return 'values';
    return null;
  };

  const toggleSelect = (name: string, e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setSelected(prev => {
        const next = new Set(prev);
        if (next.has(name)) next.delete(name); else next.add(name);
        return next;
      });
    }
  };

  const addSelectedTo = (zone: 'rows' | 'columns' | 'values') => {
    if (selected.size > 0 && onMultiDrop) {
      onMultiDrop(zone, Array.from(selected));
      setSelected(new Set());
    }
  };

  const renderColumnItem = (col: ColumnInfo, showZoneBadge?: boolean) => {
    const zone = getZone(col.name);
    return (
      <div
        key={col.name}
        className={`column-item ${selected.has(col.name) ? 'selected' : ''} ${zone ? 'in-use' : ''}`}
        draggable
        onDragStart={e => {
          e.dataTransfer.setData('text/plain', col.name);
          onDragStart(col.name);
        }}
        onDragEnd={onDragEnd}
        onClick={e => toggleSelect(col.name, e)}
        onMouseEnter={() => setHoveredCol(col.name)}
        onMouseLeave={() => setHoveredCol(null)}
      >
        <span className="col-type-indicator" style={{ background: typeColors[col.type] }} />
        <span className="col-num" style={{ fontSize: 9, opacity: 0.5, minWidth: 20, marginRight: 2, fontVariantNumeric: 'tabular-nums' }}>
          {colNumMap.get(col.name)}
        </span>
        <span className="col-name">
          <HighlightText text={col.name} search={search} />
        </span>
        {showZoneBadge && zone && (
          <span className="col-zone-badge" style={{ background: zoneColors[zone], color: '#fff' }}>
            {zone === 'rows' ? 'R' : zone === 'columns' ? 'C' : 'V'}
          </span>
        )}
        {metricNames.includes(col.name) && <span className="col-badge col-metric-badge" title="Has metric">f</span>}
        {binNames.includes(col.name) && <span className="col-badge col-bin-badge" title="Has bin">+</span>}
        {(() => {
          const role = columnRoles[col.name]?.role;
          const badge = role ? ROLE_BADGE_STYLES[role] : null;
          if (!badge) return null;
          return (
            <span title={`Role: ${role}`} style={{
              display: 'inline-block', minWidth: 16, padding: '0 4px',
              marginLeft: 3, fontSize: 9, lineHeight: '14px',
              borderRadius: 3, background: badge.color, color: '#fff',
              textAlign: 'center', fontWeight: 600,
            }}>{badge.label}</span>
          );
        })()}
        {selected.has(col.name) && <span className="col-selected-check">✓</span>}
        {hoveredCol === col.name && !selected.has(col.name) && editingDesc !== col.name && (
          <div className="col-tooltip">
            <div><strong>{col.name}</strong> ({col.type})</div>
            <div>{col.stats.unique} unique · {col.stats.nulls} nulls</div>
            {col.stats.min != null && <div>Range: {col.stats.min} – {col.stats.max}</div>}
            <div className="sample-vals">
              {col.sample_values.slice(0, 5).join(', ')}
            </div>
            {columnDescriptions[col.name] && (
              <div style={{ marginTop: 4, fontStyle: 'italic', color: '#93c5fd' }}>{columnDescriptions[col.name]}</div>
            )}
            {onColumnDescriptionChange && (
              <button onClick={e => { e.stopPropagation(); setEditingDesc(col.name); setDescDraft(columnDescriptions[col.name] || ''); }}
                style={{ marginTop: 4, fontSize: 10, background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 3, color: 'var(--text-dim)', cursor: 'pointer', padding: '2px 6px' }}>
                {columnDescriptions[col.name] ? 'Edit description' : 'Add description'}
              </button>
            )}
          </div>
        )}
        {editingDesc === col.name && (
          <div className="col-tooltip" style={{ padding: 8 }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 11, marginBottom: 4 }}><strong>{col.name}</strong> — Description</div>
            <input value={descDraft} onChange={e => setDescDraft(e.target.value)}
              placeholder="e.g. Household size (number of members)"
              autoFocus
              onKeyDown={e => {
                if (e.key === 'Enter') { onColumnDescriptionChange?.(col.name, descDraft); setEditingDesc(null); }
                if (e.key === 'Escape') setEditingDesc(null);
              }}
              style={{ width: '100%', fontSize: 11, padding: '4px 6px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 3, color: 'inherit' }} />
            <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
              <button onClick={() => { onColumnDescriptionChange?.(col.name, descDraft); setEditingDesc(null); }}
                style={{ fontSize: 10, padding: '2px 8px', background: '#3b82f6', border: 'none', borderRadius: 3, color: '#fff', cursor: 'pointer' }}>Save</button>
              <button onClick={() => setEditingDesc(null)}
                style={{ fontSize: 10, padding: '2px 8px', background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: 3, color: 'var(--text-dim)', cursor: 'pointer' }}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const filteredTables = tables
    .filter(t => (t.title || t.name).toLowerCase().includes(tableSearch.toLowerCase()))
    // Pinned tables float to the top (stable: preserves underlying order within each group)
    .slice()
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));

  const toggleTableSelect = (id: string, e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      setSelectedTables(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      });
    } else if (e.shiftKey && tables.length > 0) {
      // Range select: from last selected or active table to clicked
      e.preventDefault();
      e.stopPropagation();
      const clickedIdx = tables.findIndex(t => t.id === id);
      // Find anchor: last item in selectedTables or activeTableIdx
      let anchorIdx = activeTableIdx >= 0 ? activeTableIdx : 0;
      if (selectedTables.size > 0) {
        const lastSelectedId = Array.from(selectedTables).pop()!;
        const found = tables.findIndex(t => t.id === lastSelectedId);
        if (found >= 0) anchorIdx = found;
      }
      const start = Math.min(anchorIdx, clickedIdx);
      const end = Math.max(anchorIdx, clickedIdx);
      const rangeIds = tables.slice(start, end + 1).map(t => t.id);
      setSelectedTables(prev => {
        const next = new Set(prev);
        rangeIds.forEach(rid => next.add(rid));
        return next;
      });
    }
  };

  const handleBulkDuplicate = () => {
    if (selectedTables.size === 0) return;
    const indices = tables
      .map((t, i) => selectedTables.has(t.id) ? i : -1)
      .filter(i => i >= 0);
    onDuplicateTables?.(indices);
    setSelectedTables(new Set());
  };

  const handleBulkDelete = () => {
    if (selectedTables.size === 0) return;
    const indices = tables
      .map((t, i) => selectedTables.has(t.id) ? i : -1)
      .filter(i => i >= 0);
    onDeleteTables?.(indices);
    setSelectedTables(new Set());
  };

  const selectAllTables = () => {
    setSelectedTables(new Set(tables.map(t => t.id)));
  };

  const renderTablesView = () => (
    <>
      <div className="panel-header" style={{ paddingBottom: 6 }}>
        <h3 style={{ marginBottom: 6 }}>Tables &amp; Charts <span style={{ fontSize: 10, fontWeight: 400, opacity: 0.6 }}>({tables.length})</span></h3>
        <div style={{ display: 'flex', gap: 4, alignItems: 'stretch' }}>
          <input
            type="text"
            placeholder="Search…"
            value={tableSearch}
            onChange={e => setTableSearch(e.target.value)}
            className="search-input"
            style={{ fontSize: 11, flex: 1 }}
          />
          <button
            onClick={onAddTable}
            title="Add new table"
            style={{
              padding: '0 10px',
              background: 'var(--primary, #3b82f6)',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 16,
              fontWeight: 600,
              lineHeight: 1,
              flexShrink: 0,
            }}
          >+</button>
        </div>
      </div>

      {/* Multi-select action bar */}
      {selectedTables.size > 0 && (
        <div className="table-multi-bar">
          <span className="table-multi-count">{selectedTables.size} selected</span>
          <button className="table-multi-btn" onClick={handleBulkDuplicate} title="Duplicate selected">⧉ Dup</button>
          <button className="table-multi-btn table-multi-del" onClick={handleBulkDelete} title="Delete selected">🗑 Del</button>
          <button className="table-multi-btn" onClick={selectAllTables} title="Select all">All</button>
          <button className="table-multi-clear" onClick={() => setSelectedTables(new Set())} title="Clear selection">✕</button>
        </div>
      )}

      {/* Section + numbering toolbar */}
      <div style={{ display: 'flex', gap: 4, padding: '4px 12px', borderBottom: '1px solid var(--border)' }}>
        <button
          onClick={() => {
            const name = prompt('New section name:', `Section ${sections.length + 1}`);
            if (!name?.trim()) return;
            const id = `sec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
            onSectionsChange?.([...sections, { id, name: name.trim(), order: sections.length }]);
          }}
          title="Create a new section"
          style={{ flex: 1, padding: '3px 6px', background: 'rgba(168,85,247,0.15)', color: '#c4b5fd', border: '1px solid rgba(168,85,247,0.3)', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}
        >+ Section</button>
        <button
          onClick={() => setShowNumberingModal(true)}
          title="Apply table numbering"
          style={{ flex: 1, padding: '3px 6px', background: 'rgba(59,130,246,0.15)', color: '#93c5fd', border: '1px solid rgba(59,130,246,0.3)', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}
        >№ Numbering</button>
      </div>
      <div className="panel-hint" style={{ padding: '2px 12px', fontSize: 10 }}>
        Ctrl+Click to multi-select · Shift+Click for range
      </div>
      {showNumberingModal && numberingConfig && onNumberingConfigChange && (
        <div className="modal-overlay" onClick={() => setShowNumberingModal(false)}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()} style={{ width: 380 }}>
            <div className="modal-header">
              <h2>Table Numbering</h2>
              <button className="modal-close" onClick={() => setShowNumberingModal(false)}>×</button>
            </div>
            <div className="modal-body" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <label style={{ fontSize: 11, color: 'var(--text-dim)', display: 'block', marginBottom: 4 }}>Style</label>
                <select value={numberingConfig.style} onChange={e => onNumberingConfigChange({ ...numberingConfig, style: e.target.value as any })}
                  style={{ width: '100%' }}>
                  <option value="arabic">1, 2, 3, ...</option>
                  <option value="decimal">1.1, 1.2, 2.1 (per-section sub-numbers)</option>
                  <option value="alpha">A, B, C, ...</option>
                  <option value="roman">I, II, III, ...</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--text-dim)', display: 'block', marginBottom: 4 }}>Scope</label>
                <select value={numberingConfig.scope} onChange={e => onNumberingConfigChange({ ...numberingConfig, scope: e.target.value as any })}
                  style={{ width: '100%' }}>
                  <option value="continuous">Continuous across all tables</option>
                  <option value="per_section">Restart in each section</option>
                </select>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, color: 'var(--text-dim)', display: 'block', marginBottom: 4 }}>Prefix</label>
                  <input type="text" value={numberingConfig.prefix || ''} onChange={e => onNumberingConfigChange({ ...numberingConfig, prefix: e.target.value })}
                    placeholder="Table " style={{ width: '100%' }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, color: 'var(--text-dim)', display: 'block', marginBottom: 4 }}>Suffix</label>
                  <input type="text" value={numberingConfig.suffix || ''} onChange={e => onNumberingConfigChange({ ...numberingConfig, suffix: e.target.value })}
                    placeholder=": " style={{ width: '100%' }} />
                </div>
              </div>
              <div style={{ padding: 8, background: 'rgba(59,130,246,0.08)', borderRadius: 4, fontSize: 11, color: 'var(--text-dim)' }}>
                Preview: <strong style={{ color: 'var(--text)' }}>
                  {(numberingConfig.prefix || '')}
                  {numberingConfig.style === 'arabic' && '1'}
                  {numberingConfig.style === 'decimal' && (numberingConfig.scope === 'per_section' ? '1.1' : '1')}
                  {numberingConfig.style === 'alpha' && 'A'}
                  {numberingConfig.style === 'roman' && 'I'}
                  {(numberingConfig.suffix || '')}
                </strong> Sample Title
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowNumberingModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={() => { onApplyNumbering?.(); setShowNumberingModal(false); }}>Apply to all tables</button>
            </div>
          </div>
        </div>
      )}

      <div className="column-list table-nav-list">
        {/* Dashboard item */}
        <div
          className={`table-nav-item ${activeTableIdx === -1 ? 'active' : ''}`}
          onClick={() => { onTableSelect?.(-1); setSelectedTables(new Set()); }}
        >
          <span className="table-nav-icon">📊</span>
          <span className="table-nav-name">Dashboard</span>
        </div>

        {(() => {
          // Group filteredTables by section_id. Order: unsectioned first, then sections in `order`.
          const sorted = [...sections].sort((a, b) => a.order - b.order);
          const groups: { section: TableSection | null; items: TableConfig[] }[] = [];
          const unsec = filteredTables.filter(t => !t.section_id || !sorted.find(s => s.id === t.section_id));
          if (unsec.length) groups.push({ section: null, items: unsec });
          sorted.forEach(sec => {
            const inSec = filteredTables.filter(t => t.section_id === sec.id);
            // Always render section header (so user can drop into empty sections / see they exist)
            groups.push({ section: sec, items: inSec });
          });

          return groups.map(g => {
            const collapsed = g.section?.collapsed;
            return (
              <React.Fragment key={g.section?.id || '__unsectioned__'}>
                {g.section && (
                  <div
                    className="table-nav-section-header"
                    onDragOver={e => { e.preventDefault(); }}
                    onDrop={e => {
                      e.preventDefault();
                      if (tableDragIdx !== null && g.section) {
                        onAssignSection?.(tableDragIdx, g.section.id);
                      }
                      setTableDragIdx(null); setTableDragOverIdx(null);
                    }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 4,
                      padding: '4px 8px', marginTop: 4,
                      background: 'rgba(168,85,247,0.08)',
                      borderTop: '1px solid rgba(168,85,247,0.25)',
                      borderBottom: '1px solid rgba(168,85,247,0.15)',
                      fontSize: 10, fontWeight: 600, color: '#c4b5fd',
                      textTransform: 'uppercase', letterSpacing: 0.5,
                      cursor: 'pointer',
                    }}
                    onClick={() => {
                      onSectionsChange?.(sections.map(s => s.id === g.section!.id ? { ...s, collapsed: !s.collapsed } : s));
                    }}
                    title="Click to collapse · Drop a table here to move it in"
                  >
                    <span style={{ fontSize: 8 }}>{collapsed ? '▶' : '▼'}</span>
                    {renamingSection === g.section.id ? (
                      <input
                        autoFocus
                        defaultValue={g.section.name}
                        onClick={e => e.stopPropagation()}
                        onBlur={e => {
                          const v = e.target.value.trim();
                          if (v) onSectionsChange?.(sections.map(s => s.id === g.section!.id ? { ...s, name: v } : s));
                          setRenamingSection(null);
                        }}
                        onKeyDown={e => {
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                          if (e.key === 'Escape') setRenamingSection(null);
                        }}
                        style={{ flex: 1, fontSize: 10, padding: '1px 4px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(168,85,247,0.4)', borderRadius: 2, color: 'inherit', textTransform: 'none', letterSpacing: 0 }}
                      />
                    ) : (
                      <span style={{ flex: 1 }} onDoubleClick={e => { e.stopPropagation(); setRenamingSection(g.section!.id); }}>
                        {g.section.name} <span style={{ opacity: 0.6 }}>({g.items.length})</span>
                      </span>
                    )}
                    <span
                      title="Rename section"
                      onClick={e => { e.stopPropagation(); setRenamingSection(g.section!.id); }}
                      style={{ cursor: 'pointer', opacity: 0.6, padding: '0 3px' }}
                    >✎</span>
                    <span
                      title="Delete section (tables move back to Unsectioned)"
                      onClick={e => {
                        e.stopPropagation();
                        if (!confirm(`Delete section "${g.section!.name}"? Tables will move to Unsectioned.`)) return;
                        // Unassign all tables in section
                        g.items.forEach(t => {
                          const idx = tables.indexOf(t);
                          if (idx >= 0) onAssignSection?.(idx, undefined);
                        });
                        onSectionsChange?.(sections.filter(s => s.id !== g.section!.id));
                      }}
                      style={{ cursor: 'pointer', opacity: 0.6, padding: '0 3px', color: '#ef4444' }}
                    >×</span>
                  </div>
                )}
                {(!collapsed) && g.items.map(t => {
                  const realIdx = tables.indexOf(t);
                  const hasResult = results?.has(t.id);
                  const hasError = error && realIdx === activeTableIdx;
                  const isEmpty = t.values.length === 0 && t.rows.length === 0 && t.columns.length === 0;
                  const hasData = t.values.length > 0;
                  const isSelected = selectedTables.has(t.id);
                  const isDragOver = tableDragOverIdx === realIdx && tableDragIdx !== realIdx;
                  const hasChart = !!t.chartConfig;
                  const chartOnly = !!t.chartConfig?.chart_only;
                  return (
                    <React.Fragment key={t.id}>
            <div
              className={`table-nav-item ${realIdx === activeTableIdx ? 'active' : ''} ${hasError ? 'table-nav-error' : ''} ${isEmpty ? 'table-nav-empty' : ''} ${isSelected ? 'table-nav-selected' : ''} ${isDragOver ? 'table-nav-drag-over' : ''} ${hasChart ? 'table-nav-charted' : ''}`}
              style={hasChart ? { borderLeft: `3px solid ${chartOnly ? '#a78bfa' : '#22c55e'}` } : undefined}
              draggable
              onDragStart={e => {
                setTableDragIdx(realIdx);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', String(realIdx));
              }}
              onDragOver={e => { e.preventDefault(); setTableDragOverIdx(realIdx); }}
              onDragLeave={() => setTableDragOverIdx(null)}
              onDrop={e => {
                e.preventDefault();
                if (tableDragIdx !== null && tableDragIdx !== realIdx) {
                  onReorderTables?.(tableDragIdx, realIdx);
                }
                setTableDragIdx(null); setTableDragOverIdx(null);
              }}
              onDragEnd={() => { setTableDragIdx(null); setTableDragOverIdx(null); }}
              onClick={e => {
                if (e.ctrlKey || e.metaKey || e.shiftKey) {
                  toggleTableSelect(t.id, e);
                } else {
                  setSelectedTables(new Set());
                  onTableSelect?.(realIdx);
                }
              }}
              onDoubleClick={() => {
                const newName = prompt('Rename table:', t.name);
                if (newName && newName.trim()) onRenameTable?.(realIdx, newName.trim());
              }}
              onContextMenu={e => {
                if (!onAssignSection || sections.length === 0) return;
                e.preventDefault();
                const choices = ['(none — unsectioned)', ...sections.sort((a, b) => a.order - b.order).map(s => s.name)];
                const numbered = choices.map((c, i) => `${i}: ${c}`).join('\n');
                const ans = prompt(`Move "${t.title || t.name}" to section:\n${numbered}\n\nEnter number:`, '0');
                if (ans === null) return;
                const n = parseInt(ans, 10);
                if (isNaN(n) || n < 0 || n >= choices.length) return;
                const sortedSecs = [...sections].sort((a, b) => a.order - b.order);
                const sid = n === 0 ? undefined : sortedSecs[n - 1].id;
                onAssignSection(realIdx, sid);
              }}
              title={`${t.title || t.name}\nRight-click to move to a section`}
            >
              {selectedTables.size > 0 && (
                <span className={`table-nav-check ${isSelected ? 'checked' : ''}`}>
                  {isSelected ? '✓' : ''}
                </span>
              )}
              <span className="table-nav-drag-grip" title="Drag to reorder">⠿</span>
              <span className="table-nav-num">{realIdx + 1}</span>
              <span
                className={`table-nav-pin ${t.pinned ? 'pinned' : ''}`}
                title={t.pinned ? 'Unpin table' : 'Pin to top'}
                onClick={e => { e.stopPropagation(); onTogglePin?.(realIdx); }}
              >
                {t.pinned ? '★' : '☆'}
              </span>
              <span className="table-nav-name">
                {t.table_number && (
                  <span style={{ color: '#93c5fd', fontWeight: 600, marginRight: 4 }}>{t.table_number}</span>
                )}
                <HighlightText text={t.title || t.name} search={tableSearch} />
              </span>
              <span className="table-nav-meta">
                {t.source_table_id && <span className="table-nav-badge chain-badge" title="Derived from another table">⛓</span>}
                {hasError && <span className="table-nav-badge error-badge">!</span>}
                {hasData && !hasError && hasResult && <span className="table-nav-badge ok-badge">✓</span>}
                {isEmpty && <span className="table-nav-badge empty-badge">-</span>}
                {onOpenChartFor && hasResult && (
                  <span
                    className="table-nav-badge"
                    title={
                      chartOnly ? 'Chart only (table hidden) — click to edit'
                      : hasChart ? 'Chart attached — click to edit'
                      : 'No chart — click to create'
                    }
                    style={{
                      cursor: 'pointer',
                      background: chartOnly ? '#a78bfa' : hasChart ? '#22c55e' : '#475569',
                      color: '#fff',
                      fontWeight: hasChart ? 700 : 400,
                      padding: hasChart ? '1px 6px' : undefined,
                    }}
                    onClick={e => { e.stopPropagation(); onOpenChartFor(realIdx); }}
                  >{chartOnly ? '📊 only' : hasChart ? '📊 ✓' : '📊'}</span>
                )}
              </span>
            </div>
            {hasChart && (
              <div
                className={`table-nav-item ${realIdx === activeTableIdx ? 'active' : ''}`}
                onClick={e => {
                  e.stopPropagation();
                  onTableSelect?.(realIdx);
                  onOpenChartFor?.(realIdx);
                }}
                title="Open chart in builder"
                style={{
                  paddingLeft: 36,
                  background: 'rgba(59,130,246,0.04)',
                  borderLeft: `3px solid ${chartOnly ? '#a78bfa' : '#22c55e'}`,
                  fontSize: 11,
                }}
              >
                <span style={{ fontSize: 12 }}>📈</span>
                <span className="table-nav-name" style={{ color: 'var(--text-dim)', fontStyle: 'italic' }}>
                  {t.chartConfig?.chartTitle || `${t.chartConfig?.type || 'Chart'} chart`}
                </span>
              </div>
            )}
                    </React.Fragment>
                  );
                })}
              </React.Fragment>
            );
          });
        })()}
      </div>
      <div className="panel-hint" style={{ marginTop: 4 }}>
        {tables.length} table(s) · Drag to a section to assign · Double-click to rename
      </div>
    </>
  );

  const renderColumnsView = () => (
    <>
      <div className="panel-header">
        <h3>Source Columns</h3>
        <div style={{ display: 'flex', gap: 4 }}>
          <input
            type="text"
            placeholder="Search columns..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="search-input"
            style={{ flex: 1 }}
          />
          <input
            type="text"
            placeholder="Col #"
            value={colNumSearch}
            onChange={e => setColNumSearch(e.target.value.replace(/[^0-9]/g, ''))}
            className="search-input"
            style={{ width: 48, textAlign: 'center', fontSize: 11 }}
            title="Search by column number"
          />
        </div>
      </div>
      <div className="panel-hint">Drag to zones · Ctrl+Click to multi-select</div>

      {selected.size > 0 && (
        <div className="multi-select-bar">
          <span className="multi-select-count">{selected.size} selected</span>
          <button className="multi-add-btn" onClick={() => addSelectedTo('rows')}>→ Rows</button>
          <button className="multi-add-btn" onClick={() => addSelectedTo('columns')}>→ Cols</button>
          <button className="multi-add-btn" onClick={() => addSelectedTo('values')}>→ Values</button>
          <button className="multi-clear-btn" onClick={() => setSelected(new Set())}>✕</button>
        </div>
      )}

      <div className="column-list">
        {/* In-Use Columns Section */}
        {usedCols.length > 0 && (
          <div className="type-group used-group">
            <div
              className="type-group-header used-group-header"
              onClick={() => setShowUsed(!showUsed)}
              style={{ cursor: 'pointer' }}
            >
              <span style={{ fontSize: 9, marginRight: 4 }}>{showUsed ? '▼' : '▶'}</span>
              <span>IN TABLE</span>
              <span className="used-count">({usedCols.length})</span>
            </div>
            {showUsed && usedCols.map(col => renderColumnItem(col, true))}
          </div>
        )}

        {/* Available columns by type */}
        {(['multi_choice', 'numeric', 'text', 'date', 'boolean'] as const).map(type => {
          const cols = grouped[type];
          if (cols.length === 0) return null;
          return (
            <div key={type} className="type-group">
              <div className="type-group-header" style={{ color: typeColors[type] }}>
                <span>{typeIcons[type]}</span> {type === 'multi_choice' ? 'Multi-Choice' : type.charAt(0).toUpperCase() + type.slice(1)} ({cols.length})
              </div>
              {cols.map(col => renderColumnItem(col))}
            </div>
          );
        })}
      </div>
    </>
  );

  return (
    <div className="source-panel-area">
      {/* Left: Tables sidebar — always visible, dynamically resizable */}
      <div className="tables-sidebar" style={{ width: tablesWidth, minWidth: tablesWidth, maxWidth: tablesWidth }}>
        {renderTablesView()}
      </div>
      {/* Drag handle to resize the tables sidebar */}
      <div className="sidebar-resize-handle" onMouseDown={startResize('tables')} title="Drag to resize" />
      {/* Right: Columns sidebar — always visible, dynamically resizable */}
      <div className="columns-sidebar" style={{ width: columnsWidth, minWidth: columnsWidth, maxWidth: columnsWidth }}>
        {renderColumnsView()}
      </div>
      {/* Drag handle to resize the columns sidebar */}
      <div className="sidebar-resize-handle" onMouseDown={startResize('columns')} title="Drag to resize" />
    </div>
  );
}
