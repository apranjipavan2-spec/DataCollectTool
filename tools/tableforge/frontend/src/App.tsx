import React, { useState, useCallback, useEffect, useRef } from 'react';
import { DatasetMeta, TableConfig, TableResult, ColumnInfo, ValueField, DropZoneType } from './types';
import { API_BASE, uploadFile, tabulate, listMetrics, listBins, saveProject, listProjects, refreshDataset, changeColumnType, logAuditEvent } from './api';
import { SourcePanel } from './components/SourcePanel';
import { DropZones } from './components/DropZones';
import { LivePreview } from './components/LivePreview';
import { TopBar } from './components/TopBar';
import { StatusBar } from './components/StatusBar';
import { WelcomeScreen } from './components/WelcomeScreen';
import { DataPreview } from './components/DataPreview';
import { FilterPanel } from './components/FilterPanel';
import { ProjectFilterPanel } from './components/ProjectFilterPanel';
import { MetricBuilder } from './components/MetricBuilder';
import { BinCreator } from './components/BinCreator';
import { ExportDialog } from './components/ExportDialog';
import { DataQualityPanel } from './components/DataQualityPanel';
import { ComparisonPanel } from './components/ComparisonPanel';
import { ReportBuilder } from './components/ReportBuilder';
import { AuditTrail } from './components/AuditTrail';
import { ProjectManager } from './components/ProjectManager';
import { SummaryDashboard } from './components/SummaryDashboard';
import { OnboardingTour, shouldShowTour } from './components/OnboardingTour';
import { TableComparison } from './components/TableComparison';
import { MetricLibrary } from './components/MetricLibrary';
import { AnnotationReconcileDialog, detectOrphanedAnnotations, ReconcileAnnotation } from './components/AnnotationReconcile';
import { ChartBuilder } from './components/ChartBuilder';
import { RibbonBar } from './components/RibbonBar';
import { StatisticalTables } from './components/StatisticalTables';

function createEmptyTable(id: string, name: string): TableConfig {
  return {
    id, name, rows: [], columns: [], values: [], filters: {},
    grand_total: true, subtotals: false, missing_data: '', title: '', subtitle: '',
    _autoTitle: true,
  };
}

function generateAutoTitle(t: TableConfig): { title: string; subtitle: string; name: string } {
  if (!t.rows.length && !t.values.length) return { title: '', subtitle: '', name: t.name };
  const rowLabel = t.rows.length > 0 ? t.rows.map(r => r.replace(/^\d+\.\s*/, '').split('>').pop()?.trim() || r).join(' x ') : '';
  const colLabel = t.columns.length > 0 ? t.columns.map(c => c.replace(/^\d+\.\s*/, '').split('>').pop()?.trim() || c).join(' x ') : '';
  const valParts = t.values.map(v => {
    const aggLabel = (v.agg || 'count').charAt(0).toUpperCase() + (v.agg || 'count').slice(1);
    const fieldShort = v.field.replace(/^\d+\.\s*/, '').split('>').pop()?.trim() || v.field;
    return `${aggLabel} of ${fieldShort}`;
  });
  const title = rowLabel + (colLabel ? ` by ${colLabel}` : '');
  const subtitle = valParts.join(', ');
  const nameShort = (rowLabel || 'Table').slice(0, 20) + (colLabel ? ` x ${colLabel.slice(0, 15)}` : '');
  return { title, subtitle, name: nameShort };
}

type ModalType = null | 'metrics' | 'bins' | 'export' | 'quality' | 'comparison' | 'report' | 'audit' | 'projects' | 'table_compare' | 'metric_library' | 'charts' | 'stat_correlation' | 'stat_descriptive' | 'stat_crosstab' | 'stat_ttest' | 'stat_anova' | 'stat_regression' | 'stat_normality' | 'stat_outlier' | 'stat_frequency';

interface ReconcileState {
  pendingTables: TableConfig[];
  mismatches: { field: string; zone: string; suggestion: string }[];
  mapping: Record<string, string>;
}

