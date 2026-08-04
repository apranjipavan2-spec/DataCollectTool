import React, { useState } from 'react';
import { TableConfig } from '../types';

interface Props {
  tables: TableConfig[];
  onMerge: (idA: string, idB: string) => void;
  onClose: () => void;
}

export function MergeTablesModal({ tables, onMerge, onClose }: Props) {
  // Merged tables can't themselves be a merge source, to keep row-alignment simple.
  const candidates = tables.filter(t => !t.merge_config);
  const [idA, setIdA] = useState(candidates[0]?.id || '');
  const [idB, setIdB] = useState(candidates[1]?.id || '');

  const canMerge = idA && idB && idA !== idB;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>
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
          </p>
          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 11, color: 'var(--text-dim)', display: 'block', marginBottom: 4 }}>Table A (row order is kept)</label>
            <select className="fdrop-select" value={idA} onChange={e => setIdA(e.target.value)} style={{ width: '100%' }}>
              {candidates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div style={{ marginBottom: 4 }}>
            <label style={{ fontSize: 11, color: 'var(--text-dim)', display: 'block', marginBottom: 4 }}>Table B (columns appended)</label>
            <select className="fdrop-select" value={idB} onChange={e => setIdB(e.target.value)} style={{ width: '100%' }}>
              {candidates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
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
