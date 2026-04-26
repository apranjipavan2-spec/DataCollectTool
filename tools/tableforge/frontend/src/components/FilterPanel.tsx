import React, { useState, useEffect, useRef, useCallback } from 'react';
import { TableConfig } from '../types';
import { getColumnValues } from '../api';

interface Props {
  table: TableConfig;
  datasetId: string;
  onFilterChange: (field: string, values: string[]) => void;
  onRemoveFilter?: (field: string) => void;
  onClose?: () => void;
}

export function FilterPanel({ table, datasetId, onFilterChange, onRemoveFilter, onClose }: Props) {
  const filterFields = Object.keys(table.filters);
  const [availableValues, setAvailableValues] = useState<Record<string, string[]>>({});
  const [loadErrors, setLoadErrors] = useState<Record<string, string>>({});
  const [searchTerms, setSearchTerms] = useState<Record<string, string>>({});
  const [expandedField, setExpandedField] = useState<string | null>(filterFields[0] || null);
  const overlayRef = useRef<HTMLDivElement>(null);

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

  const toggleValue = useCallback((field: string, value: string) => {
    const current = table.filters[field] || [];
    if (current.includes(value)) {
      onFilterChange(field, current.filter(v => v !== value));
    } else {
      onFilterChange(field, [...current, value]);
    }
  }, [table.filters, onFilterChange]);

  const selectAll = useCallback((field: string) => {
    onFilterChange(field, [...(availableValues[field] || [])]);
  }, [availableValues, onFilterChange]);

  const clearAll = useCallback((field: string) => {
    onFilterChange(field, []);
  }, [onFilterChange]);

  if (filterFields.length === 0) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
          <div className="modal-header">
            <h2>Filters</h2>
            <button className="modal-close" onClick={onClose}>×</button>
          </div>
          <div className="modal-body" style={{ padding: 30, textAlign: 'center' }}>
            <p style={{ color: 'var(--text-dim)', marginBottom: 8 }}>No filter fields added yet.</p>
            <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>Drag columns to the Filters zone to add filters.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose} ref={overlayRef}>
      <div className="filter-dialog" onClick={e => e.stopPropagation()}>
        <div className="filter-dialog-header">
          <h2>Filters</h2>
          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            {filterFields.length} field(s)
          </span>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="filter-dialog-body">
          {/* Filter field tabs on the left */}
          <div className="filter-field-list">
            {filterFields.map(field => {
              const selected = (table.filters[field] || []).length;
              const total = (availableValues[field] || []).length;
              return (
                <button key={field}
                  className={`filter-field-btn ${expandedField === field ? 'active' : ''}`}
                  onClick={() => setExpandedField(field)}>
                  <span className="filter-field-name" title={field}>{field}</span>
                  <span className="filter-field-badge">
                    {selected > 0 ? `${selected}/${total}` : 'All'}
                  </span>
                  {onRemoveFilter && (
                    <span className="filter-field-remove" onClick={e => { e.stopPropagation(); onRemoveFilter(field); }}
                      title="Remove filter">×</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Values panel on the right */}
          {expandedField && (
            <div className="filter-values-panel">
              <div className="filter-values-toolbar">
                <input
                  type="text"
                  className="filter-search"
                  placeholder={`Search ${expandedField}...`}
                  value={searchTerms[expandedField] || ''}
                  onChange={e => setSearchTerms(prev => ({ ...prev, [expandedField]: e.target.value }))}
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
                    const checked = (table.filters[expandedField] || []).includes(v);
                    return (
                      <label key={v} className={`filter-checkbox-item ${checked ? 'checked' : ''}`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleValue(expandedField, v)}
                        />
                        <span className="filter-value-text">{v}</span>
                      </label>
                    );
                  })}
                {(availableValues[expandedField] || []).length === 0 && (
                  <div style={{ padding: 16, fontSize: 12, textAlign: 'center',
                    color: loadErrors[expandedField] ? 'var(--danger, #f87171)' : 'var(--text-dim)' }}>
                    {loadErrors[expandedField]
                      ? `⚠ ${loadErrors[expandedField]}`
                      : 'Loading values...'}
                  </div>
                )}
              </div>

              <div className="filter-values-footer">
                <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                  {(table.filters[expandedField] || []).length} of {(availableValues[expandedField] || []).length} selected
                  {(table.filters[expandedField] || []).length === 0 && ' (no filter applied — all values shown)'}
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="filter-dialog-footer">
          <button className="btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
