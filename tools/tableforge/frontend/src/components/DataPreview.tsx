import React, { useEffect, useRef, useState } from 'react';
import { DatasetMeta, ColumnInfo } from '../types';
import { loadSheet, modifyDataset, unionSheets, sheetsInfo } from '../api';

interface Props {
  dataset: DatasetMeta;
  onProceed: () => void;
  onDatasetUpdate: (updates: { row_count: number; columns: ColumnInfo[]; preview: Record<string, any>[] }) => void;
  focusRow?: number | null;
  focusColumn?: string | null;
}

export function DataPreview({ dataset, onProceed, onDatasetUpdate, focusRow, focusColumn }: Props) {
  const [activeSheet, setActiveSheet] = useState(dataset.sheets[0] || '');
  const [loading, setLoading] = useState(false);
  const [renames, setRenames] = useState<Record<string, string>>({});
  const [excludedCols, setExcludedCols] = useState<Set<string>>(new Set());
  const [excludedRows, setExcludedRows] = useState<Set<number>>(new Set());
  const [headerRow, setHeaderRow] = useState<number | null>(null);
  const [editingCol, setEditingCol] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [unionSheetNames, setUnionSheetNames] = useState<Set<string>>(new Set());
  const [showUnion, setShowUnion] = useState(false);
  const [unionMode, setUnionMode] = useState<'concat' | 'join_inner' | 'join_outer'>('concat');
  const [commonCols, setCommonCols] = useState<string[]>([]);
  const [selectedJoinCols, setSelectedJoinCols] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const typeColors: Record<string, string> = {
    numeric: '#3b82f6',
    text: '#22c55e',
    date: '#f59e0b',
    boolean: '#a855f7',
  };

  const handleSheetChange = async (sheetName: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await loadSheet(dataset.dataset_id, sheetName);
      setActiveSheet(sheetName);
      setRenames({});
      setExcludedCols(new Set());
      setExcludedRows(new Set());
      onDatasetUpdate(res);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleApplyModifications = async () => {
    if (Object.keys(renames).length === 0 && excludedCols.size === 0 && excludedRows.size === 0 && headerRow === null) return;
    setLoading(true);
    setError(null);
    try {
      const res = await modifyDataset({
        dataset_id: dataset.dataset_id,
        renames: Object.keys(renames).length > 0 ? renames : undefined,
        exclude_columns: excludedCols.size > 0 ? Array.from(excludedCols) : undefined,
        exclude_rows: excludedRows.size > 0 ? Array.from(excludedRows) : undefined,
        header_row: headerRow,
      });
      onDatasetUpdate(res);
      setRenames({});
      setExcludedCols(new Set());
      setExcludedRows(new Set());
      setHeaderRow(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUnionSheets = async () => {
    if (unionSheetNames.size < 2) return;
    setLoading(true);
    setError(null);
    try {
      const joinOn = unionMode !== 'concat' && selectedJoinCols.size > 0
        ? Array.from(selectedJoinCols)
        : undefined;
      const res = await unionSheets(
        dataset.dataset_id, Array.from(unionSheetNames), unionMode, joinOn
      );
      onDatasetUpdate(res);
      setShowUnion(false);
      setUnionSheetNames(new Set());
      setSelectedJoinCols(new Set());
      setCommonCols([]);
      setUnionMode('concat');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // Auto-detect common columns whenever the sheet selection changes (debounced lightly via effect)
  const detectCommonColumns = async (sheets: string[]) => {
    if (sheets.length < 2) { setCommonCols([]); return; }
    try {
      const info = await sheetsInfo(dataset.dataset_id, sheets);
      setCommonCols(info.common_columns);
      // Pre-select all common columns as the default join keys
      setSelectedJoinCols(new Set(info.common_columns));
    } catch (e) {
      setCommonCols([]);
    }
  };

  const startRename = (colName: string) => {
    setEditingCol(colName);
    setRenameValue(renames[colName] || colName);
  };

  const commitRename = () => {
    if (editingCol && renameValue && renameValue !== editingCol) {
      setRenames(prev => ({ ...prev, [editingCol]: renameValue }));
    } else if (editingCol && renameValue === editingCol) {
      setRenames(prev => { const n = { ...prev }; delete n[editingCol]; return n; });
    }
    setEditingCol(null);
  };

  const toggleExcludeCol = (col: string) => {
    setExcludedCols(prev => {
      const next = new Set(prev);
      if (next.has(col)) next.delete(col); else next.add(col);
      return next;
    });
  };

  const toggleExcludeRow = (rowIdx: number) => {
    setExcludedRows(prev => {
      const next = new Set(prev);
      if (next.has(rowIdx)) next.delete(rowIdx); else next.add(rowIdx);
      return next;
    });
  };

  const hasModifications = Object.keys(renames).length > 0 || excludedCols.size > 0 || excludedRows.size > 0 || headerRow !== null;

  const focusRowRef = useRef<HTMLTableRowElement | null>(null);
  const [focusFlash, setFocusFlash] = useState(false);
  useEffect(() => {
    if (focusRow == null) return;
    const t = setTimeout(() => {
      focusRowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setFocusFlash(true);
      const off = setTimeout(() => setFocusFlash(false), 2200);
      return () => clearTimeout(off);
    }, 60);
    return () => clearTimeout(t);
  }, [focusRow, dataset.dataset_id]);
  const previewLen = dataset.preview.length;
  const focusBeyondPreview = focusRow != null && focusRow >= Math.min(50, previewLen);

  return (
    <div className="data-preview-screen">
      {loading && <div className="progress-overlay"><div className="progress-spinner" /><span>Processing...</span></div>}

      <div className="data-preview-header">
        <div>
          <h2>Data Preview — {dataset.filename}</h2>
          <p>{dataset.row_count.toLocaleString()} rows × {dataset.columns.length} columns</p>
        </div>
        <div className="preview-header-actions">
          {hasModifications && (
            <button className="btn-warning" onClick={handleApplyModifications}>
              Apply Changes ({Object.keys(renames).length} renames, {excludedCols.size} cols excluded, {excludedRows.size} rows excluded{headerRow !== null ? ', header row ' + headerRow : ''})
            </button>
          )}
          <button className="btn-primary" onClick={onProceed}>
            ✓ Proceed to Table Builder
          </button>
        </div>
      </div>

      {error && <div className="preview-error">{error}</div>}

      {focusRow != null && (
        <div style={{ margin: '0 16px 8px', padding: '8px 12px', background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.4)', borderRadius: 6, fontSize: 12, color: 'var(--text)' }}>
          {focusBeyondPreview ? (
            <>Row <strong>{focusRow + 1}</strong>{focusColumn ? <> (column <strong>{focusColumn}</strong>)</> : null} is beyond the first 50 preview rows. Showing the preview window — full data was used in dry-run.</>
          ) : (
            <>Jumped to row <strong>{focusRow + 1}</strong>{focusColumn ? <> (column <strong>{focusColumn}</strong>)</> : null} from Convert column.</>
          )}
        </div>
      )}

      {/* Sheet Selector + Union */}
      {dataset.sheets.length > 1 && (
        <div className="sheet-toolbar">
          <div className="sheet-selector">
            <label>Sheet:</label>
            <select value={activeSheet} onChange={e => handleSheetChange(e.target.value)}>
              {dataset.sheets.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <button className="btn-small" onClick={() => setShowUnion(!showUnion)}>
            {showUnion ? 'Cancel Union' : 'Union Sheets'}
          </button>
          {showUnion && (
            <div className="union-panel">
              <span>Select sheets to combine:</span>
              {dataset.sheets.map(s => (
                <label key={s} className="union-checkbox">
                  <input type="checkbox" checked={unionSheetNames.has(s)}
                    onChange={() => {
                      const next = new Set(unionSheetNames);
                      if (next.has(s)) next.delete(s); else next.add(s);
                      setUnionSheetNames(next);
                      detectCommonColumns(Array.from(next));
                    }} />
                  {s}
                </label>
              ))}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
                <label style={{ fontSize: 11 }}>Mode:</label>
                <select value={unionMode}
                  onChange={e => setUnionMode(e.target.value as any)}
                  style={{ fontSize: 11, padding: '2px 6px' }}>
                  <option value="concat">Concat (stack rows)</option>
                  <option value="join_inner">Auto-join inner (only matched rows)</option>
                  <option value="join_outer">Auto-join outer (all rows)</option>
                </select>
              </div>
              {unionMode !== 'concat' && unionSheetNames.size >= 2 && (
                <div style={{ marginTop: 6 }}>
                  {commonCols.length === 0 ? (
                    <div style={{ fontSize: 11, color: '#ef4444' }}>
                      ⚠ No common columns found — fall back to concat or choose different sheets.
                    </div>
                  ) : (
                    <>
                      <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 4 }}>
                        Join on (detected {commonCols.length} common column{commonCols.length !== 1 ? 's' : ''}):
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {commonCols.map(c => (
                          <label key={c} className="union-checkbox" style={{ fontSize: 11 }}>
                            <input type="checkbox" checked={selectedJoinCols.has(c)}
                              onChange={() => {
                                const next = new Set(selectedJoinCols);
                                if (next.has(c)) next.delete(c); else next.add(c);
                                setSelectedJoinCols(next);
                              }} />
                            {c}
                          </label>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
              <button className="btn-small btn-primary" onClick={handleUnionSheets}
                disabled={unionSheetNames.size < 2 ||
                  (unionMode !== 'concat' && selectedJoinCols.size === 0)}>
                Combine ({unionSheetNames.size} sheets · {unionMode})
              </button>
            </div>
          )}
        </div>
      )}

      {/* Header Row Override */}
      <div className="preview-controls">
        <label className="header-row-control">
          Header Row:
          <input type="number" min={0} max={20} value={headerRow ?? 0}
            onChange={e => setHeaderRow(e.target.value === '0' ? null : parseInt(e.target.value))}
            title="Set which row to use as column headers (0 = default first row)" />
        </label>
      </div>

      {/* Column Summary with rename/exclude */}
      <div className="column-summary">
        {dataset.columns.map(col => (
          <div key={col.name}
            className={`col-badge ${excludedCols.has(col.name) ? 'col-excluded' : ''}`}
            title={`${col.stats.unique} unique, ${col.stats.nulls} nulls — Click name to rename, × to exclude`}>
            <span className="col-type-dot" style={{ background: typeColors[col.type] }} />
            {editingCol === col.name ? (
              <input className="col-rename-input" autoFocus value={renameValue}
                onChange={e => setRenameValue(e.target.value)}
                onBlur={commitRename}
                onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setEditingCol(null); }} />
            ) : (
              <span className="col-badge-name" onClick={() => startRename(col.name)}
                style={{ cursor: 'pointer', textDecoration: renames[col.name] ? 'line-through' : 'none' }}>
                {renames[col.name] || col.name}
              </span>
            )}
            <span className="col-badge-type">{col.type}</span>
            <button className="col-exclude-btn" onClick={() => toggleExcludeCol(col.name)}
              title={excludedCols.has(col.name) ? 'Include column' : 'Exclude column'}>
              {excludedCols.has(col.name) ? '↩' : '×'}
            </button>
          </div>
        ))}
      </div>

      {/* Data Table with row exclusion */}
      <div className="preview-table-wrap">
        <table className="preview-table">
          <thead>
            <tr>
              <th>#</th>
              <th className="row-exclude-header">✓</th>
              {dataset.columns.filter(c => !excludedCols.has(c.name)).map(c => (
                <th key={c.name} style={{ borderBottom: `3px solid ${typeColors[c.type]}` }}>
                  {renames[c.name] || c.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dataset.preview.slice(0, 50).map((row, i) => {
              const isFocus = focusRow === i;
              return (
                <tr key={i}
                  ref={isFocus ? focusRowRef : undefined}
                  className={excludedRows.has(i) ? 'row-excluded' : ''}
                  style={isFocus && focusFlash
                    ? { background: 'rgba(250,204,21,0.22)', outline: '2px solid #facc15', transition: 'background 0.5s' }
                    : undefined}>
                  <td className="row-num">{i + 1}</td>
                  <td className="row-exclude-cell">
                    <input type="checkbox" checked={!excludedRows.has(i)}
                      onChange={() => toggleExcludeRow(i)} title="Include/exclude this row" />
                  </td>
                  {dataset.columns.filter(c => !excludedCols.has(c.name)).map(c => {
                    const isFocusCell = isFocus && focusColumn === c.name;
                    return (
                      <td key={c.name}
                        style={isFocusCell && focusFlash
                          ? { background: 'rgba(239,68,68,0.28)', fontWeight: 700 }
                          : undefined}>
                        {row[c.name] != null ? String(row[c.name]) : ''}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
