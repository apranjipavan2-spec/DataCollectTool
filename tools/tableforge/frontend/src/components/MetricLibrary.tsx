import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE } from '../api';

interface LibraryMetric {
  id: string;
  name: string;
  metric_type: string;
  definition: Record<string, any>;
  tags: string[];
  category: string;
  description: string;
  usage_count: number;
  created_at: string;
}

interface Props {
  datasetId?: string;
  onImported?: (metricName: string) => void;
  onClose: () => void;
  // Metric to save: if provided, show save-to-library UI first
  metricToSave?: { name: string; metric_type: string; definition: Record<string, any> } | null;
}

export function MetricLibrary({ datasetId, onImported, onClose, metricToSave }: Props) {
  const [metrics, setMetrics] = useState<LibraryMetric[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterTag, setFilterTag] = useState('');
  const [importing, setImporting] = useState<string | null>(null);
  const [resultMsg, setResultMsg] = useState('');
  const [error, setError] = useState('');

  // Save-to-library state
  const [showSaveForm, setShowSaveForm] = useState(!!metricToSave);
  const [saveName, setSaveName] = useState(metricToSave?.name || '');
  const [saveCategory, setSaveCategory] = useState('General');
  const [saveDesc, setSaveDesc] = useState('');
  const [saveTags, setSaveTags] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (filterCategory) params.set('category', filterCategory);
      if (filterTag) params.set('tag', filterTag);
      const res = await fetch(`${API_BASE}/library/metrics?${params}`);
      if (res.ok) {
        const data = await res.json();
        setMetrics(data.metrics || []);
        setCategories(data.categories || []);
        setAllTags(data.all_tags || []);
      }
    } catch {
      setError('Failed to load library');
    } finally {
      setLoading(false);
    }
  }, [search, filterCategory, filterTag]);

  useEffect(() => { fetchMetrics(); }, [fetchMetrics]);

  const handleImport = async (metricId: string, metricName: string) => {
    if (!datasetId) { setError('No dataset loaded'); return; }
    setImporting(metricId);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/library/metrics/${metricId}/import?dataset_id=${datasetId}`, { method: 'POST' });
      if (res.ok) {
        setResultMsg(`Imported "${metricName}" into project`);
        if (onImported) onImported(metricName);
        fetchMetrics(); // refresh usage counts
      } else {
        setError('Import failed');
      }
    } catch {
      setError('Import failed');
    } finally {
      setImporting(null);
    }
  };

  const handleDelete = async (metricId: string, metricName: string) => {
    if (!window.confirm(`Remove "${metricName}" from library?`)) return;
    try {
      const res = await fetch(`${API_BASE}/library/metrics/${metricId}`, { method: 'DELETE' });
      if (res.ok) { setResultMsg(`Deleted "${metricName}"`); fetchMetrics(); }
    } catch {
      setError('Delete failed');
    }
  };

  const handleSaveToLibrary = async () => {
    if (!saveName.trim() || !metricToSave) return;
    setSaving(true); setError('');
    try {
      const res = await fetch(`${API_BASE}/library/metrics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: saveName,
          metric_type: metricToSave.metric_type,
          definition: metricToSave.definition,
          category: saveCategory,
          description: saveDesc,
          tags: saveTags.split(',').map(t => t.trim()).filter(Boolean),
        }),
      });
      if (res.ok) {
        setResultMsg(`Saved "${saveName}" to library`);
        setShowSaveForm(false);
        fetchMetrics();
      } else {
        setError('Save failed');
      }
    } catch {
      setError('Save failed');
    } finally {
      setSaving(false);
    }
  };

  const CATEGORY_COLORS: Record<string, string> = {
    General: '#64748b', Finance: '#0ea5e9', Marketing: '#a855f7',
    Operations: '#22c55e', HR: '#f97316', Custom: '#ec4899',
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>📚 Global Metric Library</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          {showSaveForm && metricToSave && (
            <div className="library-save-form">
              <h3>Save "{metricToSave.name}" to Library</h3>
              <div className="form-row">
                <div className="form-group" style={{ flex: 2 }}>
                  <label>Name</label>
                  <input type="text" value={saveName} onChange={e => setSaveName(e.target.value)} />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Category</label>
                  <select value={saveCategory} onChange={e => setSaveCategory(e.target.value)}>
                    {['General', 'Finance', 'Marketing', 'Operations', 'HR', 'Custom'].map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label>Description</label>
                <input type="text" value={saveDesc} onChange={e => setSaveDesc(e.target.value)}
                  placeholder="Brief description of what this metric calculates" />
              </div>
              <div className="form-group">
                <label>Tags (comma-separated)</label>
                <input type="text" value={saveTags} onChange={e => setSaveTags(e.target.value)}
                  placeholder="e.g. growth, kpi, sales" />
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="btn-primary" onClick={handleSaveToLibrary} disabled={saving || !saveName.trim()}>
                  {saving ? 'Saving...' : '💾 Save to Library'}
                </button>
                <button className="btn-secondary" onClick={() => setShowSaveForm(false)}>Skip</button>
              </div>
              <hr style={{ borderColor: 'var(--border)', margin: '16px 0' }} />
            </div>
          )}

          {/* Search & Filters */}
          <div className="library-filters">
            <input
              type="text" className="library-search" placeholder="Search metrics..."
              value={search} onChange={e => setSearch(e.target.value)}
            />
            <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)}>
              <option value="">All Categories</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={filterTag} onChange={e => setFilterTag(e.target.value)}>
              <option value="">All Tags</option>
              {allTags.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <button className="btn-secondary" onClick={() => setShowSaveForm(!showSaveForm)}>
              + Save New
            </button>
          </div>

          {resultMsg && <div className="success-msg" style={{ marginBottom: 8 }}>{resultMsg}</div>}
          {error && <div className="error-msg" style={{ marginBottom: 8 }}>{error}</div>}

          {loading ? (
            <div className="loading-spinner">Loading library...</div>
          ) : metrics.length === 0 ? (
            <div className="empty-state" style={{ padding: 32 }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
              <p>No metrics in library yet.</p>
              <p className="hint">Save metrics from Metric Builder → Save to Library</p>
            </div>
          ) : (
            <div className="library-grid">
              {metrics.map(m => (
                <div key={m.id} className="library-card">
                  <div className="library-card-header">
                    <span className="library-card-name">{m.name}</span>
                    <span className="library-card-type">{m.metric_type}</span>
                  </div>
                  {m.description && (
                    <div className="library-card-desc">{m.description}</div>
                  )}
                  <div className="library-card-meta">
                    <span className="library-category-badge"
                      style={{ background: CATEGORY_COLORS[m.category] || '#64748b' }}>
                      {m.category}
                    </span>
                    {m.tags.map(t => (
                      <span key={t} className="library-tag">{t}</span>
                    ))}
                  </div>
                  <div className="library-card-footer">
                    <span className="library-usage">Used {m.usage_count} times</span>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {datasetId && (
                        <button
                          className="btn-primary"
                          style={{ padding: '3px 10px', fontSize: 11 }}
                          onClick={() => handleImport(m.id, m.name)}
                          disabled={importing === m.id}
                        >
                          {importing === m.id ? '...' : '↓ Import'}
                        </button>
                      )}
                      <button
                        className="btn-secondary"
                        style={{ padding: '3px 8px', fontSize: 11 }}
                        onClick={() => handleDelete(m.id, m.name)}
                      >
                        🗑
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>
            {metrics.length} metric{metrics.length !== 1 ? 's' : ''} in library
          </span>
          <button className="btn-primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
