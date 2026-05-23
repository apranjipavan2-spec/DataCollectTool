import React, { useEffect, useState, useCallback } from 'react';
import { TableConfig } from '../types';
import { getColumnValues } from '../api';

interface Props {
  datasetId: string;
  table: TableConfig;
  allColumns: string[];
  onUpdate: (update: Partial<TableConfig>) => void;
}

// Tiny in-memory cache keyed by `${datasetId}::${column}` so toggling slicers
// doesn't re-fetch values on every render.
const valueCache = new Map<string, string[]>();

export function SubgroupSlicer({ datasetId, table, allColumns, onUpdate }: Props) {
  const slicers = table.slicers || [];
  const filters = table.filters || {};
  const [valuesByCol, setValuesByCol] = useState<Record<string, string[]>>({});
  const [picking, setPicking] = useState(false);

  const fetchValues = useCallback(async (col: string) => {
    const key = `${datasetId}::${col}`;
    if (valueCache.has(key)) {
      setValuesByCol(prev => ({ ...prev, [col]: valueCache.get(key)! }));
      return;
    }
    try {
      const res = await getColumnValues(datasetId, col);
      const vals = (res.values || []).map((v: any) => String(v));
      valueCache.set(key, vals);
      setValuesByCol(prev => ({ ...prev, [col]: vals }));
    } catch {
      // silent — column may not exist or backend may be down
    }
  }, [datasetId]);

  useEffect(() => {
    slicers.forEach(col => { if (!valuesByCol[col]) fetchValues(col); });
  }, [slicers, valuesByCol, fetchValues]);

  if (slicers.length === 0 && !picking) {
    return (
      <div className="slicer-toolbar slicer-empty">
        <button className="slicer-add-btn" onClick={() => setPicking(true)}
          title="Add a sub-group slicer for quick filtering">
          🎚 Add Slicer
        </button>
      </div>
    );
  }

  const addSlicer = (col: string) => {
    if (!slicers.includes(col)) onUpdate({ slicers: [...slicers, col] });
    setPicking(false);
  };
  const removeSlicer = (col: string) => {
    const nextFilters = { ...filters };
    delete nextFilters[col];
    onUpdate({ slicers: slicers.filter(c => c !== col), filters: nextFilters });
  };
  const toggleValue = (col: string, val: string) => {
    const cur = filters[col] || [];
    const next = cur.includes(val) ? cur.filter(v => v !== val) : [...cur, val];
    const nextFilters = { ...filters };
    if (next.length === 0) delete nextFilters[col]; else nextFilters[col] = next;
    onUpdate({ filters: nextFilters });
  };
  const clearCol = (col: string) => {
    const nextFilters = { ...filters };
    delete nextFilters[col];
    onUpdate({ filters: nextFilters });
  };

  const available = allColumns.filter(c => !slicers.includes(c));

  return (
    <div className="slicer-toolbar">
      {slicers.map(col => {
        const vals = valuesByCol[col] || [];
        const active = filters[col] || [];
        return (
          <div key={col} className="slicer-row">
            <div className="slicer-row-head">
              <span className="slicer-col-name">🎚 {col}</span>
              {active.length > 0 && (
                <button className="slicer-clear" onClick={() => clearCol(col)} title="Clear this slicer">clear</button>
              )}
              <button className="slicer-remove" onClick={() => removeSlicer(col)} title="Remove slicer">×</button>
            </div>
            <div className="slicer-chips">
              {vals.length === 0 ? (
                <span className="slicer-loading">loading…</span>
              ) : vals.map(v => {
                const on = active.includes(v);
                return (
                  <button key={v}
                    className={`slicer-chip ${on ? 'on' : ''}`}
                    onClick={() => toggleValue(col, v)}
                    title={on ? 'Click to remove' : 'Click to filter'}>
                    {v || '(blank)'}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      {picking ? (
        <div className="slicer-row slicer-picker">
          <select className="slicer-picker-select" autoFocus
            onChange={e => { if (e.target.value) addSlicer(e.target.value); }}
            onBlur={() => setPicking(false)}>
            <option value="">-- pick column --</option>
            {available.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <button className="slicer-remove" onClick={() => setPicking(false)}>×</button>
        </div>
      ) : slicers.length > 0 && (
        <button className="slicer-add-btn slicer-add-btn-inline" onClick={() => setPicking(true)}
          title="Add another sub-group slicer">+ Slicer</button>
      )}
    </div>
  );
}
