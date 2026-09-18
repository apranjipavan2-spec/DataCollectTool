import React, { useState } from 'react';
import { TableConfig } from '../types';

interface Props {
  table: TableConfig;
  onAdd: (label: string, inputType: 'text' | 'number' | 'dropdown', options?: string[]) => void;
  onRemove: (columnId: string) => void;
  onClose: () => void;
}

export function ManualColumnModal({ table, onAdd, onRemove, onClose }: Props) {
  const [label, setLabel] = useState('');
  const [inputType, setInputType] = useState<'text' | 'number' | 'dropdown'>('text');
  const [optionsText, setOptionsText] = useState('');

  const handleAdd = () => {
    const trimmed = label.trim();
    if (!trimmed) return;
    const options = inputType === 'dropdown'
      ? optionsText.split(',').map(o => o.trim()).filter(Boolean)
      : undefined;
    onAdd(trimmed, inputType, options);
    setLabel('');
    setOptionsText('');
    setInputType('text');
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <div className="modal-header">
          <h2>Manual Columns</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body" style={{ padding: '14px 20px' }}>
          <p style={{ fontSize: 11, color: 'var(--text-dim)', margin: '0 0 12px' }}>
            Add an extra column to <strong>{table.name}</strong> where you type or pick a value per row —
            it's not computed from the dataset, and stays with the table when you save the project.
          </p>

          {(table.manual_columns || []).length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', marginBottom: 6, textTransform: 'uppercase' }}>
                Existing manual columns
              </div>
              {(table.manual_columns || []).map(col => (
                <div key={col.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 12 }}>
                  <span style={{ flex: 1 }}>{col.label} <span style={{ opacity: 0.6 }}>({col.input_type})</span></span>
                  <button className="fdrop-reset-btn" title="Remove column" onClick={() => onRemove(col.id)}>✕</button>
                </div>
              ))}
            </div>
          )}

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <div className="fdrop-row" style={{ gap: 8, marginBottom: 8 }}>
              <label style={{ fontSize: 11, color: 'var(--text-dim)', display: 'block', marginBottom: 4 }}>Column label</label>
              <input type="text" className="fdrop-input" value={label} placeholder="e.g. Reviewer Notes"
                onChange={e => setLabel(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && inputType !== 'dropdown') handleAdd(); }}
                style={{ width: '100%' }} />
            </div>
            <div style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 11, color: 'var(--text-dim)', display: 'block', marginBottom: 4 }}>Input type</label>
              <select className="fdrop-select" value={inputType} onChange={e => setInputType(e.target.value as any)} style={{ width: '100%' }}>
                <option value="text">Text</option>
                <option value="number">Number</option>
                <option value="dropdown">Dropdown</option>
              </select>
            </div>
            {inputType === 'dropdown' && (
              <div style={{ marginBottom: 8 }}>
                <label style={{ fontSize: 11, color: 'var(--text-dim)', display: 'block', marginBottom: 4 }}>Options (comma-separated)</label>
                <input type="text" className="fdrop-input" value={optionsText} placeholder="e.g. Verified, Pending, Flagged"
                  onChange={e => setOptionsText(e.target.value)} style={{ width: '100%' }} />
              </div>
            )}
            <button className="btn-primary" style={{ marginTop: 4 }}
              disabled={!label.trim() || (inputType === 'dropdown' && !optionsText.trim())}
              onClick={handleAdd}>
              + Add Column
            </button>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
