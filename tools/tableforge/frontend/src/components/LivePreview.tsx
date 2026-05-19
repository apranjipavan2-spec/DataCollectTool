import React, { useState, useMemo } from 'react';
import { TableResult, TableConfig, NumberFormat, ConditionalFormat, ColumnGroup } from '../types';
import { API_BASE } from '../api';
import { AnnotationContextMenu, Annotation } from './AnnotationOverlay';

interface Props {
  result: TableResult | null;
  loading: boolean;
  error: string | null;
  title: string;
  subtitle: string;
  datasetId?: string;
  tableConfig?: TableConfig;
  annotations?: Annotation[];
  onAnnotationsChange?: (anns: Annotation[]) => void;
  tableMode?: 'dark' | 'light';
  onHeaderRename?: (original: string, newName: string) => void;
}

const THEME_VARS: Record<string, { headerBg: string; headerColor: string; totalBg: string; borderColor: string }> = {
  default:        { headerBg: '#1e293b', headerColor: '#fff', totalBg: 'rgba(59,130,246,0.1)', borderColor: '#2a2e3f' },
  corporate_blue: { headerBg: '#1a4480', headerColor: '#fff', totalBg: '#e8f0fe', borderColor: '#3b82f6' },
  minimal_bw:     { headerBg: '#1a1a1a', headerColor: '#fff', totalBg: '#f5f5f5', borderColor: '#ccc' },
  financial:      { headerBg: '#003366', headerColor: '#fff', totalBg: '#fff2cc', borderColor: '#336699' },
  government:     { headerBg: '#2e4057', headerColor: '#fff', totalBg: '#f0f4f8', borderColor: '#6b8cae' },
  teal:           { headerBg: '#0d7377', headerColor: '#fff', totalBg: '#e0f7fa', borderColor: '#14a085' },
};

