import React, { useState, useEffect } from 'react';
import { TableConfig } from '../types';
import { rollbackProject, diffProjectVersions, fgSaveProject, fgListUserProjects, fgArchiveProject, fgRestoreProject, API_BASE, getUserHeaders } from '../api';

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
  currentColumnTypeOverrides?: Record<string, string>;
  currentSections?: any[];
  currentNumberingConfig?: any;
  currentInterpretationsMap?: Record<string, string>;
  onLoad: (tables: TableConfig[], annotationsMap?: Record<string, any[]>, extra?: Record<string, any>) => void;
  onClose: () => void;
  currentFilename?: string;
  currentDatasetId?: string;
  currentRowCount?: number;
  currentColCount?: number;
  fgContext?: FgContext | null;
}

export function ProjectManager({ currentTables, currentAnnotationsMap = {}, currentComparisonState, currentProjectFilters, currentColumnTypeOverrides = {}, currentSections = [], currentNumberingConfig, currentInterpretationsMap = {}, onLoad, onClose, currentFilename, currentDatasetId, currentRowCount, currentColCount, fgContext }: Props) {
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saveName, setSaveName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [activeTab, setActiveTab] = useState<'recent' | 'save' | 'gallery' | 'batch'>('recent');
  const [expandedVersions, setExpandedVersions] = useState<Record<string, any[]>>({});
  const [diffState, setDiffState] = useState<{
    path: string;
    leftIdx: number;
    rightIdx: number;
    result: any | null;
    loading: boolean;
    error: string;
  } | null>(null);
  const [batchProjectPath, setBatchProjectPath] = useState('');
  const [batchFiles, setBatchFiles] = useState<string[]>([]);
  const [batchFormat, setBatchFormat] = useState('xlsx');
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchResults, setBatchResults] = useState<any[]>([]);
  const [projectPassword, setProjectPassword] = useState('');
  // Default to the FieldGovern Account store: it's per-user private (server-side
  // user_id filter + RLS) and syncs across devices. App Storage (local disk) needs
  // server-side FG verify config and is the legacy fallback only.
  const [saveMode, setSaveMode] = useState<'server' | 'download' | 'fg'>(fgContext ? 'fg' : 'server');

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
  const [fgArchived, setFgArchived] = useState<any[]>([]);
  const [showFgArchive, setShowFgArchive] = useState(false);
  const [loadingFg, setLoadingFg] = useState(false);
  const [fgBusyId, setFgBusyId] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/projects`, { headers: getUserHeaders() })
      .then(r => r.json())
      .then(d => { setProjects(d.projects || []); setProjectsDir(d.projects_dir || ''); })
      .catch(() => setProjects([]))
      .finally(() => setLoading(false));
    if (fgContext) {
      setLoadingFg(true);
      const clean = (list: any[]) => list.filter((p: any) => p.name && p.name !== '__autosave__');
      Promise.all([
        fgListUserProjects(fgContext.fgUrl, fgContext.token, 'analyzer', false),
        fgListUserProjects(fgContext.fgUrl, fgContext.token, 'analyzer', true),
      ])
        .then(([active, arch]) => { setFgProjects(clean(active)); setFgArchived(clean(arch)); })
        .catch(() => {})
        .finally(() => setLoadingFg(false));
    }
  }, []);

  const handleFgArchive = async (p: any) => {
    if (!fgContext) return;
    setFgBusyId(p.id);
    try {
      await fgArchiveProject(fgContext.fgUrl, fgContext.token, p.id);
      setFgProjects(prev => prev.filter(x => x.id !== p.id));
      setFgArchived(prev => [{ ...p, archived_at: new Date().toISOString() }, ...prev]);
    } catch (e: any) { setError(e.message || 'Archive failed'); }
    finally { setFgBusyId(null); }
  };

  const handleFgRestore = async (p: any) => {
    if (!fgContext) return;
    setFgBusyId(p.id);
    try {
      await fgRestoreProject(fgContext.fgUrl, fgContext.token, p.id);
      setFgArchived(prev => prev.filter(x => x.id !== p.id));
      setFgProjects(prev => [{ ...p, archived_at: null }, ...prev]);
    } catch (e: any) { setError(e.message || 'Restore failed'); }
    finally { setFgBusyId(null); }
  };

  const loadFgProject = (p: any) => {
    if (p.data?.tables) {
      const extra: Record<string, any> = {};
      if (p.data.comparisonState) extra.comparisonState = p.data.comparisonState;
      if (p.data.projectFilters) extra.projectFilters = p.data.projectFilters;
      if (p.data.columnTypeOverrides) extra.columnTypeOverrides = p.data.columnTypeOverrides;
      if (p.data.tableInterpretations) extra.tableInterpretations = p.data.tableInterpretations;
      onLoad(p.data.tables, p.data.annotationsMap, extra);
    }
  };

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
            name: saveName.trim(), version: '2.2', created: new Date().toISOString(),
            source_file: sourceFileInfo,
          },
          tables: currentTables,
          annotationsMap: currentAnnotationsMap,
          comparisonState: currentComparisonState || null,
          projectFilters: currentProjectFilters || {},
          columnTypeOverrides: currentColumnTypeOverrides,
          sections: currentSections,
          numberingConfig: currentNumberingConfig,
          tableInterpretations: currentInterpretationsMap,
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
          { tables: currentTables, annotationsMap: currentAnnotationsMap, comparisonState: currentComparisonState || null, projectFilters: currentProjectFilters || {}, columnTypeOverrides: currentColumnTypeOverrides, tableInterpretations: currentInterpretationsMap },
        );
        setSuccess(`Project "${saveName}" saved to FieldGovern! Access it from any device via your account.`);
      } else {
        const res = await fetch(`${API_BASE}/project/save`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getUserHeaders() },
          body: JSON.stringify({ name: saveName.trim(), config: { tables: currentTables, annotationsMap: currentAnnotationsMap, comparisonState: currentComparisonState || null, projectFilters: currentProjectFilters || {}, columnTypeOverrides: currentColumnTypeOverrides, sections: currentSections, numberingConfig: currentNumberingConfig, tableInterpretations: currentInterpretationsMap, dataset_id: currentDatasetId, source_file: sourceFileInfo }, password: projectPassword || undefined }),
        });
        // App Storage needs server-side FG verify config. If it rejects (e.g. 401
        // "Sign in to save projects"), fall back to the private FG Account store
        // so the user's work is never lost — and it stays visible only to them.
        if (!res.ok) {
          if (fgContext) {
            await fgSaveProject(
              fgContext.fgUrl, fgContext.token, saveName.trim(),
              fgContext.programId || null,
              { tables: currentTables, annotationsMap: currentAnnotationsMap, comparisonState: currentComparisonState || null, projectFilters: currentProjectFilters || {}, columnTypeOverrides: currentColumnTypeOverrides, tableInterpretations: currentInterpretationsMap },
            );
            setSuccess(`Project "${saveName}" saved to your FieldGovern account (private to you). Access it from any device when logged in.`);
            if (currentFilename) localStorage.setItem(`tableforge_last_project_${currentFilename}`, saveName.trim());
            setSaveName('');
            setSaving(false);
            return;
          }
          throw new Error(await res.text());
        }
        const saveResult = await res.json();
        const savedPath = saveResult.path || '';
        if (fgContext) {
          try {
            await fgSaveProject(
              fgContext.fgUrl, fgContext.token, saveName.trim(),
              fgContext.programId || null,
              { tables: currentTables, annotationsMap: currentAnnotationsMap, comparisonState: currentComparisonState || null, projectFilters: currentProjectFilters || {}, columnTypeOverrides: currentColumnTypeOverrides, tableInterpretations: currentInterpretationsMap },
            );
          } catch { /* non-fatal */ }
        }
        setSuccess(`Project "${saveName}" saved!\nLocation: ${savedPath}`);
        const listRes = await fetch(`${API_BASE}/projects`, { headers: getUserHeaders() });
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
      const res = await fetch(`${API_BASE}/project/load?path=` + encodeURIComponent(path), { headers: getUserHeaders() });
      if (!res.ok) throw new Error('Failed to load project');
      const data = await res.json();
      if (data.tables && Array.isArray(data.tables)) {
        const extra: Record<string, any> = {};
        if (data.reportTemplate) extra.reportTemplate = data.reportTemplate;
        if (data.comparisonState) extra.comparisonState = data.comparisonState;
        if (data.projectFilters) extra.projectFilters = data.projectFilters;
        if (data.columnTypeOverrides) extra.columnTypeOverrides = data.columnTypeOverrides;
        if (data.metadata || data.config?.metadata) extra.metadata = data.metadata || data.config?.metadata;
        if (Array.isArray(data.sections)) extra.sections = data.sections;
        if (data.numberingConfig) extra.numberingConfig = data.numberingConfig;
        if (data.tableInterpretations) extra.tableInterpretations = data.tableInterpretations;
        const sourceFile = data.meta?.source_file || data.source_file;
        if (sourceFile) extra.source_file = sourceFile;
        onLoad(data.tables, data.annotationsMap, extra);
      }
    } catch (e: any) {
      setError(e.message || 'Load failed');
    }
  };

  const handleExportProject = async () => {
    const name = saveName || 'TableForge_Project';
    const blob = new Blob([JSON.stringify({
      meta: { name, version: '2.2', created: new Date().toISOString() },
      tables: currentTables,
      annotationsMap: currentAnnotationsMap,
      comparisonState: currentComparisonState || null,
      projectFilters: currentProjectFilters || {},
      columnTypeOverrides: currentColumnTypeOverrides,
      sections: currentSections,
      numberingConfig: currentNumberingConfig,
      tableInterpretations: currentInterpretationsMap,
    }, null, 2)], { type: 'application/json' });
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
        if (data.tables) {
          const extra: Record<string, any> = {};
          if (data.comparisonState) extra.comparisonState = data.comparisonState;
          if (data.projectFilters) extra.projectFilters = data.projectFilters;
          if (data.columnTypeOverrides) extra.columnTypeOverrides = data.columnTypeOverrides;
          if (Array.isArray(data.sections)) extra.sections = data.sections;
          if (data.numberingConfig) extra.numberingConfig = data.numberingConfig;
          if (data.tableInterpretations) extra.tableInterpretations = data.tableInterpretations;
          const sourceFile = data.meta?.source_file || data.source_file;
          if (sourceFile) extra.source_file = sourceFile;
          onLoad(data.tables, data.annotationsMap, extra);
        }
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
                          {expandedVersions[p.path].length >= 1 && (
                            <div style={{ padding: '4px 8px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center' }}>
                              <span style={{ fontSize: 11, opacity: 0.7 }}>Compare two versions:</span>
                              <button className="btn-secondary" style={{ padding: '2px 8px', fontSize: 11 }}
                                onClick={() => setDiffState({
                                  path: p.path,
                                  leftIdx: 0,
                                  rightIdx: -1,
                                  result: null,
                                  loading: false,
                                  error: '',
                                })}>
                                🔀 Open Diff View
                              </button>
                            </div>
                          )}
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
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      {showFgArchive ? '🗄 Archived Projects' : 'FieldGovern Account Projects'}
                    </div>
                    <button className="btn-secondary" style={{ padding: '3px 10px', fontSize: 11 }}
                      onClick={() => setShowFgArchive(s => !s)}>
                      {showFgArchive ? '← Active projects' : `🗄 Archive folder${fgArchived.length ? ` (${fgArchived.length})` : ''}`}
                    </button>
                  </div>
                  {loadingFg ? (
                    <div className="loading-spinner">Loading account projects...</div>
                  ) : (showFgArchive ? fgArchived : fgProjects).length === 0 ? (
                    <div style={{ fontSize: 12, color: '#64748b', padding: '8px 0' }}>
                      {showFgArchive ? 'No archived projects.' : 'No saved projects in your account.'}
                    </div>
                  ) : (
                    <div className="project-list">
                      {(showFgArchive ? fgArchived : fgProjects).map((p: any) => (
                        <div key={p.id} className="project-item">
                          <div className="project-info">
                            <div className="project-name">{showFgArchive ? '🗄' : '☁️'} {p.name}</div>
                            <div className="project-date">
                              {(p.archived_at || p.updated_at) ? new Date(p.archived_at || p.updated_at).toLocaleDateString() : ''}
                              {showFgArchive ? ' · archived' : ''}
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button className="btn-primary" style={{ padding: '4px 12px', fontSize: 12 }}
                              onClick={() => loadFgProject(p)}>Load</button>
                            {showFgArchive ? (
                              <button className="btn-secondary" style={{ padding: '4px 10px', fontSize: 12 }}
                                disabled={fgBusyId === p.id}
                                onClick={() => handleFgRestore(p)}>↩ Restore</button>
                            ) : (
                              <button className="btn-secondary" style={{ padding: '4px 10px', fontSize: 12 }}
                                disabled={fgBusyId === p.id}
                                title="Archive (never deleted — restorable from the Archive folder)"
                                onClick={() => handleFgArchive(p)}>🗄 Archive</button>
                            )}
                          </div>
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
                    ? <>Saves to this server's local store (<code style={{ background: 'rgba(0,0,0,0.2)', padding: '1px 4px', borderRadius: 3, fontSize: 11 }}>{projectsDir || 'projects/'}</code>). If unavailable, it falls back to your private FieldGovern account.</>
                    : saveMode === 'fg'
                    ? 'Saves privately to your FieldGovern account — visible only to you, on any device when logged in.'
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
                  {currentTables.map((t, i) => (
                    <li key={t.id}>
                      <span className="pm-table-num">#{i + 1}</span>
                      {t.pinned && <span title="Pinned" style={{ color: '#f59e0b', marginRight: 4 }}>★</span>}
                      {t.title || t.name} — {t.values.length} metrics, {t.rows.length + t.columns.length} dimensions
                    </li>
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
      {diffState && (
        <DiffModal
          state={diffState}
          versions={expandedVersions[diffState.path] || []}
          onChange={setDiffState}
          onClose={() => setDiffState(null)}
        />
      )}
    </div>
  );
}

function DiffModal({
  state, versions, onChange, onClose,
}: {
  state: { path: string; leftIdx: number; rightIdx: number; result: any | null; loading: boolean; error: string };
  versions: any[];
  onChange: (s: typeof state) => void;
  onClose: () => void;
}) {
  const versionLabel = (idx: number) => {
    if (idx === -1) return 'Current (working version)';
    const v = versions[idx];
    if (!v) return `Version ${idx + 1}`;
    return v.saved_at ? new Date(v.saved_at).toLocaleString() : `Version ${idx + 1}`;
  };

  const runDiff = async () => {
    onChange({ ...state, loading: true, error: '', result: null });
    try {
      const r = await diffProjectVersions(state.path, state.leftIdx, state.rightIdx);
      onChange({ ...state, loading: false, result: r });
    } catch (e: any) {
      onChange({ ...state, loading: false, error: e.message || 'Diff failed' });
    }
  };

  useEffect(() => { runDiff(); }, [state.leftIdx, state.rightIdx]); // eslint-disable-line

  const fmtVal = (v: any): string => {
    if (v === null || v === undefined) return '—';
    if (Array.isArray(v)) return v.length === 0 ? '[]' : `[${v.length}] ${v.slice(0, 3).join(', ')}${v.length > 3 ? '…' : ''}`;
    if (typeof v === 'object') return JSON.stringify(v).slice(0, 80);
    return String(v);
  };

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 200 }}>
      <div className="modal-content" style={{ maxWidth: 900, maxHeight: '85vh' }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>🔀 Diff: Compare Project Versions</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div style={{ display: 'flex', gap: 12, padding: 12, borderBottom: '1px solid var(--border)', flexWrap: 'wrap', alignItems: 'center' }}>
          <label>Base:
            <select value={state.leftIdx} onChange={e => onChange({ ...state, leftIdx: parseInt(e.target.value) })} style={{ marginLeft: 6 }}>
              {versions.map((_, i) => (
                <option key={i} value={i}>{versionLabel(i)}</option>
              ))}
              <option value={-1}>{versionLabel(-1)}</option>
            </select>
          </label>
          <span style={{ opacity: 0.6 }}>→</span>
          <label>Compare:
            <select value={state.rightIdx} onChange={e => onChange({ ...state, rightIdx: parseInt(e.target.value) })} style={{ marginLeft: 6 }}>
              {versions.map((_, i) => (
                <option key={i} value={i}>{versionLabel(i)}</option>
              ))}
              <option value={-1}>{versionLabel(-1)}</option>
            </select>
          </label>
        </div>
        <div className="modal-body" style={{ overflow: 'auto', padding: 12, maxHeight: '60vh' }}>
          {state.loading && <div>Loading diff…</div>}
          {state.error && <div className="preview-error">{state.error}</div>}
          {state.result && (
            <>
              <div style={{ display: 'flex', gap: 16, marginBottom: 12, fontSize: 12 }}>
                <span>📊 <strong>{state.result.summary.total_left}</strong> tables (base)</span>
                <span>→</span>
                <span>📊 <strong>{state.result.summary.total_right}</strong> tables (compare)</span>
                <span style={{ color: '#22c55e' }}>+ {state.result.summary.added} added</span>
                <span style={{ color: '#ef4444' }}>− {state.result.summary.removed} removed</span>
                <span style={{ color: '#f59e0b' }}>~ {state.result.summary.changed} changed</span>
              </div>
              {state.result.added.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <h4 style={{ color: '#22c55e' }}>Added tables</h4>
                  {state.result.added.map((t: any) => (
                    <div key={t.id} style={{ padding: '4px 8px', fontSize: 12 }}>+ {t.name}</div>
                  ))}
                </div>
              )}
              {state.result.removed.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <h4 style={{ color: '#ef4444' }}>Removed tables</h4>
                  {state.result.removed.map((t: any) => (
                    <div key={t.id} style={{ padding: '4px 8px', fontSize: 12 }}>− {t.name}</div>
                  ))}
                </div>
              )}
              {state.result.changed.length > 0 && (
                <div>
                  <h4 style={{ color: '#f59e0b' }}>Changed tables</h4>
                  {state.result.changed.map((t: any) => (
                    <details key={t.id} style={{ marginBottom: 8, border: '1px solid var(--border)', borderRadius: 4 }}>
                      <summary style={{ padding: '6px 8px', cursor: 'pointer', fontWeight: 600 }}>
                        {t.name} <span style={{ fontWeight: 400, opacity: 0.6, fontSize: 11 }}>({t.changes.length} change{t.changes.length !== 1 ? 's' : ''})</span>
                      </summary>
                      <table style={{ width: '100%', fontSize: 11, borderTop: '1px solid var(--border)' }}>
                        <thead>
                          <tr style={{ background: 'var(--bg-elev)' }}>
                            <th style={{ textAlign: 'left', padding: '4px 8px' }}>Field</th>
                            <th style={{ textAlign: 'left', padding: '4px 8px' }}>Before</th>
                            <th style={{ textAlign: 'left', padding: '4px 8px' }}>After</th>
                          </tr>
                        </thead>
                        <tbody>
                          {t.changes.map((c: any, i: number) => (
                            <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                              <td style={{ padding: '4px 8px', fontFamily: 'monospace' }}>{c.field}</td>
                              <td style={{ padding: '4px 8px', color: '#ef4444' }}>{fmtVal(c.before)}</td>
                              <td style={{ padding: '4px 8px', color: '#22c55e' }}>{fmtVal(c.after)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </details>
                  ))}
                </div>
              )}
              {state.result.added.length === 0 && state.result.removed.length === 0 && state.result.changed.length === 0 && (
                <div style={{ opacity: 0.6, padding: 12 }}>No differences between these versions.</div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
