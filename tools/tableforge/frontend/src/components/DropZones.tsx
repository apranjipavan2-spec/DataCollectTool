import React, { useState, useRef, useEffect } from 'react';
import { TableConfig, ColumnInfo, DropZoneType, ValueField } from '../types';

interface Props {
  table: TableConfig;
  columns: ColumnInfo[];
  draggedField: string | null;
  onDrop: (zone: DropZoneType, field: string) => void;
  onRemove: (zone: DropZoneType, field: string) => void;
  onAggChange: (field: string, agg: string) => void;
  onValueFieldUpdate: (field: string, updates: Partial<ValueField>) => void;
  onReorder: (zone: DropZoneType, fromIdx: number, toIdx: number) => void;
  onMoveField: (fromZone: DropZoneType, toZone: DropZoneType, fieldName: string) => void;
  onDateGroupSuggest?: (fieldName: string) => void;
  onOpenFilters?: () => void;
}

// Summarize Values By — actual aggregation functions
const SUMMARIZE_AGGS = [
  { group: 'Basic', items: ['sum', 'count', 'average', 'min', 'max'] },
  { group: 'Text / Any', items: ['count_distinct', 'first', 'last'] },
  { group: 'Statistical', items: ['median', 'std', 'var'] },
];

const AGG_LABELS: Record<string, string> = {
  sum: 'Sum', count: 'Count', average: 'Average', min: 'Min', max: 'Max',
  count_distinct: 'Count Distinct', first: 'First Value', last: 'Last Value',
  median: 'Median', std: 'Std Dev', var: 'Variance',
};

// Show Values As — display transformations (applied after aggregation)
const SHOW_AS_OPTIONS = [
  { value: 'normal', label: 'No Calculation', group: 'Basic' },
  { value: 'pct_grand', label: '% of Grand Total', group: 'Percentage' },
  { value: 'pct_row', label: '% of Row Total', group: 'Percentage' },
  { value: 'pct_col', label: '% of Column Total', group: 'Percentage' },
  { value: 'pct_parent_row', label: '% of Parent Row', group: 'Percentage' },
  { value: 'pct_parent_col', label: '% of Parent Col', group: 'Percentage' },
  { value: 'running_total', label: 'Running Total', group: 'Sequential' },
  { value: 'rank_asc', label: 'Rank (Smallest to Largest)', group: 'Sequential' },
  { value: 'rank_desc', label: 'Rank (Largest to Smallest)', group: 'Sequential' },
  { value: 'index', label: 'Index (Base=100)', group: 'Sequential' },
  { value: 'pct_point_change', label: 'Percentage Point Change', group: 'Change' },
  { value: 'change_vs_prev', label: '% Change vs Previous', group: 'Change' },
  { value: 'z_score', label: 'Z-Score (Standardized)', group: 'Statistical' },
  { value: 'percentile_rank', label: 'Percentile Rank', group: 'Statistical' },
  { value: 'cagr', label: 'CAGR (Compound Growth)', group: 'Statistical' },
];

const SHOW_AS_LABELS: Record<string, string> = {};
SHOW_AS_OPTIONS.forEach(o => { SHOW_AS_LABELS[o.value] = o.label; });

const zoneConfig: { key: DropZoneType; label: string; icon: string; color: string }[] = [
  { key: 'rows', label: 'Rows', icon: '☰', color: '#3b82f6' },
  { key: 'columns', label: 'Columns', icon: '⊞', color: '#8b5cf6' },
  { key: 'values', label: 'Values', icon: 'Σ', color: '#ef4444' },
  { key: 'filters', label: 'Filters', icon: '⊘', color: '#f59e0b' },
];

interface ContextMenu {
  x: number;
  y: number;
  zone: DropZoneType;
  field: string;
}