export function LivePreview({ result, loading, error, title, subtitle, datasetId, tableConfig, annotations: externalAnnotations, onAnnotationsChange, tableMode = 'dark', onHeaderRename }: Props) {
  const [drillDown, setDrillDown] = useState<{ headers: string[]; rows: any[][]; row_count: number; showing: number } | null>(null);
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [localAnnotations, setLocalAnnotations] = useState<Annotation[]>([]);
  const [annotationPos, setAnnotationPos] = useState<{ x: number; y: number; rowIdx: number; colIdx: number } | null>(null);
  const [hoveredCell, setHoveredCell] = useState<{ ri: number; ci: number } | null>(null);
  // In-table filter
  const [filterText, setFilterText] = useState<Record<number, string>>({});
  const [showFilterBar, setShowFilterBar] = useState(false);
  // Inline header editing
  const [editingHeader, setEditingHeader] = useState<number | null>(null);
  const [editHeaderVal, setEditHeaderVal] = useState('');
  const editCommittedRef = React.useRef(false);
  // Keyboard navigation
  const [kbCell, setKbCell] = useState<{ r: number; c: number } | null>(null);
  const tableRef = React.useRef<HTMLTableElement>(null);

  // Use external annotations if provided (persisted), fallback to local
  const annotations = externalAnnotations ?? localAnnotations;
  const setAnnotations = (fn: (prev: Annotation[]) => Annotation[]) => {
    if (onAnnotationsChange) {
      onAnnotationsChange(fn(annotations));
    } else {
      setLocalAnnotations(fn);
    }
  };

  const handleCellRightClick = (e: React.MouseEvent, ri: number, ci: number) => {
    e.preventDefault();
    setAnnotationPos({ x: e.clientX, y: e.clientY, rowIdx: ri, colIdx: ci });
  };

  const getAnnotation = (ri: number, ci: number) =>
    annotations.find(a => a.rowIdx === ri && a.colIdx === ci);

  const theme = tableConfig?.theme || 'default';
  const tvBase = THEME_VARS[theme] || THEME_VARS.default;
  // Allow user to override background colors
  const tv = {
    ...tvBase,
    ...(tableConfig?.header_bg_color ? { headerBg: tableConfig.header_bg_color } : {}),
    ...(tableConfig?.header_text_color ? { headerColor: tableConfig.header_text_color } : {}),
    ...(tableConfig?.total_bg_color ? { totalBg: tableConfig.total_bg_color } : {}),
  };
  const tableBgColor = tableConfig?.bg_color || undefined;
  const rowLabelBg = tableConfig?.row_bg_color || undefined;
  const zebra = tableConfig?.zebra ?? false;
  const zebraColor = tableConfig?.zebra_color || '#f0f4ff';
  const serialNumber = tableConfig?.serial_number ?? false;
  const serialMode = tableConfig?.serial_number_mode || 'continuous';
  const footnote = tableConfig?.footnote;
  const headerRenames = tableConfig?.header_renames || {};
  const tableNumberLabel = tableConfig?.auto_number && tableConfig.table_number
    ? `${tableConfig.table_number_prefix || 'Table'} ${tableConfig.table_number}: `
    : '';
  const titleBold = tableConfig?.title_bold ?? true;
  const titleItalic = tableConfig?.title_italic ?? false;
  const titleSize = tableConfig?.title_size || 18;
  const titleAlign = tableConfig?.title_align || 'left';
  const cellAlign = tableConfig?.cell_align || 'right';
  const headerAlign = tableConfig?.header_align || 'center';
  const rowLabelAlign = tableConfig?.row_label_align || 'left';

  const handleCellClick = async (ri: number, ci: number) => {
    if (!datasetId || !tableConfig || !result) return;
    if (ri < 0 || !tableConfig.rows?.length) return;
    const row = result.rows[ri];
    if (String(row[0]) === 'Grand Total') return;

    const cellRowValues: Record<string, string> = {};
    tableConfig.rows.forEach((r: string, i: number) => { cellRowValues[r] = String(row[i]); });

    const cellColValues: Record<string, string> = {};
    if (tableConfig.columns?.length && ci >= tableConfig.rows.length) {
      const colHeader = result.headers[ci];
      if (tableConfig.columns.length === 1) cellColValues[tableConfig.columns[0]] = colHeader;
    }

    try {
      const res = await fetch(`${API_BASE}/drilldown`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dataset_id: datasetId, rows: tableConfig.rows,
          columns: tableConfig.columns, values: tableConfig.values,
          filters: tableConfig.filters, cell_row_values: cellRowValues,
          cell_col_values: cellColValues,
        }),
      });
      if (res.ok) setDrillDown(await res.json());
    } catch {}
  };

  const handleHeaderClick = (ci: number) => {
    if (sortCol === ci) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(ci); setSortDir('asc'); }
  };

  let displayRows = result?.rows || [];
  if (result && sortCol !== null && displayRows.length > 0) {
    const lastIsTotal = displayRows.length > 0 && String(displayRows[displayRows.length - 1][0]) === 'Grand Total';
    const dataRows = lastIsTotal ? displayRows.slice(0, -1) : [...displayRows];
    const totalRow = lastIsTotal ? [displayRows[displayRows.length - 1]] : [];
    const sorted = [...dataRows].sort((a, b) => {
      const va = a[sortCol!]; const vb = b[sortCol!];
      if (va == null && vb == null) return 0;
      if (va == null) return 1; if (vb == null) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return sortDir === 'asc' ? va - vb : vb - va;
      return sortDir === 'asc' ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
    });
    displayRows = [...sorted, ...totalRow];
  }

  // Apply in-table text filters
  if (Object.keys(filterText).some(k => filterText[Number(k)])) {
    const lastIsTotal = displayRows.length > 0 && String(displayRows[displayRows.length - 1][0]) === 'Grand Total';
    const totalRow = lastIsTotal ? [displayRows[displayRows.length - 1]] : [];
    const dataRows = lastIsTotal ? displayRows.slice(0, -1) : displayRows;
    const filtered = dataRows.filter(row =>
      Object.entries(filterText).every(([ci, text]) => {
        if (!text) return true;
        const cell = row[Number(ci)];
        return cell != null && String(cell).toLowerCase().includes(text.toLowerCase());
      })
    );
    displayRows = [...filtered, ...totalRow];
  }

  // Keyboard navigation handler
  React.useEffect(() => {
    if (!kbCell) return;
    const handler = (e: KeyboardEvent) => {
      const maxR = displayRows.length - 1;
      const maxC = (result?.headers.length || 1) - 1;
      let { r, c } = kbCell;
      if (e.key === 'ArrowDown') { r = Math.min(r + 1, maxR); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { r = Math.max(r - 1, 0); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { c = Math.min(c + 1, maxC); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { c = Math.max(c - 1, 0); e.preventDefault(); }
      else if (e.key === 'Escape') { setKbCell(null); return; }
      else if (e.key === 'f' && (e.ctrlKey || e.metaKey)) { setShowFilterBar(f => !f); e.preventDefault(); return; }
      else return;
      setKbCell({ r, c });
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [kbCell, displayRows.length, result?.headers.length]);

  // Track group counts for per_group serial numbering
  const getGroupCounters = () => {
    if (!serialNumber || serialMode !== 'per_group' || !tableConfig?.rows?.length) return null;
    const counters: Map<string, number> = new Map();
    const counter: number[] = displayRows.map(row => {
      const groupKey = String(row[0]);
      if (String(row[0]) === 'Grand Total') return 0;
      const curr = (counters.get(groupKey) || 0) + 1;
      counters.set(groupKey, curr);
      return curr;
    });
    return counter;
  };
  const groupCounters = getGroupCounters();

  const getValueFormats = (): NumberFormat[] => {
    if (!tableConfig?.values) return [];
    return tableConfig.values.map(v => {
      const base = v.number_format || {
        style: 'number' as const, decimals: 2, separator: true, prefix: '', suffix: '', currency_symbol: '$',
      };
      // Override with the value field's decimals setting (from ribbon/popover)
      if (v.decimals !== undefined && v.decimals !== null) {
        return { ...base, decimals: v.decimals };
      }
      return base;
    });
  };
  const valFormats = getValueFormats();
  const numRowFields = tableConfig?.rows?.length || 0;

  const formatCellWithFmt = (cell: any, colIdx: number): string => {
    if (cell == null) return '';
    // Apply number format to value columns (after row/col dimension fields)
    const valColOffset = numRowFields;
    const valIdx = colIdx - valColOffset;
    if (typeof cell === 'number' && valIdx >= 0 && valFormats.length > 0) {
      return applyFormat(cell, valFormats[valIdx % valFormats.length]);
    }
    return formatCell(cell);
  };

  // Build conditional formatting lookup: colIdx -> function(value) -> CSSProperties
  // NOTE: This useMemo MUST be called before any early returns to satisfy Rules of Hooks
  const cfAppliers = useMemo(() => {
    const appliers: Map<number, (val: any, rowVals: any[]) => React.CSSProperties> = new Map();
    if (!tableConfig?.conditional_formats || !result) return appliers;
    const headerRenamesLocal = tableConfig?.header_renames || {};
    tableConfig.conditional_formats.forEach(cf => {
      const targetHeader = cf.applies_to;
      const colIdx = result.headers.findIndex(h => (headerRenamesLocal[h] || h) === targetHeader || h === targetHeader);
      if (colIdx < 0) return;
      const colVals = displayRows
        .filter(row => String(row[0]) !== 'Grand Total')
        .map(row => row[colIdx])
        .filter(v => typeof v === 'number');
      if (colVals.length === 0) return;
      const colMin = Math.min(...colVals);
      const colMax = Math.max(...colVals);
      const colRange = colMax - colMin || 1;
      const sorted = [...colVals].sort((a, b) => a - b);

      appliers.set(colIdx, (val: any): React.CSSProperties => {
        if (typeof val !== 'number') return {};
        if (cf.type === 'color_scale') {
          const t = (val - colMin) / colRange;
          const bg = cf.use_mid
            ? interpolateTriColor(cf.min_color || '#ff4444', cf.mid_color || '#ffff00', cf.max_color || '#44bb44', t)
            : interpolateColor(cf.min_color || '#ff4444', cf.max_color || '#44bb44', t);
          const textColor = getContrastColor(bg);
          return { background: bg, color: textColor };
        }
        if (cf.type === 'data_bar') {
          const pct = Math.max(0, Math.min(100, ((val - colMin) / colRange) * 100));
          const barColor = cf.bar_color || '#3b82f6';
          return {
            background: `linear-gradient(to right, ${barColor}55 ${pct}%, transparent ${pct}%)`,
          };
        }
        if (cf.type === 'icon_set') {
          return {};
        }
        if (cf.type === 'rule') {
          const matches = checkRule(val, cf, sorted);
          if (matches) {
            return {
              background: cf.rule_color || '#ffff88',
              fontWeight: cf.rule_bold ? 700 : undefined,
            };
          }
        }
        return {};
      });
    });
    return appliers;
  }, [tableConfig?.conditional_formats, displayRows, result, headerRenames]);

  if (loading) return <div className="live-preview empty"><div className="loading-spinner">Computing table...</div></div>;
  if (error) return <div className="live-preview empty"><div className="error-msg">{error}</div></div>;
  if (!result || result.rows.length === 0) {
    return (
      <div className="live-preview empty">
        <div className="empty-state">
          <div className="empty-icon">TF</div>
          <p>Drag fields into the zones above to build your table</p>
          <p className="hint">Drop numeric OR text fields into Values, categories into Rows or Columns</p>
        </div>
      </div>
    );
  }

  const displayHeaders = result.headers.map(h => headerRenames[h] || h);
  const headerFormats = tableConfig?.header_formats || [];
  const columnWidths = tableConfig?.column_widths || {};
  const rowHeight = tableConfig?.row_height;

  const getHeaderStyle = (h: string, tvOverride: typeof tv): React.CSSProperties => {
    const displayH = headerRenames[h] || h;
    const fmt = headerFormats.find(hf => hf.field === displayH || hf.field === h);
    return {
      background: fmt?.backgroundColor || tvOverride.headerBg,
      color: fmt?.color || tvOverride.headerColor,
      fontWeight: fmt?.bold !== undefined ? (fmt.bold ? 700 : 400) : 700,
      fontStyle: fmt?.italic ? 'italic' : 'normal',
      fontSize: fmt?.size ? fmt.size : undefined,
      fontFamily: fmt?.font || undefined,
      minWidth: columnWidths[displayH] || columnWidths[h] || undefined,
    };
  };

  const getCellTooltip = (ri: number, ci: number, cell: any): string => {
    const ann = getAnnotation(ri, ci);
    if (ann?.text) return ann.text;
    if (!tableConfig) return '';
    // Build tooltip: header name, value type, metric definition if applicable
    const header = result.headers[ci];
    const displayH = headerRenames[header] || header;
    const valField = tableConfig.values?.[ci - (tableConfig.rows?.length || 0)];
    if (valField) {
      const aggLabel = valField.agg ? `Aggregation: ${valField.agg.toUpperCase()}` : '';
      const metricInfo = valField.field.startsWith('__metric__') ? 'Custom metric' : '';
      return [displayH, aggLabel, metricInfo, `Value: ${cell != null ? cell : '—'}`].filter(Boolean).join('\n');
    }
    return displayH;
  };

  // Get icon for icon_set CF rules
  const getIconSetIcon = (colIdx: number, val: any): string => {
    if (!tableConfig?.conditional_formats) return '';
    const cf = tableConfig.conditional_formats.find(c => {
      if (c.type !== 'icon_set') return false;
      const targetHeader = c.applies_to;
      const ci = result!.headers.findIndex(h => (headerRenames[h] || h) === targetHeader || h === targetHeader);
      return ci === colIdx;
    });
    if (!cf || typeof val !== 'number') return '';
    const colVals = displayRows.filter(r => String(r[0]) !== 'Grand Total').map(r => r[colIdx]).filter(v => typeof v === 'number');
    if (!colVals.length) return '';
    const sorted = [...colVals].sort((a, b) => a - b);
    const pct = colVals.length > 2 ? sorted.indexOf(val) / (colVals.length - 1) : (val >= sorted[sorted.length - 1] ? 1 : 0);
    if (cf.icon_set === 'arrows') return pct >= 0.67 ? ' ▲' : pct >= 0.33 ? ' ▶' : ' ▼';
    if (cf.icon_set === 'traffic') return pct >= 0.67 ? ' 🟢' : pct >= 0.33 ? ' 🟡' : ' 🔴';
    if (cf.icon_set === 'rating') return pct >= 0.67 ? ' ★★★' : pct >= 0.33 ? ' ★★' : ' ★';
    if (cf.icon_set === 'flags') return pct < 0.33 ? ' 🚩' : '';
    return '';
  };

  const borderPreset = tableConfig?.border_preset || 'full';
  const frozenCol = tableConfig?.frozen_first_col ?? false;
  const headerWrap = tableConfig?.header_word_wrap ?? false;

  // Column-group separator: track which absolute column indices start a new group
  const groupStartCols = new Set<number>();
  if (result?.column_groups?.has_multi_level) {
    const nRowCols = tableConfig?.rows?.length || 0;
    let offset = nRowCols;
    for (const g of result.column_groups.top) {
      if (offset > nRowCols) groupStartCols.add(offset);
      offset += g.colspan;
    }
  }
  const groupBorderStyle = '2px solid var(--border-strong, #475569)';
  const zoomLevel = tableConfig?.zoom_level || 100;
  const zoomClass = zoomLevel !== 100 ? `zoom-${zoomLevel}` : '';
  const footnotes = tableConfig?.footnotes || [];

  return (
    <div className={`live-preview ${zoomClass}`} data-theme-table={theme} data-table-mode={tableMode} data-border={borderPreset} data-frozen-col={frozenCol ? 'true' : 'false'} data-header-wrap={headerWrap ? 'true' : 'false'}>
      {(title || tableNumberLabel) && (
        <div className="table-title" style={{
          fontWeight: titleBold ? 700 : 400,
          fontStyle: titleItalic ? 'italic' : 'normal',
          fontSize: titleSize,
          textAlign: titleAlign as any,
          color: tableConfig?.title_color || undefined,
        }}>{tableNumberLabel}{title}</div>
      )}
      {subtitle && <div className="table-subtitle">{subtitle}</div>}
      {/* In-table filter bar (Ctrl+F to toggle) */}
      {showFilterBar && result && (
        <div className="table-filter-bar">
          <span className="table-filter-label">Filter:</span>
          {result.headers.map((h, i) => (
            <input key={i} className="table-filter-input" placeholder={displayHeaders[i] || h}
              value={filterText[i] || ''}
              onChange={e => setFilterText(prev => ({ ...prev, [i]: e.target.value }))}
            />
          ))}
          <button className="btn-small" onClick={() => { setFilterText({}); setShowFilterBar(false); }}
            style={{ fontSize: 10, padding: '2px 8px' }}>Clear</button>
        </div>
      )}
      <div className="result-table-wrap">
        <table className="result-table">
          <thead>
            {/* Multi-level header row (top level groups) */}
            {result.column_groups?.has_multi_level && (() => {
              const groups = result.column_groups!.top;
              const nRowCols = tableConfig?.rows?.length || 0;
              return (
                <tr style={{ background: tv.headerBg }}>
                  {serialNumber && <th rowSpan={2} style={{ background: tv.headerBg, color: tv.headerColor, borderColor: tv.borderColor }}>#</th>}
                  {/* Row dimension columns span two rows */}
                  {result.headers.slice(0, nRowCols).map((h, i) => (
                    <th key={i} rowSpan={2} style={{ borderColor: tv.borderColor, ...getHeaderStyle(h, tv) }}>
                      {headerRenames[h] || h}
                    </th>
                  ))}
                  {/* Top-level merged headers */}
                  {groups.map((g, gi) => (
                    <th key={gi} colSpan={g.colspan} style={{ textAlign: 'center', borderColor: tv.borderColor, background: tv.headerBg, color: tv.headerColor, ...(gi > 0 ? { borderLeft: groupBorderStyle } : {}) }}>
                      {g.label}
                    </th>
                  ))}
                </tr>
              );
            })()}
            {/* Main header row */}
            <tr style={{ background: tv.headerBg }}>
              {!result.column_groups?.has_multi_level && serialNumber && (
                <th style={{ background: tv.headerBg, color: tv.headerColor, borderColor: tv.borderColor }}>#</th>
              )}
              {result.headers.map((h, i) => {
                // Skip row-dimension headers if they already have rowSpan=2 above
                if (result.column_groups?.has_multi_level && i < (tableConfig?.rows?.length || 0)) return null;
                const bottomLeaf = result.column_groups?.has_multi_level
                  ? result.column_groups.bottom[i - (tableConfig?.rows?.length || 0)]
                  : undefined;
                // For multi-level, prefer rename on the leaf label, then on result.headers[i], then fall back to leaf or displayHeaders
                const displayH = bottomLeaf
                  ? (headerRenames[bottomLeaf] || headerRenames[h] || bottomLeaf || displayHeaders[i])
                  : displayHeaders[i];
                // The key under which the rename is stored — leaf name for multi-level, full header otherwise
                const renameKey = bottomLeaf || h;
                const isSubtotalCol = displayH === 'Subtotal';
                const commitRename = (rawVal: string) => {
                  if (editCommittedRef.current) return;
                  editCommittedRef.current = true;
                  const next = rawVal.trim();
                  // Commit even when blank — that signals "clear rename and revert to original"
                  if (next !== displayH) {
                    onHeaderRename?.(renameKey, next);
                  }
                  setEditingHeader(null);
                };
                return (
                  <th key={i} onClick={() => handleHeaderClick(i)}
                    onDoubleClick={(e) => {
                      if (onHeaderRename) {
                        e.stopPropagation();
                        editCommittedRef.current = false;
                        setEditingHeader(i);
                        setEditHeaderVal(displayH);
                      }
                    }}
                    style={{ cursor: 'pointer', borderColor: tv.borderColor, textAlign: headerAlign as any, ...(isSubtotalCol ? { fontWeight: 600, background: 'rgba(59,130,246,0.08)' } : {}), ...(groupStartCols.has(i) ? { borderLeft: groupBorderStyle } : {}), ...getHeaderStyle(h, tv) }}>
                    {editingHeader === i ? (
                      <input
                        autoFocus
                        value={editHeaderVal}
                        onChange={e => setEditHeaderVal(e.target.value)}
                        onBlur={() => commitRename(editHeaderVal)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            commitRename(editHeaderVal);
                          } else if (e.key === 'Escape') {
                            e.preventDefault();
                            editCommittedRef.current = true;
                            setEditingHeader(null);
                          }
                        }}
                        onClick={e => e.stopPropagation()}
                        onDoubleClick={e => e.stopPropagation()}
                        onMouseDown={e => e.stopPropagation()}
                        style={{
                          background: 'rgba(0,0,0,0.3)', color: 'inherit', border: '1px solid var(--primary)',
                          borderRadius: 3, padding: '2px 6px', fontSize: 'inherit', fontWeight: 'inherit',
                          width: '100%', minWidth: 60,
                        }}
                      />
                    ) : (
                      <>
                        {displayH}
                        {sortCol === i && <span className="sort-indicator">{sortDir === 'asc' ? ' ▲' : ' ▼'}</span>}
                      </>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {displayRows.map((row, ri) => {
              const isGrandTotal = String(row[0]) === 'Grand Total';
              const isSubtotal = !isGrandTotal && (String(row[0]).includes('Subtotal') || (row.length > 1 && String(row[1]) === 'Subtotal'));
              const zebraStyle = zebra && !isGrandTotal && !isSubtotal && ri % 2 === 1 ? { background: zebraColor } : {};
              const totalStyle = isGrandTotal ? { background: tv.totalBg } : {};
              const serialNum = serialNumber
                ? (isGrandTotal ? '' : (serialMode === 'per_group' && groupCounters ? groupCounters[ri] : ri + 1))
                : null;

              return (
                <tr key={ri}
                  className={`${isGrandTotal ? 'grand-total-row' : ''} ${isSubtotal ? 'subtotal-row' : ''}`}
                  style={{ ...zebraStyle, ...totalStyle, ...(rowHeight ? { height: rowHeight } : {}) }}>
                  {serialNumber && (
                    <td className="serial-num-cell" style={{ borderColor: tv.borderColor }}>
                      {serialNum !== '' ? serialNum : ''}
                    </td>
                  )}
                  {row.map((cell: any, ci: number) => {
                    const cfStyle = (!isGrandTotal && cfAppliers.has(ci)) ? cfAppliers.get(ci)!(cell, row) : {};
                    const iconSuffix = (!isGrandTotal) ? getIconSetIcon(ci, cell) : '';
                    const ann = getAnnotation(ri, ci);
                    const annStyle: React.CSSProperties = ann ? {
                      ...(ann.highlight ? { background: ann.highlight } : {}),
                      ...(ann.bold ? { fontWeight: 700 } : {}),
                      ...(ann.italic ? { fontStyle: 'italic' } : {}),
                    } : {};
                    const isError = cell === '__error__' || (typeof cell === 'string' && cell.startsWith('#ERR'));
                    const isHovered = hoveredCell?.ri === ri && hoveredCell?.ci === ci;
                    const colW = columnWidths[result.headers[ci]] || columnWidths[displayHeaders[ci]];
                    const isKbFocused = kbCell?.r === ri && kbCell?.c === ci;
                    const bottomLabel = result.column_groups?.has_multi_level ? result.column_groups.bottom[ci - (tableConfig?.rows?.length || 0)] : '';
                    const isSubtotalCol = bottomLabel === 'Subtotal';
                    return (
                      <td key={ci}
                        className={`${typeof cell === 'number' ? 'num-cell' : ''} ${datasetId ? 'clickable-cell' : ''} ${ann ? 'annotated-cell' : ''} ${isError ? 'cell-error' : ''} ${isKbFocused ? 'kb-focused' : ''}`}
                        style={{
                          borderColor: tv.borderColor, position: 'relative',
                          textAlign: (ci < numRowFields ? rowLabelAlign : cellAlign) as any,
                          ...(ci < numRowFields && rowLabelBg && !isGrandTotal ? { backgroundColor: rowLabelBg } : {}),
                          ...(ci >= numRowFields && tableBgColor && !isGrandTotal ? { backgroundColor: tableBgColor } : {}),
                          ...(isSubtotalCol && !isGrandTotal ? { fontWeight: 600, backgroundColor: 'rgba(59,130,246,0.04)' } : {}),
                          ...(groupStartCols.has(ci) ? { borderLeft: groupBorderStyle } : {}),
                          ...cfStyle, ...annStyle, ...(colW ? { minWidth: colW } : {}),
                        }}
                        onClick={() => { setKbCell({ r: ri, c: ci }); handleCellClick(ri, ci); }}
                        onContextMenu={e => handleCellRightClick(e, ri, ci)}
                        onMouseEnter={() => setHoveredCell({ ri, ci })}
                        onMouseLeave={() => setHoveredCell(null)}
                      >
                        {ann && ann.color && (
                          <span className="annotation-dot" style={{ background: ann.color }} />
                        )}
                        {isError && <span className="cell-error-indicator" title="Calculation error">⚠</span>}
                        {isError ? <span style={{ color: '#ef4444', fontSize: 11 }}>{cell}</span> : (() => {
                          const txt = formatCellWithFmt(cell, ci);
                          if (typeof cell === 'string' && cell.includes('\n')) {
                            const parts = String(cell).split('\n');
                            return <>{parts[0]}<br/><span className="stat-se">{parts.slice(1).join(' ')}</span></>;
                          }
                          return txt;
                        })()}{iconSuffix}
                        {isHovered && !ann && (
                          <div className="cell-hover-tooltip">
                            {getCellTooltip(ri, ci, cell)}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {result.multi_response_note && (
        <div className="table-footnote" style={{ color: '#f59e0b', borderLeft: '3px solid #f59e0b', paddingLeft: 8, marginTop: 6 }}>
          {result.multi_response_note}
        </div>
      )}
      {footnote && <div className="table-footnote">{footnote}</div>}
      {footnotes.length > 0 && (
        <div className="footnote-area">
          {footnotes.map((fn: { marker: string; text: string }, i: number) => (
            <div key={i} className="footnote-item">
              <span className="fn-marker">{fn.marker}</span>{fn.text}
            </div>
          ))}
        </div>
      )}
      <div className="result-info" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>
          {result.row_count} rows × {result.col_count} cols
          {sortCol !== null && <span> | Sorted by {displayHeaders[sortCol]} {sortDir}</span>}
          {Object.values(filterText).some(t => t) && <span> | Filtered</span>}
        </span>
        <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn-small" onClick={() => setShowFilterBar(f => !f)}
            style={{ fontSize: 9, padding: '1px 6px' }}
            title="Toggle filter bar (Ctrl+F)">
            {showFilterBar ? 'Hide Filter' : 'Filter'}
          </button>
          <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>Ctrl+F filter | Click cell + arrows to navigate</span>
        </span>
      </div>

      {drillDown && <DrillDownModal drillDown={drillDown} onClose={() => setDrillDown(null)} />}
      {/* Annotation context menu */}
      {annotationPos && (
        <AnnotationContextMenu
          pos={annotationPos}
          existing={getAnnotation(annotationPos.rowIdx, annotationPos.colIdx)}
          onSave={a => {
            if (!a.text && !a.highlight && !a.bold && !a.italic) {
              setAnnotations(prev => prev.filter(x => !(x.rowIdx === a.rowIdx && x.colIdx === a.colIdx)));
            } else {
              setAnnotations(prev => [...prev.filter(x => !(x.rowIdx === a.rowIdx && x.colIdx === a.colIdx)), a]);
            }
            setAnnotationPos(null);
          }}

          onClose={() => setAnnotationPos(null)}
        />
      )}
    </div>
  );
}

// --- Conditional Formatting Helpers ---
// ─── Drill-Down Modal with Search, Sort, Filter ───
function DrillDownModal({ drillDown, onClose }: {
  drillDown: { headers: string[]; rows: any[][]; row_count: number; showing: number };
  onClose: () => void;
}) {
  const [search, setSearch] = React.useState('');
  const [ddSortCol, setDdSortCol] = React.useState<number | null>(null);
  const [ddSortDir, setDdSortDir] = React.useState<'asc' | 'desc'>('asc');
  const [colFilters, setColFilters] = React.useState<Record<number, string>>({});
  const [showFilters, setShowFilters] = React.useState(false);

  let rows = drillDown.rows;

  // Global search
  if (search) {
    rows = rows.filter(row =>
      row.some((cell: any) => cell != null && String(cell).toLowerCase().includes(search.toLowerCase()))
    );
  }

  // Per-column filters
  Object.entries(colFilters).forEach(([ci, text]) => {
    if (text) {
      rows = rows.filter(row => {
        const cell = row[Number(ci)];
        return cell != null && String(cell).toLowerCase().includes(text.toLowerCase());
      });
    }
  });

  // Sort
  if (ddSortCol !== null) {
    rows = [...rows].sort((a, b) => {
      const va = a[ddSortCol!]; const vb = b[ddSortCol!];
      if (va == null && vb == null) return 0;
      if (va == null) return 1; if (vb == null) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return ddSortDir === 'asc' ? va - vb : vb - va;
      return ddSortDir === 'asc' ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
    });
  }

  const handleHeaderClick = (ci: number) => {
    if (ddSortCol === ci) setDdSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setDdSortCol(ci); setDdSortDir('asc'); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()} style={{ maxWidth: '90vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: 16 }}>Source Rows ({drillDown.row_count} total, showing {rows.length})</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="text"
              placeholder="Search all columns..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', padding: '5px 10px', borderRadius: 4, fontSize: 12, width: 200 }}
            />
            <button className="btn-small" onClick={() => setShowFilters(f => !f)}
              style={{ fontSize: 11 }}>
              {showFilters ? 'Hide Filters' : 'Column Filters'}
            </button>
            <button className="modal-close" onClick={onClose}>×</button>
          </div>
        </div>
        {showFilters && (
          <div style={{ display: 'flex', gap: 4, padding: '6px 16px', flexWrap: 'wrap', borderBottom: '1px solid var(--border)' }}>
            {drillDown.headers.map((h, i) => (
              <input key={i}
                type="text"
                placeholder={h}
                value={colFilters[i] || ''}
                onChange={e => setColFilters(prev => ({ ...prev, [i]: e.target.value }))}
                style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', padding: '3px 6px', borderRadius: 3, fontSize: 10, width: 100 }}
              />
            ))}
            <button className="btn-small" onClick={() => setColFilters({})} style={{ fontSize: 9, padding: '2px 6px' }}>Clear</button>
          </div>
        )}
        <div className="modal-body" style={{ flex: 1, overflow: 'auto', padding: 0 }}>
          <table className="preview-table" style={{ fontSize: 12 }}>
            <thead>
              <tr>
                {drillDown.headers.map((h, i) => (
                  <th key={i} onClick={() => handleHeaderClick(i)} style={{ cursor: 'pointer', whiteSpace: 'nowrap', padding: '6px 10px' }}>
                    {h}
                    {ddSortCol === i && <span style={{ marginLeft: 4, fontSize: 10 }}>{ddSortDir === 'asc' ? '▲' : '▼'}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell: any, ci: number) => {
                    const cellStr = cell != null ? String(cell) : '';
                    const isMatch = search && cellStr.toLowerCase().includes(search.toLowerCase());
                    return (
                      <td key={ci} style={{ padding: '5px 10px', fontSize: 12, ...(isMatch ? { background: 'rgba(245,158,11,0.15)' } : {}) }}>
                        {cellStr}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={drillDown.headers.length} style={{ textAlign: 'center', padding: 20, color: 'var(--text-dim)' }}>No matching rows</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return [isNaN(r) ? 0 : r, isNaN(g) ? 0 : g, isNaN(b) ? 0 : b];
}
function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}
function interpolateColor(c1: string, c2: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(c1);
  const [r2, g2, b2] = hexToRgb(c2);
  return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}
function interpolateTriColor(c1: string, c2: string, c3: string, t: number): string {
  if (t <= 0.5) return interpolateColor(c1, c2, t * 2);
  return interpolateColor(c2, c3, (t - 0.5) * 2);
}
function getContrastColor(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? '#000000' : '#ffffff';
}
function checkRule(val: number, cf: ConditionalFormat, sorted: number[]): boolean {
  const v1 = cf.rule_value ?? 0;
  const v2 = cf.rule_value2 ?? 0;
  const n = cf.rule_value ?? 1;
  switch (cf.rule_condition) {
    case 'gt': return val > v1;
    case 'gte': return val >= v1;
    case 'lt': return val < v1;
    case 'lte': return val <= v1;
    case 'eq': return val === v1;
    case 'neq': return val !== v1;
    case 'between': return val >= Math.min(v1, v2) && val <= Math.max(v1, v2);
    case 'top_n': return val >= (sorted[Math.max(0, sorted.length - Math.round(n))] ?? Infinity);
    case 'bottom_n': return val <= (sorted[Math.min(Math.round(n) - 1, sorted.length - 1)] ?? -Infinity);
    default: return false;
  }
}

function formatCell(cell: any): string {
  if (cell == null) return '';
  if (typeof cell === 'number') {
    if (Number.isInteger(cell) && Math.abs(cell) < 1e15) return cell.toLocaleString();
    return cell.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  return String(cell);
}

function applyFormat(val: number, fmt: NumberFormat): string {
  const { style, decimals, separator, currency_symbol, prefix, suffix } = fmt;
  const opts: Intl.NumberFormatOptions = {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: separator,
  };
  let formatted = '';
  if (style === 'percent') {
    formatted = val.toLocaleString(undefined, opts) + '%';
  } else if (style === 'currency') {
    formatted = (currency_symbol || '$') + val.toLocaleString(undefined, opts);
  } else {
    formatted = val.toLocaleString(undefined, opts);
  }
  return (prefix || '') + formatted + (suffix || '');
}
