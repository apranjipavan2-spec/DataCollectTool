import React, { useState, useMemo } from 'react';
import { ColumnInfo } from '../types';

const TYPE_ICON: Record<string, string> = {
  numeric: '#', text: 'Aa', date: 'D', boolean: '01', multi_choice: 'M',
};
const TYPE_COLOR: Record<string, string> = {
  numeric: '#3b82f6', text: '#22c55e', date: '#f59e0b', boolean: '#a855f7', multi_choice: '#ec4899',
};

interface ColPickerProps {
  allColumns: ColumnInfo[];
  available: ColumnInfo[];
  selected: string[];
  onToggle: (name: string) => void;
  label?: string;
  height?: number;
  selectionHint?: React.ReactNode;
}

export function ColPicker({ allColumns, available, selected, onToggle, label, height = 200, selectionHint }: ColPickerProps) {
  const [search, setSearch] = useState('');

  const indexMap = useMemo(
    () => Object.fromEntries(allColumns.map((c, i) => [c.name, i + 1])),
    [allColumns],
  );

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return available;
    return available.filter(c =>
      c.name.toLowerCase().includes(q) || String(indexMap[c.name] ?? '').includes(q)
    );
  }, [available, search, indexMap]);

  return (
    <div>
      {label && (
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{label}</span>
          {selected.length > 0 && (
            <span style={{ fontSize: 10, color: 'var(--text-dim)', fontWeight: 400 }}>
              {selected.length} selected
            </span>
          )}
        </div>
      )}
      <input
        type="text"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search by name or #number…"
        style={{
          width: '100%', padding: '5px 8px', marginBottom: 6, fontSize: 11,
          background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 4, color: 'inherit', boxSizing: 'border-box',
        }}
      />
      <div style={{
        maxHeight: height, overflowY: 'auto',
        border: '1px solid var(--border, #334155)', borderRadius: 4, padding: 4,
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 2,
      }}>
        {filtered.map(col => {
          const idx = indexMap[col.name] ?? 0;
          const isSelected = selected.includes(col.name);
          const selOrder = selected.indexOf(col.name);
          return (
            <label key={col.name} style={{
              display: 'flex', alignItems: 'center', gap: 5, padding: '4px 6px',
              borderRadius: 3, cursor: 'pointer', fontSize: 11,
              background: isSelected ? 'rgba(59,130,246,0.12)' : 'transparent',
              border: isSelected ? '1px solid rgba(59,130,246,0.35)' : '1px solid transparent',
              transition: 'background 0.1s',
              userSelect: 'none',
            }}>
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => onToggle(col.name)}
                style={{ margin: 0, accentColor: '#3b82f6', flexShrink: 0, width: 12, height: 12 }}
              />
              <span style={{
                fontSize: 9, color: 'rgba(255,255,255,0.35)', fontFamily: 'monospace',
                minWidth: 24, textAlign: 'right', flexShrink: 0,
              }}>
                #{idx}
              </span>
              <span style={{
                fontSize: 8, fontWeight: 700, padding: '1px 3px',
                color: TYPE_COLOR[col.type] || '#888',
                background: `${TYPE_COLOR[col.type] || '#888'}22`,
                borderRadius: 2, flexShrink: 0,
              }}>
                {TYPE_ICON[col.type] || '?'}
              </span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                {col.name}
              </span>
              {isSelected && selOrder >= 0 && (
                <span style={{
                  fontSize: 8, color: '#93c5fd', flexShrink: 0,
                  background: 'rgba(59,130,246,0.25)', borderRadius: 2, padding: '0 3px',
                }}>[{selOrder + 1}]</span>
              )}
            </label>
          );
        })}
        {filtered.length === 0 && (
          <div style={{ fontSize: 11, color: 'var(--text-dim)', padding: '8px', gridColumn: '1/-1', textAlign: 'center' }}>
            No columns match
          </div>
        )}
      </div>
      {selectionHint && <div style={{ marginTop: 5 }}>{selectionHint}</div>}
      {selected.length > 0 && (
        <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4, lineHeight: 1.4 }}>
          Selected: {selected.map(c => `#${indexMap[c] ?? '?'} ${c}`).join(' → ')}
        </div>
      )}
    </div>
  );
}

/** Render <option> elements with #N index prefix for use inside <select> */
export function ColOptions({
  allColumns,
  available,
  placeholder,
}: {
  allColumns: ColumnInfo[];
  available: ColumnInfo[] | string[];
  placeholder?: string;
}) {
  const indexMap = useMemo(
    () => Object.fromEntries(allColumns.map((c, i) => [c.name, i + 1])),
    [allColumns],
  );
  const names = available.map(c => (typeof c === 'string' ? c : c.name));
  return (
    <>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {names.map(c => (
        <option key={c} value={c}>
          #{indexMap[c] ?? '?'}  {c}
        </option>
      ))}
    </>
  );
}
