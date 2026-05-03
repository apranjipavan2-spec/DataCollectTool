import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ColumnInfo, TableConfig, TableResult } from '../types';

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

export function SourcePanel({
  columns, onDragStart, onDragEnd, onMultiDrop, metricNames = [], binNames = [],
  usedColumns, columnDescriptions = {}, onColumnDescriptionChange,
  tables = [], activeTableIdx = 0, results, error,
  onTableSelect, onAddTable, onDuplicateTable, onDuplicateTables, onRenameTable, onDeleteTable, onDeleteTables,
  onReorderTables,
}: Props) {
  const [search, setSearch] = useState('');
  const [hoveredCol, setHoveredCol] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showUsed, setShowUsed] = useState(true);
  const [tableSearch, setTableSearch] = useState('');
  const [editingDesc, setEditingDesc] = useState<string | null>(null);
  const [descDraft, setDescDraft] = useState('');
  const [selectedTables, setSelectedTables] = useState<Set<string>>(new Set());

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

  const usedSet = new Set([
    ...(usedColumns?.rows || []),
    ...(usedColumns?.columns || []),
    ...(usedColumns?.values || []),
  ]);

  const filtered = columns.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

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

  const filteredTables = tables.filter(t =>
    t.name.toLowerCase().includes(tableSearch.toLowerCase())
  );

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
        <h3 style={{ marginBottom: 6 }}>Tables <span style={{ fontSize: 10, fontWeight: 400, opacity: 0.6 }}>({tables.length})</span></h3>
        <input
          type="text"
          placeholder="Search…"
          value={tableSearch}
          onChange={e => setTableSearch(e.target.value)}
          className="search-input"
          style={{ fontSize: 11 }}
        />
      </div>

      {/* Multi-select action bar */}
      {selectedTables.size > 0 ? (
        <div className="table-multi-bar">
          <span className="table-multi-count">{selectedTables.size} selected</span>
          <button className="table-multi-btn" onClick={handleBulkDuplicate} title="Duplicate selected">⧉ Dup</button>
          <button className="table-multi-btn table-multi-del" onClick={handleBulkDelete} title="Delete selected">🗑 Del</button>
          <button className="table-multi-btn" onClick={selectAllTables} title="Select all">All</button>
          <button className="table-multi-clear" onClick={() => setSelectedTables(new Set())} title="Clear selection">✕</button>
        </div>
      ) : (
        <div className="table-list-actions">
          <button className="table-list-add-btn" onClick={onAddTable} title="Add new table">+ New Table</button>
        </div>
      )}

      <div className="panel-hint" style={{ padding: '2px 12px', fontSize: 10 }}>
        Ctrl+Click to multi-select · Shift+Click for range
      </div>

      <div className="column-list table-nav-list">
        {/* Dashboard item */}
        <div
          className={`table-nav-item ${activeTableIdx === -1 ? 'active' : ''}`}
          onClick={() => { onTableSelect?.(-1); setSelectedTables(new Set()); }}
        >
          <span className="table-nav-icon">📊</span>
          <span className="table-nav-name">Dashboard</span>
        </div>

        {filteredTables.map(t => {
          const realIdx = tables.indexOf(t);
          const hasResult = results?.has(t.id);
          const hasError = error && realIdx === activeTableIdx;
          const isEmpty = t.values.length === 0 && t.rows.length === 0 && t.columns.length === 0;
          const hasData = t.values.length > 0;
          const isSelected = selectedTables.has(t.id);

          const isDragOver = tableDragOverIdx === realIdx && tableDragIdx !== realIdx;
          return (
            <div key={t.id}
              className={`table-nav-item ${realIdx === activeTableIdx ? 'active' : ''} ${hasError ? 'table-nav-error' : ''} ${isEmpty ? 'table-nav-empty' : ''} ${isSelected ? 'table-nav-selected' : ''} ${isDragOver ? 'table-nav-drag-over' : ''}`}
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
              title={t.title || t.name}
            >
              {selectedTables.size > 0 && (
                <span className={`table-nav-check ${isSelected ? 'checked' : ''}`}>
                  {isSelected ? '✓' : ''}
                </span>
              )}
              <span className="table-nav-drag-grip" title="Drag to reorder">⠿</span>
              <span className="table-nav-num">{realIdx + 1}</span>
              <span className="table-nav-name">
                <HighlightText text={t.name} search={tableSearch} />
              </span>
              <span className="table-nav-meta">
                {hasError && <span className="table-nav-badge error-badge">!</span>}
                {hasData && !hasError && hasResult && <span className="table-nav-badge ok-badge">✓</span>}
                {isEmpty && <span className="table-nav-badge empty-badge">-</span>}
              </span>
            </div>
          );
        })}
      </div>
      <div className="panel-hint" style={{ marginTop: 4 }}>
        {tables.length} table(s) · Double-click to rename
      </div>
    </>
  );

  const renderColumnsView = () => (
    <>
      <div className="panel-header">
        <h3>Source Columns</h3>
        <input
          type="text"
          placeholder="Search columns..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="search-input"
        />
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