export function DropZones({ table, columns, draggedField, onDrop, onRemove, onAggChange, onValueFieldUpdate, onReorder, onMoveField, onDateGroupSuggest, onOpenFilters }: Props) {
  const [dragOver, setDragOver] = useState<DropZoneType | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [reorderDrag, setReorderDrag] = useState<{ zone: DropZoneType; idx: number } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState<string | null>(null); // field name of open settings popover
  const contextRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      setContextMenu(null);
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setSettingsOpen(null);
      }
    };
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, []);

  const getFieldsForZone = (zone: DropZoneType): string[] => {
    if (zone === 'values') return table.values.map(v => v.field);
    if (zone === 'filters') return Object.keys(table.filters);
    return table[zone];
  };

  const handleContextMenu = (e: React.MouseEvent, zone: DropZoneType, field: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, zone, field });
  };

  const handleChipDragStart = (e: React.DragEvent, zone: DropZoneType, idx: number) => {
    e.stopPropagation();
    setReorderDrag({ zone, idx });
    e.dataTransfer.setData('reorder', `${zone}:${idx}`);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleChipDrop = (e: React.DragEvent, zone: DropZoneType, toIdx: number) => {
    e.preventDefault();
    e.stopPropagation();
    const reorderData = e.dataTransfer.getData('reorder');
    if (reorderData) {
      const [fromZone, fromIdxStr] = reorderData.split(':');
      const fromIdx = parseInt(fromIdxStr);
      if (fromZone === zone) {
        onReorder(zone, fromIdx, toIdx);
      } else {
        const field = e.dataTransfer.getData('text/plain');
        if (field) onMoveField(fromZone as DropZoneType, zone, field);
      }
    }
    setReorderDrag(null);
    setDragOver(null);
  };

  const handleZoneDrop = (e: React.DragEvent, zone: DropZoneType) => {
    e.preventDefault();
    setDragOver(null);
    const reorderData = e.dataTransfer.getData('reorder');
    if (reorderData) {
      const [fromZone, fromIdxStr] = reorderData.split(':');
      const fromIdx = parseInt(fromIdxStr);
      const fields = getFieldsForZone(zone);
      if (fromZone === zone) {
        onReorder(zone, fromIdx, fields.length);
      } else {
        const field = getFieldsForZone(fromZone as DropZoneType)[fromIdx];
        if (field) onMoveField(fromZone as DropZoneType, zone, field);
      }
      setReorderDrag(null);
      return;
    }
    const f = e.dataTransfer.getData('text/plain');
    if (!f) return;
    onDrop(zone, f);
    if ((zone === 'rows' || zone === 'columns') && onDateGroupSuggest) {
      const col = columns.find(c => c.name === f);
      if (col?.type === 'date') {
        onDateGroupSuggest(f);
      }
    }
  };

  // Build compact label for value chip
  const getValueChipLabel = (vc: ValueField): string => {
    const aggLabel = AGG_LABELS[vc.agg] || vc.agg;
    const showAs = vc.show_as || 'normal';
    const combo = vc.combo_show_as;
    if (combo && combo !== 'normal') {
      const comboLabel = SHOW_AS_LABELS[combo] || combo;
      return `${aggLabel} + ${comboLabel}`;
    }
    if (showAs !== 'normal') {
      const showLabel = SHOW_AS_LABELS[showAs] || showAs;
      return `${aggLabel} as ${showLabel}`;
    }
    return aggLabel;
  };

  return (
    <>
      <div className="drop-zones">
        {zoneConfig.map(({ key, label, icon, color }) => {
          const fields = getFieldsForZone(key);
          const isOver = dragOver === key;
          return (
            <div key={key}
              className={`drop-zone ${isOver ? 'zone-drag-over' : ''}`}
              style={{ borderColor: isOver ? color : undefined }}
              onDragOver={e => { e.preventDefault(); setDragOver(key); }}
              onDragLeave={() => setDragOver(null)}
              onDrop={e => handleZoneDrop(e, key)}
            >
              <div className="zone-header" style={{ color }}>
                <span className="zone-icon">{icon}</span> {label}
                <span className="zone-count">{fields.length > 0 ? `(${fields.length})` : ''}</span>
                {key === 'filters' && fields.length > 0 && onOpenFilters && (
                  <button className="zone-filter-btn" onClick={onOpenFilters} title="Open filter settings">
                    ⚙
                  </button>
                )}
              </div>
              <div className="zone-chips">
                {fields.length === 0 && <span className="zone-placeholder">Drop fields here</span>}
                {fields.map((field, idx) => {
                  const valConfig = key === 'values' ? table.values.find(v => v.field === field) : null;
                  const isDragging = reorderDrag?.zone === key && reorderDrag?.idx === idx;
                  return (
                    <div key={field}
                      className={`chip ${isDragging ? 'chip-dragging' : ''}`}
                      style={{ borderLeftColor: color }}
                      draggable
                      onDragStart={e => {
                        handleChipDragStart(e, key, idx);
                        e.dataTransfer.setData('text/plain', field);
                      }}
                      onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
                      onDrop={e => handleChipDrop(e, key, idx)}
                      onContextMenu={e => handleContextMenu(e, key, field)}
                    >
                      <span className="chip-drag-handle" title="Drag to reorder">⠿</span>
                      <span className="chip-name">{field}</span>
                      {valConfig && (
                        <>
                          <select className="agg-select" value={valConfig.agg}
                            title="Summarize Values By"
                            onChange={e => onAggChange(field, e.target.value)}
                            onClick={e => e.stopPropagation()}>
                            {SUMMARIZE_AGGS.map(g => (
                              <optgroup key={g.group} label={g.group}>
                                {g.items.map(a => (
                                  <option key={a} value={a}>{AGG_LABELS[a]}</option>
                                ))}
                              </optgroup>
                            ))}
                          </select>
                          <button className="chip-settings-btn"
                            title="Value Field Settings"
                            onClick={e => { e.stopPropagation(); setSettingsOpen(settingsOpen === field ? null : field); }}>
                            &#9881;
                          </button>
                        </>
                      )}
                      <button className="chip-remove" onClick={() => onRemove(key, field)}>×</button>

                      {/* Value Field Settings Popover */}
                      {valConfig && settingsOpen === field && (
                        <div ref={settingsRef}
                          className="value-settings-popover"
                          onClick={e => e.stopPropagation()}>
                          <div className="vsp-header">Value Field Settings: {field}</div>

                          <div className="vsp-section">
                            <label className="vsp-label">Show Values As</label>
                            <select className="vsp-select" value={valConfig.show_as || 'normal'}
                              onChange={e => onValueFieldUpdate(field, { show_as: e.target.value })}>
                              {(() => {
                                const groups = new Map<string, typeof SHOW_AS_OPTIONS>();
                                SHOW_AS_OPTIONS.forEach(o => {
                                  const g = o.group || 'Basic';
                                  if (!groups.has(g)) groups.set(g, []);
                                  groups.get(g)!.push(o);
                                });
                                return Array.from(groups.entries()).map(([group, opts]) => (
                                  <optgroup key={group} label={group}>
                                    {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                  </optgroup>
                                ));
                              })()}
                            </select>
                          </div>

                          <div className="vsp-section">
                            <label className="vsp-label">Decimal Places</label>
                            <select className="vsp-select vsp-small" value={valConfig.decimals ?? 2}
                              onChange={e => onValueFieldUpdate(field, { decimals: parseInt(e.target.value) })}>
                              {[0, 1, 2, 3, 4, 5, 6].map(n => (
                                <option key={n} value={n}>{n}</option>
                              ))}
                            </select>
                          </div>

                          <div className="vsp-section">
                            <label className="vsp-label">Combination Display</label>
                            <select className="vsp-select" value={valConfig.combo_show_as || 'normal'}
                              onChange={e => onValueFieldUpdate(field, { combo_show_as: e.target.value })}>
                              <option value="normal">None</option>
                              <option value="pct_grand">Value (% of Total)</option>
                              <option value="pct_row">Value (% of Row)</option>
                              <option value="pct_col">Value (% of Column)</option>
                              <option value="pct_parent_row">Value (% of Parent Row)</option>
                              <option value="pct_parent_col">Value (% of Parent Col)</option>
                            </select>
                          </div>

                          <div className="vsp-section" style={{ borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 4 }}>
                            <label className="vsp-label" style={{ fontWeight: 600 }}>Statistical Display</label>
                            <label className="vsp-check"><input type="checkbox" checked={valConfig.show_mean_sd ?? false}
                              onChange={e => onValueFieldUpdate(field, { show_mean_sd: e.target.checked })} /> Mean ± SD format</label>
                            <label className="vsp-check"><input type="checkbox" checked={valConfig.show_se ?? false}
                              onChange={e => onValueFieldUpdate(field, { show_se: e.target.checked })} /> Std Error in (parentheses)</label>
                            <label className="vsp-check"><input type="checkbox" checked={valConfig.show_ci ?? false}
                              onChange={e => onValueFieldUpdate(field, { show_ci: e.target.checked })} /> Confidence Interval</label>
                            {valConfig.show_ci && (
                              <select className="vsp-select vsp-small" value={valConfig.ci_level ?? 0.95}
                                onChange={e => onValueFieldUpdate(field, { ci_level: parseFloat(e.target.value) })}>
                                <option value={0.90}>90% CI</option>
                                <option value={0.95}>95% CI</option>
                                <option value={0.99}>99% CI</option>
                              </select>
                            )}
                            <label className="vsp-check"><input type="checkbox" checked={valConfig.show_stars ?? false}
                              onChange={e => onValueFieldUpdate(field, { show_stars: e.target.checked })} /> Significance stars</label>
                            <label className="vsp-check"><input type="checkbox" checked={valConfig.show_n ?? false}
                              onChange={e => onValueFieldUpdate(field, { show_n: e.target.checked })} /> Show N (sample size)</label>
                            <label className="vsp-check"><input type="checkbox" checked={valConfig.change_arrows ?? false}
                              onChange={e => onValueFieldUpdate(field, { change_arrows: e.target.checked })} /> Change direction arrows ▲▼</label>
                          </div>

                          <div className="vsp-section">
                            <label className="vsp-label">Missing Data Symbol</label>
                            <select className="vsp-select" value={valConfig.missing_indicator || ''}
                              onChange={e => onValueFieldUpdate(field, { missing_indicator: e.target.value })}>
                              <option value="">Default (empty)</option>
                              <option value="—">— (em-dash)</option>
                              <option value="n/a">n/a</option>
                              <option value=".">. (period)</option>
                              <option value="N/A">N/A</option>
                              <option value="..">.. (double dot)</option>
                            </select>
                          </div>

                          <div className="vsp-preview">
                            {getValueChipLabel(valConfig)}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Right-click context menu */}
      {contextMenu && (
        <div ref={contextRef}
          className="context-menu"
          style={{ position: 'fixed', left: contextMenu.x, top: contextMenu.y, zIndex: 1000 }}
          onClick={e => e.stopPropagation()}
        >
          <div className="ctx-header">{contextMenu.field}</div>
          <button className="ctx-item ctx-danger" onClick={() => {
            onRemove(contextMenu.zone, contextMenu.field);
            setContextMenu(null);
          }}>Remove from {contextMenu.zone}</button>
          <div className="ctx-divider" />
          <div className="ctx-section">Move to...</div>
          {zoneConfig.filter(z => z.key !== contextMenu.zone).map(z => (
            <button key={z.key} className="ctx-item" onClick={() => {
              onMoveField(contextMenu.zone, z.key, contextMenu.field);
              setContextMenu(null);
            }}>{z.icon} {z.label}</button>
          ))}
          {contextMenu.zone === 'values' && (
            <>
              <div className="ctx-divider" />
              <div className="ctx-section">Summarize By...</div>
              {['sum', 'count', 'average', 'min', 'max'].map(agg => (
                <button key={agg} className="ctx-item" onClick={() => {
                  onAggChange(contextMenu.field, agg);
                  setContextMenu(null);
                }}>{AGG_LABELS[agg]}</button>
              ))}
              <div className="ctx-divider" />
              <div className="ctx-section">Show Values As...</div>
              {['normal', 'pct_grand', 'pct_row', 'pct_col'].map(sa => (
                <button key={sa} className="ctx-item" onClick={() => {
                  onValueFieldUpdate(contextMenu.field, { show_as: sa });
                  setContextMenu(null);
                }}>{SHOW_AS_LABELS[sa] || 'No Calculation'}</button>
              ))}
            </>
          )}
        </div>
      )}
    </>
  );
}