export default function App() {
  const [dataset, setDataset] = useState<DatasetMeta | null>(null);
  const [fgContext, setFgContext] = useState<{ fgUrl: string; token: string; programId?: string } | null>(null);
  const [tables, setTables] = useState<TableConfig[]>([createEmptyTable('1', 'Table 1')]);
  const [activeTableIdx, setActiveTableIdx] = useState(0);
  const [results, setResults] = useState<Map<string, TableResult>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDataPreview, setShowDataPreview] = useState(false);
  const [draggedField, setDraggedField] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalType>(null);
  const [extraColumns, setExtraColumns] = useState<ColumnInfo[]>([]);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [ribbonTab, setRibbonTab] = useState('home');
  const [undoStack, setUndoStack] = useState<TableConfig[][]>([]);
  const [redoStack, setRedoStack] = useState<TableConfig[][]>([]);
  const [dateGroupModal, setDateGroupModal] = useState<string | null>(null); // field name
  const [showTour, setShowTour] = useState(false);
  const [reconcileState, setReconcileState] = useState<ReconcileState | null>(null);
  type AnnotationType = { rowIdx: number; colIdx: number; text: string; color: string };
  const [annotationsMap, setAnnotationsMap] = useState<Record<string, AnnotationType[]>>({});
  const [reportTemplate, setReportTemplate] = useState<{ elements: any[]; docStyle: any } | null>(null);
  const [auditLog, setAuditLog] = useState<{ timestamp: string; action: string; details: string }[]>([]);
  const [metricNames, setMetricNames] = useState<string[]>([]);
  const [binNames, setBinNames] = useState<string[]>([]);
  const [comparisonState, setComparisonState] = useState<any>(null);
  const [orphanedAnnotations, setOrphanedAnnotations] = useState<ReconcileAnnotation[] | null>(null);
  // tabContextMenu removed — tables now listed in SourcePanel sidebar
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [showProjectFilterPanel, setShowProjectFilterPanel] = useState(false);
  const [projectFilters, setProjectFilters] = useState<Record<string, string[]>>({});
  // Ref so runTabulation always reads the latest project filters without needing them in its dep array
  const projectFiltersRef = useRef<Record<string, string[]>>({});
  const [isDirty, setIsDirty] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [lastProjectHint, setLastProjectHint] = useState<string | null>(null);
  const [pendingProjectData, setPendingProjectData] = useState<any>(null);
  const [resumePrompt, setResumePrompt] = useState<{ data: any; filename: string } | null>(null);
  const autoSaveRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSaveStateRef = useRef<string>('');
  const ribbonFileRef = useRef<HTMLInputElement>(null);

  const activeTable = tables[activeTableIdx];
  const currentResult = results.get(activeTable?.id) || null;
  const allColumns = [...(dataset?.columns || []), ...extraColumns];

  // Theme only applies to the table area, UI stays dark always
  // No global data-theme attribute set on document

  // (tab context menu removed — tables now in SourcePanel)

  // Auto-apply pending project after data file is loaded
  useEffect(() => {
    if (pendingProjectData && dataset && allColumns.length > 0) {
      const data = pendingProjectData;
      setPendingProjectData(null);
      // Check column mismatches
      const colNames = allColumns.map(c => c.name);
      const mismatches: ReconcileState['mismatches'] = [];
      for (const t of data.tables) {
        const allFields = [
          ...t.rows.map((f: string) => ({ field: f, zone: 'rows' })),
          ...t.columns.map((f: string) => ({ field: f, zone: 'columns' })),
          ...t.values.map((v: any) => ({ field: v.field, zone: 'values' })),
          ...Object.keys(t.filters || {}).map((f: string) => ({ field: f, zone: 'filters' })),
        ];
        for (const { field, zone } of allFields) {
          if (!colNames.includes(field) && !mismatches.find(m => m.field === field)) {
            mismatches.push({ field, zone, suggestion: fuzzyMatch(field, colNames) });
          }
        }
      }
      if (data.annotationsMap) setAnnotationsMap(data.annotationsMap);
      if (data.comparisonState) setComparisonState(data.comparisonState);
      if (mismatches.length > 0) {
        setShowDataPreview(false);
        setReconcileState({ pendingTables: data.tables, mismatches, mapping: Object.fromEntries(mismatches.map(m => [m.field, m.suggestion])) });
      } else {
        setTables(data.tables);
        setActiveTableIdx(0);
        setResults(new Map());
        setShowDataPreview(false);
        setTimeout(() => data.tables.forEach((t: TableConfig) => { if (t.values.length > 0) runTabulation(t); }), 100);
      }
    }
  }, [pendingProjectData, dataset, allColumns]);

  // Track dirty state (unsaved changes)
  useEffect(() => {
    const currentState = JSON.stringify({ tables, annotationsMap, comparisonState });
    if (currentState !== lastSaveStateRef.current) {
      setIsDirty(true);
    }
  }, [tables, annotationsMap, comparisonState]);

  // Auto-save every 5 minutes
  useEffect(() => {
    if (!dataset) return;
    if (autoSaveRef.current) clearInterval(autoSaveRef.current);
    autoSaveRef.current = setInterval(() => {
      if (tables.some(t => t.values.length > 0)) {
        saveProject('__autosave__', { tables, annotationsMap, comparisonState, projectFilters, dataset_id: dataset?.dataset_id, source_file: dataset ? { filename: dataset.filename, dataset_id: dataset.dataset_id, row_count: dataset.row_count, col_count: dataset.columns?.length } : undefined }).then(() => {
          // Update last save state and clear dirty flag
          lastSaveStateRef.current = JSON.stringify({ tables, annotationsMap, comparisonState });
          setIsDirty(false);
        }).catch(() => {});
      }
    }, 5 * 60 * 1000);
    return () => { if (autoSaveRef.current) clearInterval(autoSaveRef.current); };
  }, [dataset, tables, annotationsMap, comparisonState]);

  // Warn about unsaved changes
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'z') { e.preventDefault(); handleUndo(); }
      if (e.ctrlKey && e.key === 'y') { e.preventDefault(); handleRedo(); }
      if (e.ctrlKey && e.key === 's') { e.preventDefault(); handleSaveProject(); }
      if (e.ctrlKey && e.key === 'e') { e.preventDefault(); if (dataset) setModal('export'); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [tables, undoStack, dataset]);

  // Keep projectFiltersRef in sync so runTabulation can read the latest value
  useEffect(() => { projectFiltersRef.current = projectFilters; }, [projectFilters]);

  // Re-run all active tables whenever project filters change
  useEffect(() => {
    if (!dataset) return;
    tables.forEach(t => { if (t.values.length > 0) runTabulation(t); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectFilters]);

  // On startup, check for autosave and offer to resume
  useEffect(() => {
    listProjects().then((projects: any[]) => {
      const autosave = projects.find((p: any) => p.name === '__autosave__');
      if (autosave?.config) {
        const srcFile = autosave.config.source_file;
        const label = srcFile?.filename || 'your last session';
        setResumePrompt({ data: autosave.config, filename: label });
      }
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Read FG context from URL params; auto-load if program_id present
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fgUrl = params.get('fg_url');
    const programId = params.get('program_id');
    const token = params.get('token');
    if (!fgUrl || !token) return;
    setFgContext({ fgUrl, token, programId: programId || undefined });
    if (!programId) return; // no auto-load; user will pick in WelcomeScreen
    setLoading(true);
    fetch(import.meta.env.BASE_URL.replace(/\/$/, '') + '/api/import-from-fg', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fg_base_url: fgUrl, program_id: programId, token }),
    })
      .then(r => r.ok ? r.json() : r.json().then(e => Promise.reject(e.detail || 'Import failed')))
      .then(meta => { setDataset(meta); setLoading(false); })
      .catch(err => { setLoading(false); setError(`Failed to load FieldGovern data: ${err}`); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pushUndo = useCallback(() => {
    setUndoStack(prev => [...prev.slice(-20), tables.map(t => ({ ...t, values: [...t.values], rows: [...t.rows], columns: [...t.columns], filters: { ...t.filters } }))]);
    setRedoStack([]);
  }, [tables]);

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    setRedoStack(r => [...r, tables]);
    setUndoStack(u => u.slice(0, -1));
    setTables(prev);
    if (prev[activeTableIdx]) runTabulation(prev[activeTableIdx]);
  }, [undoStack, tables, activeTableIdx]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setUndoStack(u => [...u, tables]);
    setRedoStack(r => r.slice(0, -1));
    setTables(next);
    if (next[activeTableIdx]) runTabulation(next[activeTableIdx]);
  }, [redoStack, tables, activeTableIdx]);

  const handleResumeYes = useCallback(async () => {
    const data = resumePrompt?.data;
    setResumePrompt(null);
    if (!data) return;
    // Restore autosave state
    if (data.tables) setTables(data.tables);
    if (data.annotationsMap) setAnnotationsMap(data.annotationsMap);
    if (data.comparisonState) setComparisonState(data.comparisonState);
    if (data.projectFilters) setProjectFilters(data.projectFilters);
    if (data.source_file) {
      setDataset({ dataset_id: data.source_file.dataset_id, filename: data.source_file.filename, row_count: data.source_file.row_count, columns: [], sheets: [], preview: [] });
    }
    setActiveTableIdx(0);
    setResults(new Map());
  }, [resumePrompt]);

  const handleResumeNo = useCallback(async () => {
    const data = resumePrompt?.data;
    setResumePrompt(null);
    if (!data) return;
    // Save autosave as a versioned project
    try {
      const projects: any[] = await listProjects();
      const baseName = data.source_file?.filename?.replace(/\.[^.]+$/, '') || 'session';
      const prefix = `${baseName}_edit_v`;
      const existing = projects.filter((p: any) => p.name.startsWith(prefix));
      const nextN = existing.length + 1;
      await saveProject(`${prefix}${nextN}`, data);
    } catch {}
    // Clear the autosave
    try { await saveProject('__autosave__', {}); } catch {}
  }, [resumePrompt]);

  const handleFileUpload = useCallback(async (file: File) => {
    setLoading(true); setError(null); setUploadProgress(0);
    try {
      const meta = await uploadFile(file, pct => setUploadProgress(pct));
      setUploadProgress(null);
      setDataset(meta);
      setTables([createEmptyTable('1', 'Table 1')]);
      setActiveTableIdx(0); setResults(new Map()); setExtraColumns([]);
      setUndoStack([]); setRedoStack([]); setShowDataPreview(true);
      if (shouldShowTour()) setShowTour(true);

      // Check if there's a last project for this file — offer quick re-apply
      const lastProjName = localStorage.getItem(`tableforge_last_project_${file.name}`);
      if (lastProjName) {
        setLastProjectHint(lastProjName);
      } else {
        setLastProjectHint(null);
      }
    } catch (e: any) {
      setError(e.message || 'Upload failed');
      setUploadProgress(null);
    } finally { setLoading(false); }
  }, []);

  const runTabulation = useCallback(async (config: TableConfig) => {
    if (!dataset) return;
    if (config.values.length === 0) {
      setResults(prev => { const next = new Map(prev); next.delete(config.id); return next; });
      return;
    }
    setLoading(true); setError(null);
    try {
      const res = await tabulate({
        dataset_id: dataset.dataset_id,
        rows: config.rows, columns: config.columns, values: config.values,
        filters: mergeProjectFilters(projectFiltersRef.current, config.filters), grand_total: config.grand_total,
        grand_total_rows: config.grand_total_rows, grand_total_columns: config.grand_total_columns,
        subtotals: config.subtotals, missing_data: config.missing_data,
        sort_by: config.sort_by, sort_order: config.sort_order,
        multi_sort: config.multi_sort,
        date_groupings: config.date_groupings,
        blank_suppress: config.blank_suppress,
      });
      setResults(prev => {
        const next = new Map(prev);
        next.set(config.id, res);
        // Check for orphaned annotations after new result
        const tableAnns = annotationsMap[config.id];
        if (tableAnns && tableAnns.length > 0) {
          const orphaned = tableAnns.filter(
            a => a.rowIdx >= res.rows.length || a.colIdx >= res.headers.length
          );
          if (orphaned.length > 0) {
            const tableName = tables.find(t => t.id === config.id)?.name || config.id;
            setOrphanedAnnotations(orphaned.map(ann => ({
              tableId: config.id,
              tableName,
              annotation: ann as any,
              action: 'keep' as const,
            })));
          }
        }
        return next;
      });
    } catch (e: any) {
      setError(e.message || 'Tabulation failed');
    } finally { setLoading(false); }
  }, [dataset, annotationsMap, tables]);

  const updateTable = useCallback((update: Partial<TableConfig>) => {
    pushUndo();
    setTables(prev => {
      const next = [...prev];
      const merged = { ...next[activeTableIdx], ...update };
      // Auto-generate title/subtitle/name when structure changes and title wasn't manually set
      if (('rows' in update || 'columns' in update || 'values' in update) && (merged as any)._autoTitle !== false) {
        const auto = generateAutoTitle(merged);
        if (auto.title) {
          merged.title = auto.title;
          merged.subtitle = auto.subtitle;
          merged.name = auto.name;
        }
      }
      if (update.values && update.values.length > 0) {
        const v = update.values[0];
        merged._lastValueConfig = { agg: v.agg, show_as: v.show_as, combo_show_as: v.combo_show_as, decimals: v.decimals };
      } else if (update.values && update.values.length === 0 && next[activeTableIdx].values.length > 0) {
        // Preserve config from last removed value field
        const v = next[activeTableIdx].values[0];
        merged._lastValueConfig = { agg: v.agg, show_as: v.show_as, combo_show_as: v.combo_show_as, decimals: v.decimals };
      }
      next[activeTableIdx] = merged;
      runTabulation(next[activeTableIdx]);
      return next;
    });
  }, [activeTableIdx, runTabulation, pushUndo]);

  // Helper: create a new value field, inheriting agg/combo/decimals from existing table values
  const createValueField = useCallback((table: TableConfig, fieldName: string): import('./types').ValueField => {
    const col = allColumns.find(c => c.name === fieldName);
    const existing = table.values.length > 0 ? table.values[0] : table._lastValueConfig;
    // Inherit agg, combo_show_as, show_as, decimals from existing value fields
    const agg = existing?.agg || (col?.type === 'numeric' ? 'sum' : 'count');
    const show_as = existing?.show_as;
    const combo_show_as = existing?.combo_show_as;
    const decimals = existing?.decimals;
    const label = buildValueLabel(agg, show_as, combo_show_as, fieldName);
    return {
      field: fieldName, agg, label,
      ...(show_as ? { show_as } : {}),
      ...(combo_show_as ? { combo_show_as } : {}),
      ...(decimals !== undefined ? { decimals } : {}),
    };
  }, [allColumns]);

  const handleDrop = useCallback((zone: DropZoneType, fieldName: string) => {
    const table = tables[activeTableIdx];
    if (zone === 'values') {
      if (table.values.find(v => v.field === fieldName)) return;
      updateTable({ values: [...table.values, createValueField(table, fieldName)] });
    } else if (zone === 'filters') {
      if (fieldName in table.filters) return;
      updateTable({ filters: { ...table.filters, [fieldName]: [] } });
    } else {
      if (table[zone].includes(fieldName)) return;
      updateTable({ [zone]: [...table[zone], fieldName] });
    }
  }, [tables, activeTableIdx, allColumns, updateTable]);

  const handleReorder = useCallback((zone: DropZoneType, fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx) return;
    pushUndo();
    setTables(prev => {
      const next = [...prev];
      const t = { ...next[activeTableIdx] };
      if (zone === 'values') {
        const arr = [...t.values];
        const [item] = arr.splice(fromIdx, 1);
        arr.splice(toIdx, 0, item);
        t.values = arr;
      } else if (zone === 'rows' || zone === 'columns') {
        const arr = [...t[zone]];
        const [item] = arr.splice(fromIdx, 1);
        arr.splice(toIdx, 0, item);
        t[zone] = arr;
      }
      next[activeTableIdx] = t;
      runTabulation(t);
      return next;
    });
  }, [activeTableIdx, pushUndo, runTabulation]);

  const handleMoveField = useCallback((fromZone: DropZoneType, toZone: DropZoneType, fieldName: string) => {
    if (fromZone === toZone) return;
    pushUndo();
    setTables(prev => {
      const next = [...prev];
      const t = { ...next[activeTableIdx] };
      // Remove from source (preserve last value config before removing)
      if (fromZone === 'values') {
        if (t.values.length > 0) {
          const v = t.values[0];
          t._lastValueConfig = { agg: v.agg, show_as: v.show_as, combo_show_as: v.combo_show_as, decimals: v.decimals };
        }
        t.values = t.values.filter(v => v.field !== fieldName);
      }
      else if (fromZone === 'filters') { const f = { ...t.filters }; delete f[fieldName]; t.filters = f; }
      else t[fromZone] = t[fromZone].filter((f: string) => f !== fieldName);
      // Add to target
      if (toZone === 'values') {
        if (!t.values.find(v => v.field === fieldName)) {
          t.values = [...t.values, createValueField(t, fieldName)];
        }
      } else if (toZone === 'filters') {
        if (!(fieldName in t.filters)) t.filters = { ...t.filters, [fieldName]: [] };
      } else {
        if (!t[toZone].includes(fieldName)) t[toZone] = [...t[toZone], fieldName];
      }
      next[activeTableIdx] = t;
      runTabulation(t);
      return next;
    });
  }, [activeTableIdx, allColumns, pushUndo, runTabulation]);

  const handleRemoveField = useCallback((zone: DropZoneType, fieldName: string) => {
    const table = tables[activeTableIdx];
    if (zone === 'values') updateTable({ values: table.values.filter(v => v.field !== fieldName) });
    else if (zone === 'filters') {
      const f = { ...table.filters }; delete f[fieldName];
      updateTable({ filters: f });
    } else {
      updateTable({ [zone]: table[zone].filter((f: string) => f !== fieldName) });
    }
  }, [tables, activeTableIdx, updateTable]);

  const handleAggChange = useCallback((fieldName: string, agg: string) => {
    const table = tables[activeTableIdx];
    updateTable({
      values: table.values.map(v =>
        v.field === fieldName ? { ...v, agg, label: buildValueLabel(agg, v.show_as, v.combo_show_as, fieldName) } : v
      ),
    });
  }, [tables, activeTableIdx, updateTable]);

  const handleValueFieldUpdate = useCallback((fieldName: string, updates: Partial<import('./types').ValueField>) => {
    const table = tables[activeTableIdx];
    updateTable({
      values: table.values.map(v => {
        if (v.field !== fieldName) return v;
        const merged = { ...v, ...updates };
        return { ...merged, label: buildValueLabel(merged.agg, merged.show_as, merged.combo_show_as, fieldName) };
      }),
    });
  }, [tables, activeTableIdx, updateTable]);

  const handleFilterChange = useCallback((fieldName: string, selectedValues: string[]) => {
    updateTable({ filters: { ...tables[activeTableIdx].filters, [fieldName]: selectedValues } });
  }, [tables, activeTableIdx, updateTable]);

  const handleDateGroupSuggest = useCallback((fieldName: string) => {
    setDateGroupModal(fieldName);
  }, []);

  const handleDateGroupApply = useCallback((fieldName: string, grouping: string) => {
    updateTable({ date_groupings: { ...(activeTable.date_groupings || {}), [fieldName]: grouping } });
    setDateGroupModal(null);
  }, [activeTable, updateTable]);

  const handleLoadProjectByPath = useCallback(async (path: string) => {
    try {
      const res = await fetch(`${API_BASE}/project/load?path=` + encodeURIComponent(path));
      if (!res.ok) throw new Error('Failed to load project');
      const data = await res.json();
      if (!data.tables || !Array.isArray(data.tables)) throw new Error('Invalid project data');
      // Check column mismatches (same reconcile logic as ProjectManager)
      const colNames = allColumns.map(c => c.name);
      const mismatches: ReconcileState['mismatches'] = [];
      for (const t of data.tables) {
        const allFields = [
          ...t.rows.map((f: string) => ({ field: f, zone: 'rows' })),
          ...t.columns.map((f: string) => ({ field: f, zone: 'columns' })),
          ...t.values.map((v: any) => ({ field: v.field, zone: 'values' })),
          ...Object.keys(t.filters || {}).map((f: string) => ({ field: f, zone: 'filters' })),
        ];
        for (const { field, zone } of allFields) {
          if (!colNames.includes(field) && !mismatches.find(m => m.field === field)) {
            mismatches.push({ field, zone, suggestion: fuzzyMatch(field, colNames) });
          }
        }
      }
      if (data.annotationsMap) setAnnotationsMap(data.annotationsMap);
      if (data.comparisonState) setComparisonState(data.comparisonState);
      if (data.projectFilters) setProjectFilters(data.projectFilters);
      if (mismatches.length > 0) {
        setReconcileState({ pendingTables: data.tables, mismatches, mapping: Object.fromEntries(mismatches.map(m => [m.field, m.suggestion])) });
      } else {
        pushUndo();
        setTables(data.tables);
        setActiveTableIdx(0);
        setResults(new Map());
        setTimeout(() => data.tables.forEach((t: TableConfig) => { if (t.values.length > 0) runTabulation(t); }), 100);
      }
    } catch (e: any) {
      setError(e.message || 'Failed to load project');
    }
  }, [allColumns, pushUndo, runTabulation]);

  const handleReorderTables = useCallback((fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx) return;
    pushUndo();
    setTables(prev => {
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
    setActiveTableIdx(prev => {
      if (prev === fromIdx) return toIdx;
      if (fromIdx < toIdx) {
        if (prev > fromIdx && prev <= toIdx) return prev - 1;
      } else {
        if (prev >= toIdx && prev < fromIdx) return prev + 1;
      }
      return prev;
    });
  }, [pushUndo]);

  const addTable = useCallback(() => {
    const id = String(Date.now());
    const num = tables.length + 1;
    pushUndo();
    setTables(prev => [...prev, createEmptyTable(id, `Table ${num}`)]);
    setActiveTableIdx(tables.length);
  }, [tables, pushUndo]);

  const duplicateTable = useCallback(() => {
    const src = tables[activeTableIdx];
    const id = String(Date.now());
    // Deep copy ALL settings including formatting, conditional formats, footnotes, etc.
    const copy: TableConfig = JSON.parse(JSON.stringify(src));
    copy.id = id;
    copy.name = `${src.name} (copy)`;
    pushUndo();
    setTables(prev => [...prev, copy]);
    setActiveTableIdx(tables.length);
    runTabulation(copy);
  }, [tables, activeTableIdx, pushUndo, runTabulation]);

  const handleTransposeTable = useCallback(() => {
    const table = tables[activeTableIdx];
    updateTable({ rows: table.columns, columns: table.rows });
  }, [tables, activeTableIdx, updateTable]);

  const refreshExtraColumns = useCallback(async () => {
    if (!dataset) return;
    try {
      const [metricsRes, binsRes] = await Promise.all([listMetrics(dataset.dataset_id), listBins(dataset.dataset_id)]);
      const metricCols: ColumnInfo[] = (metricsRes.metrics || []).map((m: any) => ({
        name: m.name, type: 'numeric' as const, sample_values: [], stats: { nulls: 0, unique: 0 },
      }));
      const binCols: ColumnInfo[] = (binsRes.bins || []).map((b: any) => ({
        name: b.name, type: 'text' as const, sample_values: [], stats: { nulls: 0, unique: 0 },
      }));
      setExtraColumns([...metricCols, ...binCols]);
      setMetricNames((metricsRes.metrics || []).map((m: any) => m.name));
      setBinNames((binsRes.bins || []).map((b: any) => b.name));
    } catch {}
  }, [dataset]);

  const refreshAuditLog = useCallback(async () => {
    if (!dataset) return;
    try {
      const res = await fetch(`${API_BASE}/audit/${dataset.dataset_id}`);
      if (res.ok) { const data = await res.json(); setAuditLog(data.logs || []); }
    } catch {}
  }, [dataset]);

  const handleSaveProject = useCallback(async () => {
    setModal('projects' as ModalType);
  }, []);

  const handleApplyLastProject = useCallback(async (projectName: string) => {
    try {
      // First list projects to find the path
      const listRes = await fetch(`${API_BASE}/projects`);
      const listData = await listRes.json();
      const proj = (listData.projects || []).find((p: any) => p.name === projectName);
      if (!proj) { setError(`Project "${projectName}" not found`); return; }

      // Load the project
      const res = await fetch(`${API_BASE}/project/load?path=` + encodeURIComponent(proj.path));
      if (!res.ok) throw new Error('Failed to load project');
      const data = await res.json();
      if (!data.tables || !Array.isArray(data.tables)) throw new Error('Invalid project data');

      // Check for column mismatches
      const colNames = allColumns.map(c => c.name);
      const mismatches: ReconcileState['mismatches'] = [];
      for (const t of data.tables) {
        const allFields = [
          ...t.rows.map((f: string) => ({ field: f, zone: 'rows' })),
          ...t.columns.map((f: string) => ({ field: f, zone: 'columns' })),
          ...t.values.map((v: any) => ({ field: v.field, zone: 'values' })),
          ...Object.keys(t.filters).map((f: string) => ({ field: f, zone: 'filters' })),
        ];
        for (const { field, zone } of allFields) {
          if (!colNames.includes(field) && !mismatches.find(m => m.field === field)) {
            mismatches.push({ field, zone, suggestion: fuzzyMatch(field, colNames) });
          }
        }
      }

      if (data.annotationsMap) setAnnotationsMap(data.annotationsMap);
      if (data.comparisonState) setComparisonState(data.comparisonState);

      if (mismatches.length > 0) {
        setShowDataPreview(false);
        setReconcileState({
          pendingTables: data.tables,
          mismatches,
          mapping: Object.fromEntries(mismatches.map(m => [m.field, m.suggestion])),
        });
      } else {
        pushUndo();
        setTables(data.tables);
        setActiveTableIdx(0);
        setResults(new Map());
        setShowDataPreview(false);
        setLastProjectHint(null);
        // Re-run all tabulations
        setTimeout(() => data.tables.forEach((t: TableConfig) => { if (t.values.length > 0) runTabulation(t); }), 100);
      }
    } catch (e: any) {
      setError(e.message || 'Failed to apply project');
    }
  }, [allColumns, pushUndo, runTabulation]);

  const handleDataRefresh = useCallback(async () => {
    if (!dataset) return;
    try {
      setLoading(true);
      await refreshDataset(dataset.dataset_id);
      tables.forEach(t => { if (t.values.length > 0) runTabulation(t); });
    } catch (e: any) {
      setError('Refresh failed: ' + (e.message || ''));
    } finally { setLoading(false); }
  }, [dataset, tables, runTabulation]);

  const handleTextClean = useCallback(async (action: string, caseType?: string) => {
    if (!dataset) return;
    setLoading(true); setError(null);
    try {
      const actions: any[] = action === 'trim_whitespace'
        ? [{ action: 'trim_whitespace' }]
        : dataset.columns.filter(c => c.type === 'text').map(c => ({ action: 'text_case', column: c.name, case_type: caseType }));
      if (actions.length === 0) { setError('No text columns found'); setLoading(false); return; }
      const res = await fetch(`${API_BASE}/dataset/clean_bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataset_id: dataset.dataset_id, actions }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      if (data.columns) setDataset(prev => prev ? { ...prev, columns: data.columns } : prev);
      tables.forEach(t => { if (t.values.length > 0) runTabulation(t); });
      setError(null);
      alert(data.messages?.join('\n') || 'Done');
    } catch (e: any) {
      setError(e.message || 'Clean failed');
    } finally { setLoading(false); }
  }, [dataset, tables, runTabulation]);

  const handleColumnTypeChange = useCallback(async (column: string, newType: string) => {
    if (!dataset) return;
    try {
      await changeColumnType(dataset.dataset_id, column, newType);
      // Update the column type in local dataset state so the UI reflects it immediately
      setDataset(prev => prev ? ({
        ...prev,
        columns: prev.columns.map(c => c.name === column ? { ...c, type: newType as any } : c),
      }) : prev);
      // Re-run tabulation so the new type takes effect in the result
      const activeT = tables[activeTableIdx];
      if (activeT && activeT.values.length > 0) runTabulation(activeT);
    } catch (e: any) {
      setError(e.message || 'Failed to change column type');
    }
  }, [dataset, tables, activeTableIdx, runTabulation]);

  const reloadFileRef = useRef<HTMLInputElement>(null);
  const handleReloadFile = useCallback(async (file: File) => {
    if (!dataset) return;
    setLoading(true); setError(null);
    try {
      const meta = await uploadFile(file);
      // Keep all tables, just update dataset and re-run tabulations
      setDataset(meta);
      setExtraColumns([]);
      // Re-run all tabulations with new data
      setTimeout(() => {
        tables.forEach(t => { if (t.values.length > 0) runTabulation(t); });
      }, 100);
    } catch (e: any) {
      setError('Reload failed: ' + (e.message || ''));
    } finally { setLoading(false); }
  }, [dataset, tables, runTabulation]);

  if (!dataset) {
    return (
      <div className="app" data-theme="dark">
        <TopBar onFileUpload={handleFileUpload} dataset={dataset}
          onAction={a => { if (a === 'metric_library') setModal(a as ModalType); }}
          onToggleTheme={() => setTheme(t => t === 'dark' ? 'light' : 'dark')} theme={theme}
          ribbonTab={ribbonTab} onRibbonTabChange={setRibbonTab} />
        <RibbonBar table={null} dataset={false} activeTab={ribbonTab}
          onAction={a => {
            if (a === 'theme') setTheme(t => t === 'dark' ? 'light' : 'dark');
            else if (a === 'import' || a === 'import_file') ribbonFileRef.current?.click();
            else if (a.startsWith('load_project:')) handleLoadProjectByPath(a.slice('load_project:'.length));
            else if (a === 'metric_library' || a === 'projects') setModal(a as ModalType);
          }}
          onUpdate={() => {}} theme={theme} />
        <WelcomeScreen onFileUpload={handleFileUpload} loading={loading}
          uploadProgress={uploadProgress}
          fgContext={fgContext}
          onDatasetLoaded={meta => { setDataset(meta); setError(null); }}
          error={pendingProjectData ? null : error}
          onProjectImport={(data) => {
            setPendingProjectData(data);
            setError(null);
          }}
          onLoadFgProject={(proj) => {
            if (proj.data?.tables) {
              setPendingProjectData(proj.data);
              setError(null);
            }
          }} />
        {pendingProjectData && (
          <div style={{ position: 'fixed', top: 120, left: '50%', transform: 'translateX(-50%)', zIndex: 1000, background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.4)', borderRadius: 8, padding: '12px 20px', maxWidth: 500, textAlign: 'center', fontSize: 13, color: 'var(--text)' }}>
            <strong>Project "{pendingProjectData.meta?.name || 'Untitled'}" loaded</strong> ({pendingProjectData.tables?.length || 0} table(s))
            <br />
            <span style={{ fontSize: 12, opacity: 0.8 }}>Now import your Excel/CSV data file above to generate tables.</span>
            <button style={{ marginLeft: 12, background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 14 }}
              onClick={() => setPendingProjectData(null)}>x</button>
          </div>
        )}
        <StatusBar dataset={dataset} result={currentResult} />
        {modal === 'metric_library' && <MetricLibrary onClose={() => setModal(null)} />}
        <input ref={ribbonFileRef} type="file" accept=".xlsx,.xls,.csv,.tsv"
          style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); e.target.value = ''; }} />
      </div>
    );
  }

  if (showDataPreview) {
    return (
      <div className="app" data-theme="dark">
        <TopBar onFileUpload={handleFileUpload} dataset={dataset}
          onAction={a => setModal(a as ModalType)}
          onToggleTheme={() => setTheme(t => t === 'dark' ? 'light' : 'dark')} theme={theme}
          ribbonTab={ribbonTab} onRibbonTabChange={setRibbonTab} />
        <RibbonBar table={null} dataset={!!dataset} activeTab={ribbonTab}
          onAction={a => {
            if (a === 'theme') setTheme(t => t === 'dark' ? 'light' : 'dark');
            else setModal(a as ModalType);
          }}
          onUpdate={() => {}} theme={theme} />
        <DataPreview dataset={dataset} onProceed={() => setShowDataPreview(false)}
          onDatasetUpdate={(updates) => setDataset(prev => prev ? { ...prev, ...updates } : prev)} />
        {lastProjectHint && (
          <div style={{ margin: '0 16px 8px', padding: '10px 16px', background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.35)', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 12, fontSize: 13 }}>
            <span>Previous project found: <strong>{lastProjectHint}</strong></span>
            <button className="btn-primary" style={{ fontSize: 12, padding: '5px 16px' }}
              onClick={() => handleApplyLastProject(lastProjectHint!)}>
              Generate Tables from Project
            </button>
            <button className="btn-secondary" style={{ fontSize: 11, padding: '4px 10px' }}
              onClick={() => setLastProjectHint(null)}>Dismiss</button>
          </div>
        )}
        <StatusBar dataset={dataset} result={currentResult} />
        {modal === 'quality' && <DataQualityPanel datasetId={dataset.dataset_id} onClose={() => setModal(null)}
        onDataChanged={() => {
          // Re-run tabulations after data cleaning
          tables.forEach(t => { if (t.values.length > 0) runTabulation(t); });
        }} />}
      </div>
    );
  }

  return (
    <div className="app" data-theme="dark">
      <TopBar onFileUpload={handleFileUpload} dataset={dataset}
        onAction={a => {
          if (a === 'save') handleSaveProject();
          else if (a === 'duplicate') duplicateTable();
          else if (a === 'undo') handleUndo();
          else if (a === 'redo') handleRedo();
          else if (a === 'refresh') handleDataRefresh();
          else if (a === 'transpose') handleTransposeTable();
          else if (a === 'tour') setShowTour(true);
          else if (a === 'dashboard') setActiveTableIdx(-1);
          else if (a === 'import_file') ribbonFileRef.current?.click();
          else if (a.startsWith('load_project:')) handleLoadProjectByPath(a.slice('load_project:'.length));
          else setModal(a as ModalType);
        }}
        onToggleTheme={() => setTheme(t => t === 'dark' ? 'light' : 'dark')} theme={theme}
        ribbonTab={ribbonTab} onRibbonTabChange={setRibbonTab}
        fgHomeUrl={fgContext ? fgContext.fgUrl + '/dashboard' : undefined}
      />
      <RibbonBar
        table={activeTable}
        dataset={!!dataset}
        activeTab={ribbonTab}
        projectFilterCount={Object.values(projectFilters).filter(v => v.length > 0).length}
        onAction={a => {
          if (a === 'save') handleSaveProject();
          else if (a === 'duplicate') duplicateTable();
          else if (a === 'undo') handleUndo();
          else if (a === 'redo') handleRedo();
          else if (a === 'refresh') handleDataRefresh();
          else if (a === 'reload_data') { reloadFileRef.current?.click(); }
          else if (a === 'transpose') handleTransposeTable();
          else if (a === 'tour') setShowTour(true);
          else if (a === 'dashboard') setActiveTableIdx(-1);
          else if (a === 'theme') setTheme(t => t === 'dark' ? 'light' : 'dark');
          else if (a === 'import' || a === 'import_file') { ribbonFileRef.current?.click(); }
          else if (a === 'clean_trim') handleTextClean('trim_whitespace');
          else if (a === 'clean_upper') handleTextClean('text_case', 'upper');
          else if (a === 'clean_lower') handleTextClean('text_case', 'lower');
          else if (a === 'clean_proper') handleTextClean('text_case', 'proper');
          else if (a === 'filter_panel') setShowFilterPanel(s => !s);
          else if (a === 'project_filter') setShowProjectFilterPanel(s => !s);
          else if (a.startsWith('load_project:')) handleLoadProjectByPath(a.slice('load_project:'.length));
          else setModal(a as ModalType);
        }}
        onUpdate={update => updateTable(update)}
        theme={theme}
        columns={allColumns}
        onColumnTypeChange={handleColumnTypeChange}
      />
      {lastProjectHint && (
        <div style={{ margin: '0 12px', padding: '8px 14px', background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, flexShrink: 0 }}>
          <span>Previous project: <strong>{lastProjectHint}</strong></span>
          <button className="btn-primary" style={{ fontSize: 11, padding: '4px 12px' }}
            onClick={() => handleApplyLastProject(lastProjectHint!)}>
            Generate Tables
          </button>
          <button className="btn-secondary" style={{ fontSize: 10, padding: '3px 8px' }}
            onClick={() => { setModal('projects'); setLastProjectHint(null); }}>
            Browse Projects
          </button>
          <button style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 14, marginLeft: 'auto' }}
            onClick={() => setLastProjectHint(null)}>×</button>
        </div>
      )}
      <div className="workspace">
        <SourcePanel columns={allColumns}
          onDragStart={f => setDraggedField(f)} onDragEnd={() => setDraggedField(null)}
          metricNames={metricNames} binNames={binNames}
          usedColumns={activeTable ? { rows: activeTable.rows, columns: activeTable.columns, values: activeTable.values.map(v => v.field) } : undefined}
          onMultiDrop={(zone, fields) => {
            if (activeTableIdx < 0) return;
            pushUndo();
            const table = tables[activeTableIdx];
            if (zone === 'values') {
              const newVals = [...table.values];
              fields.forEach(f => {
                if (!newVals.find(v => v.field === f)) {
                  newVals.push(createValueField({ ...table, values: newVals }, f));
                }
              });
              updateTable({ values: newVals });
            } else if (zone === 'rows') {
              const newRows = [...table.rows];
              fields.forEach(f => { if (!newRows.includes(f)) newRows.push(f); });
              updateTable({ rows: newRows });
            } else if (zone === 'columns') {
              const newCols = [...table.columns];
              fields.forEach(f => { if (!newCols.includes(f)) newCols.push(f); });
              updateTable({ columns: newCols });
            }
          }}
          tables={tables}
          activeTableIdx={activeTableIdx}
          results={results}
          error={error}
          onTableSelect={i => { setActiveTableIdx(i); if (i >= 0 && tables[i]?.values.length > 0) runTabulation(tables[i]); }}
          onAddTable={addTable}
          onDuplicateTable={duplicateTable}
          onRenameTable={(idx, newName) => {
            pushUndo();
            setTables(prev => prev.map((tb, ti) => ti === idx ? { ...tb, name: newName } : tb));
          }}
          onDeleteTable={idx => {
            if (tables.length <= 1) return;
            pushUndo();
            setTables(prev => prev.filter((_, ti) => ti !== idx));
            setActiveTableIdx(Math.max(0, idx - 1));
          }}
          onDuplicateTables={indices => {
            pushUndo();
            const copies = indices.map(idx => {
              const src = tables[idx];
              const copy: TableConfig = JSON.parse(JSON.stringify(src));
              copy.id = String(Date.now() + Math.random());
              copy.name = `${src.name} (copy)`;
              return copy;
            });
            setTables(prev => [...prev, ...copies]);
            setActiveTableIdx(tables.length); // select first copy
            copies.forEach(c => { if (c.values.length > 0) runTabulation(c); });
          }}
          onDeleteTables={indices => {
            if (tables.length - indices.length < 1) return; // keep at least 1
            pushUndo();
            const idxSet = new Set(indices);
            setTables(prev => prev.filter((_, ti) => !idxSet.has(ti)));
            setActiveTableIdx(0);
          }}
          onReorderTables={handleReorderTables}
        />
        <div className="center-area">
          {activeTable && (
          <>
          <DropZones table={activeTable} columns={allColumns} draggedField={draggedField}
            onDrop={handleDrop} onRemove={handleRemoveField} onAggChange={handleAggChange}
            onValueFieldUpdate={handleValueFieldUpdate}
            onReorder={handleReorder} onMoveField={handleMoveField}
            onDateGroupSuggest={handleDateGroupSuggest}
            onOpenFilters={() => setShowFilterPanel(true)}
          />
          {/* Quick Ribbon for Value Fields */}
          {activeTable.values.length > 0 && (
            <div className="value-ribbon">
              {activeTable.values.map(v => (
                <div key={v.field} className="ribbon-field">
                  <span className="ribbon-field-name">{v.field}</span>
                  <select className="ribbon-select" value={v.agg} title="Summarize By"
                    onChange={e => handleAggChange(v.field, e.target.value)}>
                    <option value="sum">Sum</option>
                    <option value="count">Count</option>
                    <option value="average">Avg</option>
                    <option value="min">Min</option>
                    <option value="max">Max</option>
                    <option value="median">Median</option>
                    <option value="count_distinct">Distinct</option>
                  </select>
                  <select className="ribbon-select" value={v.show_as || 'normal'} title="Show Values As"
                    onChange={e => handleValueFieldUpdate(v.field, { show_as: e.target.value })}>
                    <option value="normal">Normal</option>
                    <option value="pct_grand">% of Total</option>
                    <option value="pct_row">% of Row</option>
                    <option value="pct_col">% of Column</option>
                    <option value="pct_parent_row">% Parent Row</option>
                    <option value="pct_parent_col">% Parent Col</option>
                    <option value="running_total">Running Total</option>
                    <option value="rank_asc">Rank Asc</option>
                    <option value="rank_desc">Rank Desc</option>
                    <option value="index">Index</option>
                  </select>
                  <select className="ribbon-select ribbon-dec" value={v.decimals ?? 2} title="Decimal Places"
                    onChange={e => handleValueFieldUpdate(v.field, { decimals: parseInt(e.target.value) })}>
                    {[0,1,2,3,4,5,6].map(n => <option key={n} value={n}>{n}dp</option>)}
                  </select>
                  <select className="ribbon-select" value={v.combo_show_as || 'normal'} title="Combination: Value (%)"
                    onChange={e => handleValueFieldUpdate(v.field, { combo_show_as: e.target.value })}>
                    <option value="normal">No Combo</option>
                    <option value="pct_grand">+ % Total</option>
                    <option value="pct_row">+ % Row</option>
                    <option value="pct_col">+ % Col</option>
                  </select>
                </div>
              ))}
            </div>
          )}
          {showFilterPanel && <FilterPanel table={activeTable} datasetId={dataset.dataset_id}
            onFilterChange={handleFilterChange}
            onRemoveFilter={(field) => handleRemoveField('filters', field)}
            onClose={() => setShowFilterPanel(false)} />}
          {showProjectFilterPanel && dataset && (
            <ProjectFilterPanel
              filters={projectFilters}
              datasetId={dataset.dataset_id}
              allColumns={allColumns}
              onChange={f => setProjectFilters(f)}
              onClose={() => setShowProjectFilterPanel(false)}
            />
          )}
          {/* Editable Table Title */}
          <div className="table-title-bar">
            <input className="table-title-input" type="text"
              value={activeTable.title} placeholder="Click to add table title..."
              onChange={e => updateTable({ title: e.target.value, _autoTitle: false } as any)}
              onBlur={e => { if (dataset && e.target.value) logAuditEvent(dataset.dataset_id, 'table_title_change', `Title set to: "${e.target.value}" on table "${activeTable.name}"`); }} />
            <input className="table-subtitle-input" type="text"
              value={activeTable.subtitle} placeholder="Subtitle (optional)"
              onChange={e => updateTable({ subtitle: e.target.value, _autoTitle: false } as any)} />
            <button className="title-dup-btn" onClick={duplicateTable}
              title="Duplicate this table (same structure, new copy)">
              <span className="title-dup-icon">⧉</span>
              <span className="title-dup-label">Duplicate Table</span>
            </button>
            <button className="title-del-btn"
              title="Delete this table"
              onClick={() => {
                if (tables.length <= 1) { setError('Cannot delete the only table'); return; }
                if (window.confirm(`Delete table "${activeTable.name}"? This cannot be undone.`)) {
                  pushUndo();
                  const newIdx = Math.max(0, activeTableIdx - 1);
                  setTables(prev => prev.filter((_, ti) => ti !== activeTableIdx));
                  setActiveTableIdx(newIdx);
                }
              }}>
              <span>🗑</span>
              <span className="title-del-label">Delete</span>
            </button>
          </div>
          </>
          )}
          {activeTableIdx === -1 ? (
            <SummaryDashboard tables={tables} results={results}
              onTableSelect={i => { setActiveTableIdx(i); if (tables[i].values.length > 0) runTabulation(tables[i]); }} />
          ) : <LivePreview result={currentResult} loading={loading} error={error}
            title={activeTable.title} subtitle={activeTable.subtitle}
            datasetId={dataset.dataset_id} tableConfig={activeTable}
            annotations={annotationsMap[activeTable?.id] || []}
            onAnnotationsChange={anns => setAnnotationsMap(prev => ({ ...prev, [activeTable.id]: anns }))}
            tableMode={theme}
            onHeaderRename={(original, newName) => {
              const renames = { ...(activeTable.header_renames || {}) };
              if (newName && newName !== original) {
                renames[original] = newName;
                if (dataset) logAuditEvent(dataset.dataset_id, 'column_rename', `Column "${original}" renamed to "${newName}" in table "${activeTable.name}"`);
              } else {
                delete renames[original];
              }
              updateTable({ header_renames: renames });
            }}
          />}
        </div>
      </div>
      <StatusBar dataset={dataset} result={currentResult} undoCount={undoStack.length} redoCount={redoStack.length} />
      {uploadProgress != null && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999 }}>
          <div style={{ height: 3, background: 'rgba(59,130,246,0.2)' }}>
            <div style={{ height: '100%', width: `${uploadProgress}%`, background: '#3b82f6', transition: 'width 0.2s' }} />
          </div>
          <div style={{ position: 'absolute', top: 6, left: '50%', transform: 'translateX(-50%)', background: 'rgba(15,23,42,0.9)', color: '#e2e8f0', padding: '4px 16px', borderRadius: 4, fontSize: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.3)' }}>
            {uploadProgress < 100 ? `Uploading… ${uploadProgress}%` : 'Processing file…'}
          </div>
        </div>
      )}
      {showTour && <OnboardingTour onClose={() => setShowTour(false)} />}

      {/* Date grouping suggestion modal */}
      {dateGroupModal && (
        <div className="modal-overlay" onClick={() => setDateGroupModal(null)}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Date Grouping</h2>
              <button className="modal-close" onClick={() => setDateGroupModal(null)}>×</button>
            </div>
            <div className="modal-body">
              <p>Group <strong>{dateGroupModal}</strong> by:</p>
              <div className="date-group-grid">
                {['year', 'quarter', 'month', 'week', 'day'].map(g => (
                  <button key={g} className="date-group-btn"
                    onClick={() => handleDateGroupApply(dateGroupModal, g)}>
                    {g.charAt(0).toUpperCase() + g.slice(1)}
                  </button>
                ))}
              </div>
              <button className="btn-secondary" style={{ marginTop: 12 }}
                onClick={() => setDateGroupModal(null)}>
                No grouping (use raw values)
              </button>
            </div>
          </div>
        </div>
      )}

      {modal === 'metrics' && <MetricBuilder datasetId={dataset.dataset_id} columns={allColumns}
        onCreated={() => { setModal(null); refreshExtraColumns(); }} onClose={() => setModal(null)}
        onOpenLibrary={() => setModal('metric_library')} />}
      {modal === 'metric_library' && <MetricLibrary
        datasetId={dataset.dataset_id}
        onImported={() => refreshExtraColumns()}
        onClose={() => setModal(null)} />}
      {modal === 'bins' && <BinCreator datasetId={dataset.dataset_id} columns={allColumns}
        onCreated={() => { setModal(null); refreshExtraColumns(); }} onClose={() => setModal(null)} />}
      {modal === 'export' && <ExportDialog datasetId={dataset.dataset_id} tables={tables} results={results}
        annotationsMap={annotationsMap}
        onClose={() => setModal(null)} />}
      {modal === 'quality' && <DataQualityPanel datasetId={dataset.dataset_id} onClose={() => setModal(null)}
        onDataChanged={() => {
          // Re-run tabulations after data cleaning
          tables.forEach(t => { if (t.values.length > 0) runTabulation(t); });
        }} />}
      {modal === 'comparison' && <ComparisonPanel datasetId={dataset.dataset_id} columns={allColumns}
        onClose={() => setModal(null)}
        initialConfig={activeTable?.comparisonConfig || undefined}
        onConfigChange={(cfg) => {
          setTables(prev => {
            const next = [...prev];
            next[activeTableIdx] = { ...next[activeTableIdx], comparisonConfig: cfg };
            return next;
          });
        }}
      />}
      {modal === 'report' && <ReportBuilder tables={tables} results={results} onClose={() => setModal(null)}
        initialElements={reportTemplate?.elements} initialDocStyle={reportTemplate?.docStyle}
        onSaveTemplate={(els, ds) => setReportTemplate({ elements: els, docStyle: ds })}
        datasetFilename={dataset.filename} datasetRowCount={dataset.row_count}
        auditLog={auditLog} />}
      {modal === 'table_compare' && tables.length >= 2 && <TableComparison tables={tables} results={results} onClose={() => setModal(null)} />}
      {modal === 'charts' && <ChartBuilder tables={tables} results={results}
        onChartChange={(tableId, chartConfig) => {
          setTables(prev => prev.map(t => t.id === tableId ? { ...t, chartConfig } : t));
        }}
        onClose={() => setModal(null)} />}
      {(modal === 'stat_correlation' || modal === 'stat_descriptive' || modal === 'stat_crosstab' || modal === 'stat_ttest' || modal === 'stat_anova' || modal === 'stat_regression' || modal === 'stat_normality' || modal === 'stat_outlier' || modal === 'stat_frequency') && (
        <StatisticalTables
          type={modal.replace('stat_', '') as any}
          datasetId={dataset.dataset_id}
          columns={allColumns}
          onClose={() => setModal(null)}
        />
      )}
      {modal === 'audit' && <AuditTrail datasetId={dataset.dataset_id} onClose={() => setModal(null)} />}
      {modal === 'projects' && <ProjectManager currentTables={tables}
        currentAnnotationsMap={annotationsMap} currentComparisonState={comparisonState} currentProjectFilters={projectFilters} currentFilename={dataset?.filename}
        currentDatasetId={dataset?.dataset_id} currentRowCount={dataset?.row_count} currentColCount={dataset?.columns?.length}
        onLoad={(loadedTables, loadedAnnotations, loadedExtra) => {
          if (loadedAnnotations) setAnnotationsMap(loadedAnnotations);
          if (loadedExtra?.reportTemplate) setReportTemplate(loadedExtra.reportTemplate);
          if (loadedExtra?.comparisonState) setComparisonState(loadedExtra.comparisonState);
          if (loadedExtra?.projectFilters) setProjectFilters(loadedExtra.projectFilters);
          // Migrate legacy global comparisonState into per-table comparisonConfig
          if (loadedExtra?.comparisonState && loadedTables.length > 0) {
            const legacy = loadedExtra.comparisonState;
            loadedTables = loadedTables.map(t =>
              t.comparisonConfig ? t : { ...t, comparisonConfig: legacy }
            );
          }
          if (!dataset) {
            pushUndo();
            setTables(loadedTables);
            setActiveTableIdx(0);
            setResults(new Map());
            setModal(null);
            return;
          }
          // Check for column mismatches
          const colNames = allColumns.map(c => c.name);
          const mismatches: ReconcileState['mismatches'] = [];
          for (const t of loadedTables) {
            const allFields = [
              ...t.rows.map(f => ({ field: f, zone: 'rows' })),
              ...t.columns.map(f => ({ field: f, zone: 'columns' })),
              ...t.values.map(v => ({ field: v.field, zone: 'values' })),
              ...Object.keys(t.filters).map(f => ({ field: f, zone: 'filters' })),
            ];
            for (const { field, zone } of allFields) {
              if (!colNames.includes(field) && !mismatches.find(m => m.field === field)) {
                mismatches.push({ field, zone, suggestion: fuzzyMatch(field, colNames) });
              }
            }
          }
          if (mismatches.length > 0) {
            setModal(null);
            setReconcileState({
              pendingTables: loadedTables,
              mismatches,
              mapping: Object.fromEntries(mismatches.map(m => [m.field, m.suggestion])),
            });
          } else {
            pushUndo();
            setTables(loadedTables);
            setActiveTableIdx(0);
            setResults(new Map());
            setModal(null);
          }
        }}
        onClose={() => setModal(null)} fgContext={fgContext} />}
      {/* Column Reconciliation Dialog */}
      {reconcileState && (
        <div className="modal-overlay">
          <div className="modal modal-md">
            <div className="modal-header">
              <h2>Column Reconciliation</h2>
            </div>
            <div className="modal-body">
              <p style={{ marginBottom: 12, fontSize: 13, color: 'var(--text-dim)' }}>
                The loaded project references columns not found in the current dataset.
                Map each missing column to a column in your new file.
              </p>
              <div className="reconcile-list">
                {reconcileState.mismatches.map(m => (
                  <div key={m.field} className="reconcile-row">
                    <div className="reconcile-from">
                      <span className="reconcile-field">{m.field}</span>
                      <span className="reconcile-zone">({m.zone})</span>
                    </div>
                    <span className="reconcile-arrow">→</span>
                    <select
                      value={reconcileState.mapping[m.field] || ''}
                      onChange={e => setReconcileState(rs => rs ? ({
                        ...rs,
                        mapping: { ...rs.mapping, [m.field]: e.target.value },
                      }) : rs)}>
                      <option value="">-- skip --</option>
                      {allColumns.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>
            <div className="modal-footer" style={{ gap: 8 }}>
              <button className="btn-secondary" onClick={() => setReconcileState(null)}>Cancel</button>
              <button className="btn-secondary" onClick={() => {
                // Load without remapping
                pushUndo();
                setTables(reconcileState.pendingTables);
                setActiveTableIdx(0); setResults(new Map());
                setReconcileState(null);
              }}>Load As-Is</button>
              <button className="btn-primary" onClick={() => {
                // Apply mapping
                const mapping = reconcileState.mapping;
                const remapped = reconcileState.pendingTables.map(t => {
                  const remapField = (f: string) => mapping[f] && mapping[f] !== '' ? mapping[f] : f;
                  return {
                    ...t,
                    rows: t.rows.map(remapField),
                    columns: t.columns.map(remapField),
                    values: t.values.map(v => ({ ...v, field: remapField(v.field) })),
                    filters: Object.fromEntries(
                      Object.entries(t.filters).map(([k, v]) => [remapField(k), v])
                    ),
                  };
                });
                pushUndo();
                setTables(remapped);
                setActiveTableIdx(0); setResults(new Map());
                setReconcileState(null);
                // Re-run tabulations
                setTimeout(() => remapped.forEach(t => { if (t.values.length > 0) runTabulation(t); }), 100);
              }}>Apply Mapping</button>
            </div>
          </div>
        </div>
      )}
      {/* Annotation Reconciliation Dialog */}
      {orphanedAnnotations && orphanedAnnotations.length > 0 && (() => {
        const firstResult = results.get(orphanedAnnotations[0].tableId);
        return (
          <AnnotationReconcileDialog
            orphaned={orphanedAnnotations}
            newRowCount={firstResult?.rows.length || 0}
            newColCount={firstResult?.headers.length || 0}
            onResolve={(decisions) => {
              // Apply decisions to annotationsMap
              setAnnotationsMap(prev => {
                const next = { ...prev };
                for (const d of decisions) {
                  if (d.action === 'discard') {
                    next[d.tableId] = (next[d.tableId] || []).filter(
                      a => !(a.rowIdx === d.annotation.rowIdx && a.colIdx === d.annotation.colIdx)
                    );
                  } else if (d.action === 'remap' && d.newRowIdx !== undefined && d.newColIdx !== undefined) {
                    next[d.tableId] = (next[d.tableId] || []).map(a =>
                      a.rowIdx === d.annotation.rowIdx && a.colIdx === d.annotation.colIdx
                        ? { ...a, rowIdx: d.newRowIdx!, colIdx: d.newColIdx! }
                        : a
                    );
                  }
                  // 'keep' action: no change
                }
                return next;
              });
              setOrphanedAnnotations(null);
            }}
            onClose={() => setOrphanedAnnotations(null)}
          />
        );
      })()}
      {/* Resume popup */}
      {resumePrompt && (
        <div className="modal-overlay" style={{ zIndex: 9999 }}>
          <div className="modal" style={{ maxWidth: 420, padding: 32 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#f1f5f9', marginBottom: 12 }}>Resume where you left off?</div>
            <div style={{ fontSize: 14, color: '#94a3b8', marginBottom: 24 }}>
              We found an autosaved session for <strong style={{ color: '#e2e8f0' }}>{resumePrompt.filename}</strong>. Would you like to continue from where you stopped?
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn-primary" style={{ flex: 1 }} onClick={handleResumeYes}>Resume session</button>
              <button className="btn-secondary" style={{ flex: 1 }} onClick={handleResumeNo}>Start fresh</button>
            </div>
          </div>
        </div>
      )}
      <input ref={ribbonFileRef} type="file" accept=".xlsx,.xls,.csv,.tsv"
        style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); e.target.value = ''; }} />
      <input ref={reloadFileRef} type="file" accept=".xlsx,.xls,.csv,.tsv"
        style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) handleReloadFile(f); e.target.value = ''; }} />
    </div>
  );
}

/**
 * Merge project-level filters with a single table's filters.
 * - Project filter alone → apply it.
 * - Table filter alone   → apply it.
 * - Both filter same field → take the intersection (rows must satisfy both).
 * - An empty selection in either means "no restriction from that side".
 */
function mergeProjectFilters(
  projectFilters: Record<string, string[]>,
  tableFilters: Record<string, string[]>,
): Record<string, string[]> {
  const result: Record<string, string[]> = { ...tableFilters };
  for (const [field, pfValues] of Object.entries(projectFilters)) {
    if (pfValues.length === 0) continue;          // empty = no restriction
    const tfValues = tableFilters[field];
    if (tfValues === undefined || tfValues.length === 0) {
      result[field] = pfValues;                   // only project filter
    } else {
      result[field] = pfValues.filter(v => tfValues.includes(v));  // intersection
    }
  }
  return result;
}

function fuzzyMatch(field: string, candidates: string[]): string {
  const f = field.toLowerCase().replace(/[_\s-]/g, '');
  let best = '';
  let bestScore = 0;
  for (const c of candidates) {
    const cn = c.toLowerCase().replace(/[_\s-]/g, '');
    if (cn === f) return c;
    // Compute overlap score
    let score = 0;
    for (let i = 0; i < Math.min(f.length, cn.length); i++) {
      if (f[i] === cn[i]) score++;
    }
    if (cn.includes(f) || f.includes(cn)) score += 5;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best;
}

function AGG_LABEL(agg: string): string {
  const MAP: Record<string, string> = {
    sum: 'Sum', count: 'Count', average: 'Avg', min: 'Min', max: 'Max',
    median: 'Median', std: 'Std', var: 'Var',
    count_distinct: 'Distinct', first: 'First', last: 'Last',
  };
  return MAP[agg] || agg;
}

const SHOW_AS_SHORT: Record<string, string> = {
  normal: '', pct_grand: '% Total', pct_row: '% Row', pct_col: '% Col',
  pct_parent_row: '% Parent Row', pct_parent_col: '% Parent Col',
  running_total: 'Running', rank_asc: 'Rank↑', rank_desc: 'Rank↓', index: 'Index',
};

function buildValueLabel(agg: string, showAs?: string, comboShowAs?: string, field?: string): string {
  const aggLabel = AGG_LABEL(agg);
  const sa = showAs || 'normal';
  const combo = comboShowAs || 'normal';
  let label = `${aggLabel} of ${field || '?'}`;
  if (sa !== 'normal') {
    label += ` [${SHOW_AS_SHORT[sa] || sa}]`;
  }
  if (combo !== 'normal') {
    label += ` (+${SHOW_AS_SHORT[combo] || combo})`;
  }
  return label;
}
