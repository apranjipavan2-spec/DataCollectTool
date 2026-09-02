import React, { useMemo, useState } from 'react';
import { TableConfig } from '../types';

interface Props {
  tables: TableConfig[];
  onMerge: (idA: string, idB: string) => void;
  onClose: () => void;
}

function filterCandidates(candidates: TableConfig[], allTables: TableConfig[], search: string) {
  const q = search.trim().toLowerCase();
  if (!q) return candidates;
  const asNum = Number(q);
  return candidates.filter(t => {
    const idx = allTables.indexOf(t) + 1;
    if (!isNaN(asNum) && asNum === idx) return true;
    const label = (t.title || t.name || '').toLowerCase();
    return label.includes(q);
  });
}

function TablePicker({
  label, candidates, allTables, value, onChange,
}: {
  label: string;
  candidates: TableConfig[];
  allTables: TableConfig[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => filterCandidates(candidates, allTables, search), [candidates, allTables, search]);

  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
      <label style={{ fontSize: 11, color: 'var(--text-dim)', display: 'block', marginBottom: 4 }}>{label}</label>
      <input
        className="search-input"
        placeholder="Search by title or # ..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        style={{ marginBottom: 6 }}
      />
      <div className="table-nav-list" style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', maxHeight: 260, minHeight: 260 }}>
        {filtered.length === 0 && (
          <div className="table-nav-item table-nav-empty">No matching tables</div>
        )}
        {filtered.map(t => {
          const idx = allTables.indexOf(t) + 1;
          const selected = t.id === value;
          return (
            <div
              key={t.id}
              className={`table-nav-item ${selected ? 'table-nav-selected active' : ''}`}
              onClick={() => onChange(t.id)}
              title={t.title || t.name}
            >
              <span className={`table-nav-check ${selected ? 'checked' : ''}`}>{selected ? '✓' : ''}</span>
              <span className="table-nav-num">{idx}</span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t.title || t.name}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function MergeTablesModal({ tables, onMerge, onClose }: Props) {
  // Merged tables can't themselves be a merge source, to keep row-alignment simple.
  const candidates = tables.filter(t => !t.merge_config);
  const [idA, setIdA] = useState(candidates[0]?.id || '');
  const [idB, setIdB] = useState(candidates[1]?.id || '');

  const canMerge = idA && idB && idA !== idB;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 760, width: '92vw' }}>
        <div className="modal-header">
          <h2>Merge Tables Side by Side</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body" style={{ padding: '14px 20px' }}>
          {candidates.length < 2 ? (
            <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>
              You need at least two tables (that aren't themselves merges) to merge. Create another table first.
            </p>
          ) : (
          <>
          <p style={{ fontSize: 11, color: 'var(--text-dim)', margin: '0 0 12px' }}>
            Creates a new table combining Table A's columns with Table B's columns, side by side,
            matched row-by-row on Table A's row labels. Both source tables are left untouched.
            Pick by clicking, or search by table title or by its # number.
          </p>
          <div style={{ display: 'flex', gap: 16 }}>
            <TablePicker
              label="Table A (row order is kept)"
              candidates={candidates}
              allTables={tables}
              value={idA}
              onChange={setIdA}
            />
            <TablePicker
              label="Table B (columns appended)"
              candidates={candidates}
              allTables={tables}
              value={idB}
              onChange={setIdB}
            />
          </div>
          {idA === idB && idA && (
            <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 8 }}>Pick two different tables.</div>
          )}
          </>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!canMerge}
            onClick={() => { onMerge(idA, idB); onClose(); }}>
            Merge
          </button>
        </div>
      </div>
    </div>
  );
}
