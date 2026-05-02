import React, { useState, useEffect } from 'react';
import { TableConfig } from '../types';
import { rollbackProject, fgSaveProject, fgListUserProjects, API_BASE } from '../api';

interface ProjectEntry {
  name: string;
  path: string;
  created: string;
  version_count?: number;
  source_file?: {
    filename?: string;
    cache_path?: string;
    row_count?: number;
    col_count?: number;
    dataset_id?: string;
  } | null;
}

interface FgContext { fgUrl: string; token: string; programId?: string }

interface Props {
  currentTables: TableConfig[];
  currentAnnotationsMap?: Record<string, any[]>;
  currentComparisonState?: any;
  currentProjectFilters?: Record<string, string[]>;
  onLoad: (tables: TableConfig[], annotationsMap?: Record<string, any[]>, extra?: Record<string, any>) => void;
  onClose: () => void;
  currentFilename?: string;
  currentDatasetId?: string;
  currentRowCount?: number;
  currentColCount?: number;
  fgContext?: FgContext | null;
}

export function ProjectManager({ currentTables, currentAnnotationsMap = {}, currentComparisonState, currentProjectFilters, onLoad, onClose, currentFilename, currentDatasetId, currentRowCount, currentColCount, fgContext }: Props) {
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saveName, setSaveName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [activeTab, setActiveTab] = useState<'recent' | 'save' | 'gallery' | 'batch'>('recent');
  const [expandedVersions, setExpandedVersions] = useState<Record<string, any[]>>({});
  const [batchProjectPath, setBatchProjectPath] = useState('');
  const [batchFiles, setBatchFiles] = useState<string[]>([]);
  const [batchFormat, setBatchFormat] = useState('xlsx');
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchResults, setBatchResults] = useState<any[]>([]);
  const [projectPassword, setProjectPassword] = useState('');
  const [saveMode, setSaveMode] = useState<'server' | 'download' | 'fg'>('server');

  // Auto-association: check if there's a last project for the current file
  const lastProjectName = currentFilename ? localStorage.getItem(`tableforge_last_project_${currentFilename}`) : null;
  const lastProject = lastProjectName ? projects.find(p => p.name === lastProjectName) : null;

  const TEMPLATES = [
    { name: 'Sales Summary', desc: 'Monthly sales by region and product', icon: '📊', config: { tables: [{ id: '1', name: 'Sales by Region', rows: [], columns: [], values: [], filters: {}, grand_total: true, subtotals: false, missing_data: '', title: 'Sales Summary', subtitle: '' }] } },
    { name: 'Financial Report', desc: 'P&L with comparisons', icon: '💰', config: { tables: [{ id: '1', name: 'P&L', rows: [], columns: [], values: [], filters: {}, grand_total: true, subtotals: true, missing_data: '0', title: 'Financial Report', subtitle: '' }] } },
    { name: 'HR Analytics', desc: 'Headcount by department and level', icon: '👥', config: { tables: [{ id: '1', name: 'Headcount', rows: [], columns: [], values: [], filters: {}, grand_total: true, subtotals: false, missing_data: '', title: 'HR Analytics', subtitle: '' }] } },
    { name: 'Survey Results', desc: 'Response counts and percentages', icon: '📋', config: { tables: [{ id: '1', name: 'Survey', rows: [], columns: [], values: [], filters: {}, grand_total: true, subtotals: false, missing_data: '', title: 'Survey Results', subtitle: '' }] } },
  ];

  const [projectsDir, setProjectsDir] = useState('');
  const [fgProjects, setFgProjects] = useState<any[]>([]);
  const [loadingFg, setLoadingFg] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/projects`)
      .then(r => r.json())
      .then(d => { setProjects(d.projects || []); setProjectsDir(d.projects_dir || ''); })
      .catch(() => setProjects([]))
      .finally(() => setLoading(false));
    if (fgContext) {
      setLoadingFg(true);
      fgListUserProjects(fgContext.fgUrl, fgContext.token, 'analyzer')
        .then(projs => setFgProjects(projs.filter((p: any) => p.name && p.name !== '__autosave__')))
        .catch(() => {})
        .finally(() => setLoadingFg(false));
    }
  }, []);

  const handleSave = async () => {
    if (!saveName.trim()) { setError('Project name required'); return; }
    setSaving(true); setError(''); setSuccess('');
    try {
      const sourceFileInfo = currentFilename ? {
        filename: currentFilename,
        dataset_id: currentDatasetId,
        row_count: currentRowCount,
        col_count: currentColCount,
      } : undefined;
      if (saveMode === 'download') {
        const projectData = {
          meta: {
            name: saveName.trim(), version: '2.1', created: new Date().toISOString(),
            source_file: sourceFileInfo,
          },
          tables: currentTables,
          annotationsMap: currentAnnotationsMap,
          comparisonState: currentComparisonState || null,
          source_file: sourceFileInfo,
        };
        const blob = new Blob([JSON.stringify(projectData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${saveName.trim()}.tableforge`;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setSuccess(`Project "${saveName}" downloaded! You can import it later from any location.`);
      } else if (saveMode === 'fg' && fgContext) {
        await fgSaveProject(
          fgContext.fgUrl, fgContext.token, saveName.trim(),
          fgContext.programId || null,
          { tables: currentTables, annotationsMap: currentAnnotationsMap, comparisonState: currentComparisonState || null },
        );
        setSuccess(`Project "${saveName}" saved to FieldGovern! Access it from any device via your account.`);
      } else {
        const res = await fetch(`${API_BASE}/project/save`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: saveName.trim(), config: { tables: currentTables, annotationsMap: currentAnnotationsMap, comparisonState: currentComparisonState || null, projectFilters: currentProjectFilters || {}, dataset_id: currentDatasetId, source_file: sourceFileInfo }, password: projectPassword || undefined }),
        });
        if (!res.ok) throw new Error(await res.text());
        const saveResult = await res.json();
        const savedPath = saveResult.path || '';
        if (fgContext) {
          try {
            await fgSaveProject(
              fgContext.fgUrl, fgContext.token, saveName.trim(),
              fgContext.programId || null,
              { tables: currentTables, annotationsMap: currentAnnotationsMap, comparisonState: currentComparisonState || null },
            );
          } catch { /* non-fatal */ }
        }
        setSuccess(`Project "${saveName}" saved!\nLocation: ${savedPath}`);
        const listRes = await fetch(`${API_BASE}/projects`);
        const listData = await listRes.json();
        setProjects(listData.projects || []);
      }
      // Remember association with current file
      if (currentFilename) {
        localStorage.setItem(`tableforge_last_project_${currentFilename}`, saveName.trim());
      }
      setSaveName('');
    } catch (e: any) {
      setError(e.message || 'Save failed');
    } finally { setSaving(false); }
  };

  const handleLoad = async (path: string) => {
    try {
      const res = await fetch(`${API_BASE}/project/load?path=` + encodeURIComponent(path));
      if (!res.ok) throw new Error('Failed to load project');
      const data = await res.json();
      if (data.tables && Array.isArray(data.tables)) {
        const extra: Record<string, any> = {};
        if (data.reportTemplate) extra.reportTemplate = data.reportTemplate;
        if (data.comparisonState) extra.comparisonState = data.comparisonState;
        if (data.projectFilters) extra.projectFilters = data.projectFilters;
        onLoad(data.tables, data.annotationsMap, extra);
      }
    } catch (e: any) {
      setError(e.message || 'Load failed');
    }
  };

  const handleExportProject = async () => {
    const name = saveName || 'TableForge_Project';
    const blob = new Blob([JSON.stringify({ meta: { name, version: '2.0', created: new Date().toISOString() }, tables: currentTables, annotationsMap: currentAnnotationsMap }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${name}.tableforge`;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImportProject = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string);
        if (data.tables) onLoad(data.tables, data.annotationsMap);
      } catch { setError('Invalid project file'); }
    };
    reader.readAsText(file);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Project Manager</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-tabs">
          {[{ key: 'recent', label: '🕐 Recent' }, { key: 'save', label: '💾 Save' }, { key: 'gallery', label: '🎨 Templates' }, { key: 'batch', label: '📦 Batch' }].map(t => (
            <button key={t.key} className={`modal-tab ${activeTab === t.key ? 'active' : ''}`}
              onClick={() => setActiveTab(t.key as any)}>{t.label}</button>
          ))}
        </div>

        <div className="modal-body">
          {error && <div className="error-msg">{error}</div>}
          {success && <div className="success-msg" style={{ whiteSpace: 'pre-line' }}>{success}</div>}

          {activeTab === 'recent' && (
            <div>
              {projectsDir && (
                <div style={{ marginBottom: 10, padding: '6px 10px', background: 'rgba(148,163,184,0.08)', borderRadius: 6, fontSize: 11, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>Default save location:</span>
                  <code style={{ background: 'rgba(0,0,0,0.2)', padding: '2px 6px', borderRadius: 4, fontSize: 11, wordBreak: 'break-all' }}>{projectsDir}</code>
                </div>
              )}
              {lastProject && (
                <div style={{ marginBottom: 12, padding: '8px 12px', background: 'rgba(59,130,246,0.1)', borderRadius: 6, border: '1px solid rgba(59,130,246,0.3)', fontSize: 13 }}>
                  <strong>Auto-association:</strong> Last used project for <em>{currentFilename}</em> is <strong>{lastProject.name}</strong>.{' '}
                  <button className="btn-small" style={{ marginLeft: 8 }} onClick={() => handleLoad(lastProject.path)}>Load it</button>
                </div>
              )}
              {loading ? (
                <div className="loading-spinner">Loading projects...</div>
              ) : projects.length === 0 ? (
                <div className="empty-state" style={{ padding: 40 }}>
                  <p>No saved projects yet.</p>
                  <p className="hint">Save your current work in the "Save Project" tab.</p>
                </div>
              ) : (
                <div className="project-list">
                  {projects.map(p => (
                    <div key={p.path} className="project-item-wrap">
                      <div className="project-item">
                        <div className="project-info">
                          <div className="project-name">{p.name}</div>
                          <div className="project-date">
                            {p.created ? new Date(p.created).toLocaleDateString() : 'Unknown date'}
                            {p.version_count ? <span style={{ marginLeft: 8, color: '#94a3b8', fontSize: 10 }}>({p.version_count} versions)</span> : null}
                          </div>
                          {p.source_file?.filename && (
                            <div style={{ fontSize: 11, color: '#22c55e', marginTop: 3, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }} title={p.source_file.cache_path || ''}>
                              <span>📄</span>
                              <span style={{ fontWeight: 600 }}>{p.source_file.filename}</span>
                              {(p.source_file.row_count || p.source_file.col_count) && (
                                <span style={{ color: '#64748b', fontSize: 10 }}>
                                  · {p.source_file.row_count ?? '?'} rows × {p.source_file.col_count ?? '?'} cols
                                </span>
                              )}
                            </div>
                          )}
                          <div style={{ fontSize: 10, color: '#64748b', wordBreak: 'break-all', marginTop: 2 }}>{p.path}</div>
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          {p.version_count ? (
                            <button className="btn-secondary" style={{ padding: '4px 8px', fontSize: 11 }}
                              onClick={async () => {
                                if (expandedVersions[p.path]) {
                                  setExpandedVersions(e => { const n = {...e}; delete n[p.path]; return n; });
                                } else {
                                  const res = await fetch(`${API_BASE}/project/versions?path=` + encodeURIComponent(p.path));
                                  const data = await res.json();
                                  setExpandedVersions(e => ({ ...e, [p.path]: data.versions || [] }));
                                }
                              }}>History</button>
                          ) : null}
                          <button className="btn-primary" style={{ padding: '4px 12px', fontSize: 12 }}
                            onClick={() => handleLoad(p.path)}>Load</button>
                        </div>
                      </div>
                      {expandedVersions[p.path] && (
                        <div className="version-history">
                          <div className="version-history-label">Version History (oldest first):</div>
                          {expandedVersions[p.path].map((v: any, i: number) => (
                            <div key={i} className="version-row">
                              <span className="version-date">{v.saved_at ? new Date(v.saved_at).toLocaleString() : `Version ${i + 1}`}</span>
                              <span className="version-tables">{v.tables?.length || 0} table(s)</span>
                              <button className="btn-secondary" style={{ padding: '2px 8px', fontSize: 11 }}
                                onClick={async () => {
                                  try {
                                    await rollbackProject(p.path, i);
                                    await handleLoad(p.path);
                                  } catch (e: any) {
                                    setError(e.message || 'Rollback failed');
                                  }
                                }}>Restore</button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {/* FG Account Projects */}
              {fgContext && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    FieldGovern Account Projects
                  </div>
                  {loadingFg ? (
                    <div className="loading-spinner">Loading account projects...</div>
                  ) : fgProjects.length === 0 ? (
                    <div style={{ fontSize: 12, color: '#64748b', padding: '8px 0' }}>No saved projects in your account.</div>
                  ) : (
                    <div className="project-list">
                      {fgProjects.map((p: any) => (
                        <div key={p.id} className="project-item">
                          <div className="project-info">
                            <div className="project-name">☁️ {p.name}</div>
                            <div className="project-date">{p.updated_at ? new Date(p.updated_at).toLocaleDateString() : ''}</div>
                          </div>
                          <button className="btn-primary" style={{ padding: '4px 12px', fontSize: 12 }}
                            onClick={() => {
                              if (p.data?.tables) {
                                onLoad(p.data.tables, p.data.annotationsMap, { comparisonState: p.data.comparisonState });
                              }
                            }}>Load</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="import-export-row">
                <button className="btn-secondary" onClick={handleExportProject}>↓ Export .tableforge</button>
                <label className="btn-secondary" style={{ cursor: 'pointer' }}>
                  ↑ Import .tableforge
                  <input type="file" accept=".tableforge,.json" style={{ display: 'none' }} onChange={handleImportProject} />
                </label>
              </div>
            </div>
          )}

          {activeTab === 'save' && (
            <div>
              <div className="form-group">
                <label>Project Name</label>
                <input type="text" value={saveName} onChange={e => setSaveName(e.target.value)}
                  placeholder="e.g., Q4 Sales Analysis" />
              </div>
              <div className="form-group">
                <label>Save Location</label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', padding: '6px 12px', borderRadius: 6, border: `1px solid ${saveMode === 'server' ? 'var(--accent)' : 'var(--border)'}`, background: saveMode === 'server' ? 'rgba(59,130,246,0.1)' : 'transparent', fontSize: 13 }}>
                    <input type="radio" name="saveMode" checked={saveMode === 'server'} onChange={() => setSaveMode('server')} />
                    App Storage (quick access)
                  </label>
                  {fgContext && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', padding: '6px 12px', borderRadius: 6, border: `1px solid ${saveMode === 'fg' ? '#22c55e' : 'var(--border)'}`, background: saveMode === 'fg' ? 'rgba(34,197,94,0.1)' : 'transparent', fontSize: 13 }}>
                      <input type="radio" name="saveMode" checked={saveMode === 'fg'} onChange={() => setSaveMode('fg')} />
                      FieldGovern Account
                    </label>
                  )}
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', padding: '6px 12px', borderRadius: 6, border: `1px solid ${saveMode === 'download' ? 'var(--accent)' : 'var(--border)'}`, background: saveMode === 'download' ? 'rgba(59,130,246,0.1)' : 'transparent', fontSize: 13 }}>
                    <input type="radio" name="saveMode" checked={saveMode === 'download'} onChange={() => setSaveMode('download')} />
                    Download to My Computer
                  </label>
                </div>
                <div className="hint-text" style={{ marginTop: 4 }}>
                  {saveMode === 'server'
                    ? <>Saves to: <code style={{ background: 'rgba(0,0,0,0.2)', padding: '1px 4px', borderRadius: 3, fontSize: 11 }}>{projectsDir || 'projects/'}</code>. Shows up in the Recent tab.</>
                    : saveMode === 'fg'
                    ? 'Saves to your FieldGovern account. Access from any device when logged in.'
                    : 'Downloads a .tableforge file to your chosen folder. Import it later from Recent tab.'}
                </div>
              </div>
              {saveMode === 'server' && (
                <div className="form-group">
                  <label>Password Protection (optional)</label>
                  <input type="password" value={projectPassword} onChange={e => setProjectPassword(e.target.value)}
                    placeholder="Leave blank for no password" />
                  <div className="hint-text">If set, the project file will be encrypted with this password.</div>
                </div>
              )}
              <div className="project-current-info">
                <span className="project-meta">{currentTables.length} table(s) in current session</span>
                <ul className="project-table-list">
                  {currentTables.map(t => (
                    <li key={t.id}>{t.name} — {t.values.length} metrics, {t.rows.length + t.columns.length} dimensions</li>
                  ))}
                </ul>
              </div>
              <button className="btn-primary" onClick={handleSave} disabled={saving || !saveName.trim()}>
                {saving ? 'Saving...' : saveMode === 'download' ? '↓ Download Project' : '💾 Save Project'}
              </button>
            </div>
          )}

          {activeTab === 'batch' && (
            <div>
              <p className="hint-text" style={{ marginBottom: 12 }}>
                Apply a saved project template to multiple files and export each one.
              </p>
              <div className="form-group">
                <label>Select Project Template</label>
                <select value={batchProjectPath} onChange={e => setBatchProjectPath(e.target.value)}>
                  <option value="">-- select project --</option>
                  {projects.map(p => <option key={p.path} value={p.path}>{p.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Select Files to Process</label>
                <label className="btn-secondary" style={{ cursor: 'pointer', display: 'inline-block' }}>
                  📂 Choose Files
                  <input type="file" multiple accept=".xlsx,.xls,.csv,.tsv" style={{ display: 'none' }}
                    onChange={e => {
                      const files = Array.from(e.target.files || []);
                      setBatchFiles(files.map(f => f.name));
                    }} />
                </label>
                {batchFiles.length > 0 && (
                  <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-dim)' }}>
                    {batchFiles.length} file(s) selected: {batchFiles.join(', ')}
                  </div>
                )}
              </div>
              <div className="form-group">
                <label>Export Format</label>
                <select value={batchFormat} onChange={e => setBatchFormat(e.target.value)}>
                  <option value="xlsx">Excel (.xlsx)</option>
                  <option value="docx">Word (.docx)</option>
                  <option value="csv">CSV (.csv)</option>
                </select>
              </div>
              <button className="btn-primary" disabled={!batchProjectPath || batchFiles.length === 0 || batchRunning}
                onClick={async () => {
                  setBatchRunning(true); setBatchResults([]);
                  try {
                    const res = await fetch(`${API_BASE}/project/batch`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        project_path: batchProjectPath,
                        file_paths: batchFiles,
                        export_format: batchFormat,
                      }),
                    });
                    const data = await res.json();
                    setBatchResults(data.results || []);
                  } catch (e: any) {
                    setError(e.message || 'Batch failed');
                  } finally { setBatchRunning(false); }
                }}>
                {batchRunning ? 'Processing...' : `▶ Run Batch (${batchFiles.length} files)`}
              </button>
              {batchResults.length > 0 && (
                <div className="batch-results">
                  {batchResults.map((r, i) => (
                    <div key={i} className={`batch-result-row ${r.status}`}>
                      <span>{r.status === 'ok' ? '✓' : r.status === 'skipped' ? '⚠' : '✗'}</span>
                      <span>{r.file}</span>
                      <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-dim)' }}>
                        {r.output || r.message || r.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'gallery' && (
            <div>
              <p className="hint-text" style={{ marginBottom: 16 }}>Start with a pre-built template. Table fields will be populated once you load your data.</p>
              <div className="template-grid">
                {TEMPLATES.map(t => (
                  <div key={t.name} className="template-card">
                    <div className="template-icon">{t.icon}</div>
                    <div className="template-name">{t.name}</div>
                    <div className="template-desc">{t.desc}</div>
                    <button className="btn-primary" style={{ marginTop: 8, fontSize: 12 }}
                      onClick={() => { onLoad(t.config.tables as TableConfig[]); onClose(); }}>
                      Use Template
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
