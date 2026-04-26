import React, { useState, useEffect, useCallback } from 'react';
import { ColumnInfo } from '../types';
import { getColumnValues } from '../api';

interface Props {
  filters: Record<string, string[]>;   // current project-level filters
  datasetId: string;
  allColumns: ColumnInfo[];
  onChange: (filters: Record<string, string[]>) => void;
  onClose: () => void;
}

export function ProjectFilterPanel({ filters, datasetId, allColumns, onChange, onClose }: Props) {
  const filterFields = Object.keys(filters);
  const [availableValues, setAvailableValues] = useState<Record<string, string[]>>({});
  const [loadErrors, setLoadErrors] = useState<Record<string, string>>({});
  const [searchTerms, setSearchTerms] = useState<Record<string, string>>({});
  const [expandedField, setExpandedField] = useState<string | null>(filterFields[0] || null);
  const [addingField, setAddingField] = useState(false);
  const [pickField, setPickField] = useState('');

  // Fetch values for all current filter fields
  useEffect(() => {
    filterFields.forEach(async field => {
      if (!availableValues[field] && !loadErrors[field]) {
        try {
          const res = await getColumnValues(datasetId, field);
          setAvailableValues(prev => ({ ...prev, [field]: res.values }));
        } catch (err: any) {
          setLoadErrors(prev => ({ ...prev, [field]: err?.message || 'Failed to load values' }));
        }
      }
    });
  }, [filterFields.join(','), datasetId]);

  const addField = useCallback(async (field: string) => {
    if (!field || field in filters) return;
    onChange({ ...filters, [field]: [] });
    setExpandedField(field);
    setAddingField(false);
    setPickField('');
    if (!availableValues[field]) {
      try {
        const res = await getColumnValues(datasetId, field);
        setAvailableValues(prev => ({ ...prev, [field]: res.values }));
      } catch (err: any) {
        setLoadErrors(prev => ({ ...prev, [field]: err?.message || 'Failed to load values' }));
      }
    }
  }, [filters, availableValues, datasetId, onChange]);

  const removeField = useCallback((field: string) => {
    const next = { ...filters };
    delete next[field];
    onChange(next);
    if (expandedField === field) {
      const remaining = Object.keys(next);
      setExpandedField(remaining[0] || null);
    }
  }, [filters, expandedField, onChange]);

  const toggleValue = useCallback((field: string, value: string) => {
    const current = filters[field] || [];
    const next = current.includes(value)
      ? current.filter(v => v !== value)
      : [...current, value];
    onChange({ ...filters, [field]: next });
  }, [filters, onChange]);

  const selectAll = useCallback((field: string) => {
    onChange({ ...filters, [field]: [...(availableValues[field] || [])] });
  }, [filters, availableValues, onChange]);

  const clearAll = useCallback((field: string) => {
    onChange({ ...filters, [field]: [] });
  }, [filters, onChange]);

  const availableToAdd = allColumns.filter(c => !(c.name in filters));
  const activeFilterCount = Object.values(filters).filter(v => v.length > 0).length;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="filter-dialog" onClick={e => e.stopPropagation()} style={{ maxWidth: 700 }}>

        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="filter-dialog-header">
          <h2>Project Filters</h2>
          <span style={{
            fontSize: 11, color: 'var(--primary)',
            background: 'rgba(59,130,246,0.12)',
            padding: '2px 9px', borderRadius: 4,
            border: '1px solid rgba(59,130,246,0.3)',
            flexShrink: 0,
          }}>
            🌐 All tables
          </span>
          {activeFilterCount > 0 && (
            <span style={{ fontSize: 11, color: 'var(--text-dim)', flexShrink: 0 }}>
              {activeFilterCount} active filter{activeFilterCount !== 1 ? 's' : ''}
            </span>
          )}
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        {/* ── Info banner ────────────────────────────────────────── */}
        <div style={{
          padding: '7px 18px', borderBottom: '1px solid var(--border)',
          background: 'rgba(59,130,246,0.05)',
        }}>
          <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: 0 }}>
            Project filters apply to <strong>every table</strong> simultaneously. When the same column is
            filtered at both levels, only rows matching <em>both</em> selections are shown.
          </p>
        </div>

        {/* ── Body ───────────────────────────────────────────────── */}
        <div className="filter-dialog-body">

          {/* Left: field list */}
          <div className="filter-field-list">
            {filterFields.map(field => {
              const selected = (filters[field] || []).length;
              const total = (availableValues[field] || []).length;
              return (
                <button key={field}
                  className={`filter-field-btn ${expandedField === field ? 'active' : ''}`}
                  onClick={() => setExpandedField(field)}>
                  <span className="filter-field-name" title={field}>{field}</span>
                  <span className="filter-field-badge">
                    {selected > 0 ? `${selected}/${total}` : 'All'}
                  </span>
                  <span className="filter-field-remove"
                    onClick={e => { e.stopPropagation(); removeField(field); }}
                    title="Remove this project filter">×</span>
                </button>
              );
            })}

            {/* Empty state */}
            {filterFields.length === 0 && !addingField && (
              <div style={{ padding: '14px 10px', fontSize: 12, color: 'var(--text-dim)', textAlign: 'center', lineHeight: 1.5 }}>
                No project filters.<br />
                <span style={{ fontSize: 11, opacity: 0.75 }}>
                  Add a field below to filter all tables at once.
                </span>
              </div>
            )}

            {/* Add field control */}
            {availableToAdd.length > 0 && (
              addingField ? (
                <div className="filter-add-field">
                  <select autoFocus value={pickField}
                    onChange={e => setPickField(e.target.value)}
                    className="filter-field-select">
                    <option value="">— pick column —</option>
                    {availableToAdd.map(c => (
                      <option key={c.name} value={c.name}>{c.name}</option>
                    ))}
                  </select>
                  <div className="filter-add-btns">
                    <button className="btn-primary" style={{ fontSize: 11, padding: '3px 10px' }}
                      disabled={!pickField} onClick={() => addField(pickField)}>
                      Add
                    </button>
                    <button className="btn-secondary" style={{ fontSize: 11, padding: '3px 8px' }}
                      onClick={() => { setAddingField(false); setPickField(''); }}>
                      ✕
                    </button>
                  </div>
                </div>
              ) : (
                <button className="filter-add-btn" onClick={() => setAddingField(true)}>
                  + Add Filter Field
                </button>
              )
            )}
          </div>

          {/* Right: value checklist */}
          {expandedField ? (
            <div className="filter-values-panel">
              <div className="filter-values-toolbar">
                <input
                  type="text"
                  className="filter-search"
                  placeholder={`Search ${expandedField}…`}
                  value={searchTerms[expandedField] || ''}
                  onChange={e => setSearchTerms(prev => ({ ...prev, [expandedField!]: e.target.value }))}
                />
                <div className="filter-actions">
                  <button className="filter-action-btn" onClick={() => selectAll(expandedField)}>Select All</button>
                  <button className="filter-action-btn" onClick={() => clearAll(expandedField)}>Clear</button>
                </div>
              </div>

              <div className="filter-checkbox-list">
                {(availableValues[expandedField] || [])
                  .filter(v => {
                    const search = (searchTerms[expandedField] || '').toLowerCase();
                    return !search || v.toLowerCase().includes(search);
                  })
                  .map(v => {
                    const checked = (filters[expandedField] || []).includes(v);
                    return (
                      <label key={v} className={`filter-checkbox-item ${checked ? 'checked' : ''}`}>
                        <input type="checkbox" checked={checked}
                          onChange={() => toggleValue(expandedField, v)} />
                        <span className="filter-value-text">{v}</span>
                      </label>
                    );
                  })}
                {(availableValues[expandedField] || []).length === 0 && (
                  <div style={{
                    padding: 16, fontSize: 12, textAlign: 'center',
                    color: loadErrors[expandedField] ? 'var(--danger, #f87171)' : 'var(--text-dim)',
                  }}>
                    {loadErrors[expandedField]
                      ? `⚠ ${loadErrors[expandedField]}`
                      : 'Loading values…'}
                  </div>
                )}
              </div>

              <div className="filter-values-footer">
                <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                  {(filters[expandedField] || []).length} of {(availableValues[expandedField] || []).length} selected
                  {(filters[expandedField] || []).length === 0 && ' (no filter — all values shown)'}
                </span>
              </div>
            </div>
          ) : (
            filterFields.length > 0 && (
              <div style={{
                flex: 1, display: 'flex', alignItems: 'center',
                justifyContent: 'center', color: 'var(--text-dim)', fontSize: 13,
              }}>
                Select a field on the left to configure its filter
              </div>
            )
          )}
        </div>

        {/* ── Footer ─────────────────────────────────────────────── */}
        <div className="filter-dialog-footer">
          {activeFilterCount > 0 && (
            <button
              className="btn-secondary"
              style={{ marginRight: 'auto', color: '#f87171' }}
              onClick={() => onChange({})}>
              Clear All Project Filters
            </button>
          )}
          <button className="btn-secondary" onClick={onClose}>Close</button>
        </div>

      </div>
    </div>
  );
}
