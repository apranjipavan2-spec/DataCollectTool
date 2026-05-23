import React, { useState, useCallback, useEffect, useRef } from 'react';
import { DatasetMeta, TableConfig, TableResult, ColumnInfo, ValueField, DropZoneType, TableSection, NumberingConfig } from './types';
import { API_BASE, uploadFile, tabulate, listMetrics, listBins, saveProject, listProjects, refreshDataset, changeColumnType, dryRunColumnType, getColumnTypeHints, detectAnomalies, logAuditEvent, importFromFg, getColumnRoles, bulkSetColumnRoles, saveStudyDesign, cleanerApi, buildCleanerUrl } from './api';
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
import { AISmartPanel } from './components/AISmartPanel';
import { ColumnCreator } from './components/ColumnCreator';
import { AuditTrail } from './components/AuditTrail';
import { ProjectManager } from './components/ProjectManager';
import { SummaryDashboard } from './components/SummaryDashboard';
import { OnboardingTour, shouldShowTour } from './components/OnboardingTour';
import { TableComparison } from './components/TableComparison';
import { MetricLibrary } from './components/MetricLibrary';
import { AnnotationReconcileDialog, detectOrphanedAnnotations, ReconcileAnnotation } from './components/AnnotationReconcile';
import { ChartBuilder } from './components/ChartBuilder';
import { InlineChartPreview } from './components/InlineChartPreview';
import { RibbonBar, TABLE_TEMPLATES } from './components/RibbonBar';
import { StatisticalTables } from './components/StatisticalTables';
import { VariableMetadataPanel } from './components/VariableMetadataPanel';
import { StudyDesignWizard } from './components/StudyDesignWizard';
import { LikertPanel } from './components/LikertPanel';
import { MultiResponsePanel } from './components/MultiResponsePanel';
import { ObserverPanel } from './components/ObserverPanel';
import { BalancePanel } from './components/BalancePanel';
import { GeoSummaryPanel } from './components/GeoSummaryPanel';
import { DriverPanel } from './components/DriverPanel';
import { ClusterPanel } from './components/ClusterPanel';
import { VerbatimPanel } from './components/VerbatimPanel';
import { AutoAnalyzePanel } from './components/AutoAnalyzePanel';
import { SurveyInsightsPanel } from './components/SurveyInsightsPanel';
import { TypeConvertModal } from './components/TypeConvertModal';
import { SurveyQualityPanel } from './components/SurveyQualityPanel';
import { StatGuide, isGuideSkipped } from './components/StatGuide';
import { AdvancedAnalysisPanel, AdvancedKind } from './components/AdvancedAnalysisPanel';
import { PlayModePanel } from './components/PlayModePanel';

const ADVANCED_ACTIONS = new Set<AdvancedKind>([
  'causal_did', 'causal_psm', 'causal_mixed_lm', 'power_planner', 'export_codebook', 'exec_summary',
]);

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

type ModalType = null | 'metrics' | 'bins' | 'column-creator' | 'export' | 'quality' | 'comparison' | 'report' | 'audit' | 'projects' | 'table_compare' | 'metric_library' | 'charts' | 'stat_correlation' | 'stat_descriptive' | 'stat_crosstab' | 'stat_ttest' | 'stat_anova' | 'stat_regression' | 'stat_normality' | 'stat_outlier' | 'stat_frequency' | 'stat_paired_ttest' | 'stat_wilcoxon' | 'stat_mcnemar' | 'stat_kruskal' | 'stat_friedman' | 'stat_spearman' | 'stat_kendall' | 'stat_logistic_regression' | 'stat_multiple_regression' | 'stat_posthoc' | 'stat_reliability' | 'ai-polish' | 'ai-interpret' | 'ai-refine' | 'ai-suggest' | 'ai-smart-build' | 'ai-auto-generate' | 'ai-report' | 'ai-config' | 'anomalies' | 'diff' | 'variable_metadata' | 'study_design' | 'likert' | 'multi_response' | 'observer' | 'auto_analyze' | 'survey_insights' | 'survey_quality' | 'balance' | 'geo_summary' | 'driver' | 'cluster' | 'verbatim' | 'play_mode';

const STAT_GUIDE_ACTIONS = new Set<string>([
  'stat_correlation', 'stat_descriptive', 'stat_crosstab', 'stat_ttest', 'stat_anova',
  'stat_regression', 'stat_normality', 'stat_outlier', 'stat_frequency',
  'stat_paired_ttest', 'stat_wilcoxon', 'stat_mcnemar', 'stat_kruskal', 'stat_friedman',
  'stat_spearman', 'stat_kendall', 'stat_logistic_regression', 'stat_multiple_regression',
  'stat_posthoc', 'stat_reliability',
  'variable_metadata', 'study_design', 'likert', 'multi_response', 'observer', 'auto_analyze',
  'balance', 'geo_summary', 'driver', 'cluster', 'verbatim',
]);

interface ReconcileState {
  pendingTables: TableConfig[];
  mismatches: { field: string; zone: string; suggestion: string }[];
  mapping: Record<string, string>;
}

function AnomalyModal({ datasetId, onClose }: { datasetId: string; onClose: () => void }) {
  const [method, setMethod] = useState<'zscore' | 'mad'>('zscore');
  const [threshold, setThreshold] = useState(3.0);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Record<string, any> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(() => {
    setLoading(true);
    setError(null);
    detectAnomalies(datasetId, method, threshold)
      .then(r => setData(r.columns))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [datasetId, method, threshold]);

  useEffect(() => { run(); }, [run]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: 800, maxHeight: '85vh' }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>🚨 Auto-Flag Anomalies</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: 12, borderBottom: '1px solid var(--border)' }}>
          <label>Method:
            <select value={method} onChange={e => setMethod(e.target.value as any)} style={{ marginLeft: 6 }}>
              <option value="zscore">Z-score</option>
              <option value="mad">MAD (robust)</option>
            </select>
          </label>
          <label>Threshold:
            <input type="number" min={1} max={10} step={0.5} value={threshold}
              onChange={e => setThreshold(parseFloat(e.target.value) || 3.0)}
              style={{ marginLeft: 6, width: 70 }} />
          </label>
          <button className="btn-small btn-primary" onClick={run} disabled={loading}>
            {loading ? 'Detecting…' : 'Re-run'}
          </button>
        </div>
        <div className="modal-body" style={{ overflow: 'auto', padding: 12 }}>
          {error && <div className="preview-error">{error}</div>}
          {loading && <div style={{ padding: 12 }}>Analyzing numeric columns…</div>}
          {!loading && data && Object.keys(data).length === 0 && (
            <div style={{ padding: 12, opacity: 0.6 }}>No anomalies found at this threshold.</div>
          )}
          {!loading && data && Object.keys(data).length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th style={{ textAlign: 'left', padding: '6px 8px' }}>Column</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px' }}>Outliers</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px' }}>% of values</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px' }}>Example outliers (value · score)</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(data).map(([col, info]: [string, any]) => (
                  <tr key={col} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ padding: '6px 8px', fontWeight: 600 }}>{col}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', color: '#ef4444' }}>{info.count}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', opacity: 0.7 }}>
                      {((info.count / info.total) * 100).toFixed(1)}%
                    </td>
                    <td style={{ padding: '6px 8px', fontSize: 11, opacity: 0.85 }}>
                      {info.values.slice(0, 5).map((v: any, i: number) =>
                        `${v} (${info.scores[i]})`).join(', ')}
                      {info.count > 5 && ` … +${info.count - 5} more`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [dataset, setDataset] = useState<DatasetMeta | null>(null);
  const [fgContext, setFgContext] = useState<{ fgUrl: string; token: string; programId?: string } | null>(null);
  const [tables, setTables] = useState<TableConfig[]>([createEmptyTable('1', 'Table 1')]);
  const [activeTableIdx, setActiveTableIdx] = useState(0);
  const [previewTab, setPreviewTab] = useState<'table' | 'chart'>('table');
  const [sections, setSections] = useState<TableSection[]>([]);
  const [numberingConfig, setNumberingConfig] = useState<NumberingConfig>({ style: 'arabic', scope: 'continuous', prefix: 'Table ', suffix: ': ' });
  const [results, setResults] = useState<Map<string, TableResult>>(new Map());
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showDataPreview, setShowDataPreview] = useState(false);
  const [previewFocus, setPreviewFocus] = useState<{ row: number; column?: string } | null>(null);
  const [draggedField, setDraggedField] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalType>(null);
  const [advancedKind, setAdvancedKind] = useState<AdvancedKind | null>(null);
  const [lastAnalysisPack, setLastAnalysisPack] = useState<any[] | null>(null);
  const [guideSection, setGuideSection] = useState<string | null>(null);
  const [guidePendingModal, setGuidePendingModal] = useState<ModalType>(null);
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
  const [tableInterpretations, setTableInterpretations] = useState<Record<string, string>>({});
  const [expandedInterpretations, setExpandedInterpretations] = useState<Record<string, boolean>>({});
  const [editingInterpretation, setEditingInterpretation] = useState<string | null>(null);
  const [auditLog, setAuditLog] = useState<{ timestamp: string; action: string; details: string }[]>([]);
  const [metricNames, setMetricNames] = useState<string[]>([]);
  const [binNames, setBinNames] = useState<string[]>([]);
  const [columnDescriptions, setColumnDescriptions] = useState<Record<string, string>>({});
  const [columnTypeOverrides, setColumnTypeOverrides] = useState<Record<string, string>>({});
  const [columnRolesMap, setColumnRolesMap] = useState<Record<string, import('./types').ColumnRole>>({});
  // Captures the pre-AI-Polish snapshot so user can revert with one click even after closing the AI panel.
  // Snapshots cover only the touched table(s): scope='single' = active table; scope='all' = every table updated by batch polish.
  const [aiPolishUndo, setAiPolishUndo] = useState<{ snapshots: TableConfig[]; scope: 'single' | 'all'; appliedAt: number } | null>(null);
  // #15 Talk-to-your-data: when user submits NL query from ribbon Ask AI, prefill smart-build modal + auto-submit.
  const [smartBuildPrefill, setSmartBuildPrefill] = useState<{ query: string; autoSubmit: boolean } | null>(null);
  useEffect(() => {
    if (!aiPolishUndo) return;
    const t = setTimeout(() => setAiPolishUndo(curr => curr && curr.appliedAt === aiPolishUndo.appliedAt ? null : curr), 60000);
    return () => clearTimeout(t);
  }, [aiPolishUndo]);
  const [pendingMetadataRestore, setPendingMetadataRestore] = useState<{ column_roles?: Record<string, any>; study_design?: any } | null>(null);
  const [typeHints, setTypeHints] = useState<Array<{ column: string; suggested_type: 'numeric' | 'date'; success_rate: number; fail_count: number; samples: string[] }>>([]);
  const [dismissedHints, setDismissedHints] = useState<Set<string>>(new Set());
  const [typeConvertModal, setTypeConvertModal] = useState<{ column: string; newType: 'numeric' | 'date' | 'text' | 'multi_choice' } | null>(null);
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
      if (data.projectFilters) setProjectFilters(data.projectFilters);
      if (Array.isArray(data.sections)) setSections(data.sections);
      if (data.numberingConfig) setNumberingConfig(data.numberingConfig);
      if (data.columnTypeOverrides && dataset) {
        const overrides = data.columnTypeOverrides as Record<string, string>;
        setColumnTypeOverrides(overrides);
        setDataset(prev => prev ? ({
          ...prev,
          columns: prev.columns.map(c => overrides[c.name] ? { ...c, type: overrides[c.name] as any } : c),
        }) : prev);
        Object.entries(overrides).forEach(([col, newType]) => {
          changeColumnType(dataset.dataset_id, col, newType).catch(() => {});
        });
      }
      if (mismatches.length > 0) {
        setShowDataPreview(false);
        setReconcileState({ pendingTables: data.tables, mismatches, mapping: Object.fromEntries(mismatches.map(m => [m.field, m.suggestion])) });
      } else {
        setTables(data.tables);
        setActiveTableIdx(0);
        setResults(new Map());
        setShowDataPreview(false);
        // Trigger batch tabulation after state settles
        setTimeout(() => {
          const toRun = data.tables.filter((t: TableConfig) => t.values.length > 0);
          toRun.forEach((t: TableConfig) => runTabulation(t));
        }, 50);
      }
    }
  }, [pendingProjectData, dataset, allColumns]);

  // Track dirty state (unsaved changes)
  useEffect(() => {
    const currentState = JSON.stringify({ tables, annotationsMap, comparisonState, projectFilters });
    if (currentState !== lastSaveStateRef.current) {
      setIsDirty(true);
    }
  }, [tables, annotationsMap, comparisonState, projectFilters]);

  // Debounced immediate autosave for project filters (otherwise they only hit
  // disk on the 5-minute interval and reload-in-under-5-min loses them).
  useEffect(() => {
    if (!dataset) return;
    const t = setTimeout(() => {
      saveProject('__autosave__', {
        tables, annotationsMap, comparisonState,
        projectFilters: projectFiltersRef.current,
        columnTypeOverrides, sections, numberingConfig,
        dataset_id: dataset.dataset_id,
        source_file: { filename: dataset.filename, dataset_id: dataset.dataset_id, row_count: dataset.row_count, col_count: dataset.columns?.length },
      }).catch(() => {});
    }, 800);
    return () => clearTimeout(t);
  }, [projectFilters, dataset?.dataset_id]);

  // Auto-save every 5 minutes
  useEffect(() => {
    if (!dataset) return;
    if (autoSaveRef.current) clearInterval(autoSaveRef.current);
    autoSaveRef.current = setInterval(() => {
      if (tables.some(t => t.values.length > 0)) {
        // Use the ref for projectFilters so we always autosave the latest value
        // (the interval closure captures other state at effect-setup time, but
        // projectFilters can change without the deps array refreshing).
        saveProject('__autosave__', { tables, annotationsMap, comparisonState, projectFilters: projectFiltersRef.current, columnTypeOverrides, sections, numberingConfig, dataset_id: dataset?.dataset_id, source_file: dataset ? { filename: dataset.filename, dataset_id: dataset.dataset_id, row_count: dataset.row_count, col_count: dataset.columns?.length } : undefined }).then(() => {
          // Update last save state and clear dirty flag
          lastSaveStateRef.current = JSON.stringify({ tables, annotationsMap, comparisonState });
          setIsDirty(false);
        }).catch(() => {});
      }
    }, 5 * 60 * 1000);
    return () => { if (autoSaveRef.current) clearInterval(autoSaveRef.current); };
  }, [dataset, tables, annotationsMap, comparisonState, columnTypeOverrides]);

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

  // Fetch column-type hints whenever the dataset (or override set) changes
  useEffect(() => {
    if (!dataset) { setTypeHints([]); return; }
    let cancelled = false;
    getColumnTypeHints(dataset.dataset_id)
      .then(r => { if (!cancelled) setTypeHints(r.hints || []); })
      .catch(() => { if (!cancelled) setTypeHints([]); });
    return () => { cancelled = true; };
  }, [dataset?.dataset_id, columnTypeOverrides]);

  // Fetch column-role metadata (Phase 0: Survey Analysis Studio) on dataset load
  useEffect(() => {
    if (!dataset) { setColumnRolesMap({}); return; }
    let cancelled = false;
    getColumnRoles(dataset.dataset_id)
      .then(r => { if (!cancelled) setColumnRolesMap(r.roles || {}); })
      .catch(() => { if (!cancelled) setColumnRolesMap({}); });
    return () => { cancelled = true; };
  }, [dataset?.dataset_id]);

  // Push restored metadata back to the new dataset once it's available.
  useEffect(() => {
    if (!dataset || !pendingMetadataRestore) return;
    const { column_roles: cr, study_design: sd } = pendingMetadataRestore;
    setPendingMetadataRestore(null);
    (async () => {
      try {
        if (cr && Object.keys(cr).length) {
          await bulkSetColumnRoles(dataset.dataset_id, cr);
          setColumnRolesMap(cr);
        }
        if (sd && Object.keys(sd).length) {
          await saveStudyDesign(dataset.dataset_id, sd);
        }
      } catch {}
    })();
  }, [dataset?.dataset_id, pendingMetadataRestore]);

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
    setLoading(true); setLoadingMsg('Connecting to FieldGovern…');
    importFromFg(fgUrl, token, programId, undefined, (ev) => {
      setLoadingMsg(ev.message);
    })
      .then(meta => { setDataset(meta); setLoading(false); setLoadingMsg(''); })
      .catch(err => { setLoading(false); setLoadingMsg(''); setError(`Failed to load FieldGovern data: ${err}`); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lastUndoPushRef = useRef<{ time: number; key: string | null }>({ time: 0, key: null });
  const pushUndo = useCallback((opts?: { coalesceKey?: string }) => {
    // Coalesce rapid edits (e.g. typing in title input) into a single undo entry.
    // When the same coalesceKey is pushed again within 600ms, the existing snapshot
    // is still the correct "before" state — skip the push.
    if (opts?.coalesceKey) {
      const now = Date.now();
      const last = lastUndoPushRef.current;
      if (last.key === opts.coalesceKey && now - last.time < 600) {
        lastUndoPushRef.current = { time: now, key: opts.coalesceKey };
        return;
      }
      lastUndoPushRef.current = { time: now, key: opts.coalesceKey };
    } else {
      lastUndoPushRef.current = { time: 0, key: null };
    }
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
    if (Array.isArray(data.sections)) setSections(data.sections);
    if (data.numberingConfig) setNumberingConfig(data.numberingConfig);
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
    setLoading(true); setLoadingMsg('Uploading file…'); setError(null); setUploadProgress(0);
    try {
      const meta = await uploadFile(file, pct => { setUploadProgress(pct); if (pct >= 100) setLoadingMsg('Processing file…'); });
      setUploadProgress(null); setLoadingMsg('');
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

  const runTabulationCore = useCallback(async (config: TableConfig) => {
    if (!dataset || config.values.length === 0) {
      if (config.values.length === 0) setResults(prev => { const next = new Map(prev); next.delete(config.id); return next; });
      return;
    }
    const res = await tabulate({
      dataset_id: dataset.dataset_id,
      rows: config.rows, columns: config.columns, values: config.values,
      filters: mergeProjectFilters(projectFiltersRef.current, config.filters), grand_total: config.grand_total,
      grand_total_rows: config.grand_total_rows, grand_total_columns: config.grand_total_columns, grand_total_combined: config.grand_total_combined,
      subtotals: config.subtotals, subtotal_pct_base: config.subtotal_pct_base,
      missing_data: config.missing_data,
      sort_by: config.sort_by, sort_order: config.sort_order,
      multi_sort: config.multi_sort,
      date_groupings: config.date_groupings,
      blank_suppress: config.blank_suppress,
      hide_subgroup: config.hide_subgroup,
      net_rows: config.net_rows,
    });
    setResults(prev => {
      const next = new Map(prev);
      next.set(config.id, res);
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
  }, [dataset, annotationsMap, tables]);

  const runTabulation = useCallback(async (config: TableConfig) => {
    setLoading(true); setLoadingMsg('Generating table…'); setError(null);
    try {
      await runTabulationCore(config);
    } catch (e: any) {
      setError(e.message || 'Tabulation failed');
    } finally { setLoading(false); setLoadingMsg(''); }
  }, [runTabulationCore]);

  const updateTable = useCallback((update: Partial<TableConfig>) => {
    // Fields that affect what the backend computes; display-only fields (header_renames, title,
    // theme, formats, etc.) don't need a re-tabulation, which makes typing in those inputs snappy.
    const TABULATION_KEYS = new Set([
      'rows', 'columns', 'values', 'filters',
      'grand_total', 'grand_total_rows', 'grand_total_columns', 'grand_total_combined',
      'subtotals', 'subtotal_pct_base',
      'missing_data',
      'sort_by', 'sort_order', 'multi_sort',
      'date_groupings',
      'blank_suppress',
      'hide_subgroup',
    ]);
    // Text-edit fields where rapid keystrokes should collapse into a single undo entry.
    const TEXT_EDIT_KEYS = new Set(['title', 'subtitle', 'name', 'header_renames', 'footnote', 'table_number', 'table_number_prefix']);
    const keys = Object.keys(update);
    const needsTabulation = keys.some(k => TABULATION_KEYS.has(k));
    const isTextEditOnly = keys.length > 0 && keys.every(k => TEXT_EDIT_KEYS.has(k) || k === '_autoTitle');
    pushUndo(isTextEditOnly ? { coalesceKey: 'text-edit' } : undefined);
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
      if (needsTabulation) runTabulation(next[activeTableIdx]);
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

  const handleApplyTemplate = useCallback((templateId: string) => {
    const tpl = TABLE_TEMPLATES.find(t => t.id === templateId);
    if (!tpl) return;
    const table = tables[activeTableIdx];
    if (!table) return;
    const patch = tpl.apply(table);
    // For templates that produce a placeholder value (field=''), keep existing fields
    if (patch.values && patch.values.length === 1 && !patch.values[0].field && table.values.length > 0) {
      patch.values = table.values.map(v => ({ ...v, ...patch.values![0], field: v.field }));
    } else if (patch.values && table.values.length > 0) {
      // Preserve existing field names, apply template's agg/show_as/combo
      patch.values = table.values.map((v, i) => ({
        ...v,
        ...(patch.values![i] || patch.values![0]),
        field: v.field,
      }));
    }
    updateTable(patch);
  }, [tables, activeTableIdx, updateTable]);

  // Prompt state for numeric fields dropped into Columns zone
  const [numericPrompt, setNumericPrompt] = useState<{ field: string; zone: DropZoneType; fromZone?: DropZoneType } | null>(null);

  const handleDrop = useCallback((zone: DropZoneType, fieldName: string) => {
    const table = tables[activeTableIdx];
    // Prompt for numeric fields dropped into Columns zone
    if (zone === 'columns') {
      const col = allColumns.find(c => c.name === fieldName);
      if (col?.type === 'numeric') {
        setNumericPrompt({ field: fieldName, zone });
        return;
      }
    }
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
    setLoading(true); setLoadingMsg('Loading project…');
    try {
      const res = await fetch(`${API_BASE}/project/load?path=` + encodeURIComponent(path));
      if (!res.ok) throw new Error('Failed to load project');
      const data = await res.json();
      if (!data.tables || !Array.isArray(data.tables)) throw new Error('Invalid project data');

      if (data.annotationsMap) setAnnotationsMap(data.annotationsMap);
      if (data.comparisonState) setComparisonState(data.comparisonState);
      if (data.projectFilters) setProjectFilters(data.projectFilters);
      if (data.columnTypeOverrides && dataset) {
        const overrides = data.columnTypeOverrides as Record<string, string>;
        setColumnTypeOverrides(overrides);
        setDataset(prev => prev ? ({
          ...prev,
          columns: prev.columns.map(c => overrides[c.name] ? { ...c, type: overrides[c.name] as any } : c),
        }) : prev);
        Object.entries(overrides).forEach(([col, newType]) => {
          changeColumnType(dataset.dataset_id, col, newType).catch(() => {});
        });
      }

      // If no dataset loaded yet, reload the source file first then defer reconciliation
      if (allColumns.length === 0 && data.meta?.source_file) {
        const sf = data.meta.source_file;
        setLoadingMsg('Reloading source data file…');
        try {
          const reloadRes = await fetch(`${API_BASE}/project/reload-file`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(sf),
          });
          if (reloadRes.ok) {
            const meta = await reloadRes.json();
            setDataset(meta);
            setPendingProjectData(data);
            setLoading(false); setLoadingMsg('');
            return;
          }
        } catch {}
        // Reload failed — just set tables without reconciliation
        pushUndo();
        setTables(data.tables);
        setActiveTableIdx(0);
        setResults(new Map());
        setLoading(false); setLoadingMsg('');
        return;
      }

      // Dataset already loaded — check column mismatches
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
      if (mismatches.length > 0) {
        setReconcileState({ pendingTables: data.tables, mismatches, mapping: Object.fromEntries(mismatches.map(m => [m.field, m.suggestion])) });
      } else {
        pushUndo();
        setTables(data.tables);
        setActiveTableIdx(0);
        setResults(new Map());
        const toRun = data.tables.filter((t: TableConfig) => t.values.length > 0);
        const BATCH = 5;
        for (let i = 0; i < toRun.length; i += BATCH) {
          setLoadingMsg(`Generating tables ${i + 1}–${Math.min(i + BATCH, toRun.length)} of ${toRun.length}…`);
          await Promise.all(toRun.slice(i, i + BATCH).map((t: TableConfig) => runTabulationCore(t).catch(() => {})));
        }
      }
    } catch (e: any) {
      setError(e.message || 'Failed to load project');
    } finally { setLoading(false); setLoadingMsg(''); }
  }, [allColumns, pushUndo, runTabulationCore]);

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

  const togglePinTable = useCallback((idx: number) => {
    pushUndo();
    setTables(prev => prev.map((tb, ti) => ti === idx ? { ...tb, pinned: !tb.pinned } : tb));
  }, [pushUndo]);

  const handleAssignSection = useCallback((tableIdx: number, sectionId: string | undefined) => {
    pushUndo();
    setTables(prev => prev.map((tb, ti) => ti === tableIdx ? { ...tb, section_id: sectionId } : tb));
  }, [pushUndo]);

  const formatTableNumber = useCallback((n: number, style: NumberingConfig['style'], sectionIdx?: number): string => {
    const toRoman = (num: number): string => {
      const map: [number, string][] = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
        [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
      let out = '', remaining = num;
      for (const [val, sym] of map) { while (remaining >= val) { out += sym; remaining -= val; } }
      return out;
    };
    const toAlpha = (num: number): string => {
      let out = '', n2 = num;
      while (n2 > 0) { const r = (n2 - 1) % 26; out = String.fromCharCode(65 + r) + out; n2 = Math.floor((n2 - 1) / 26); }
      return out;
    };
    if (style === 'roman') return toRoman(Math.max(1, n));
    if (style === 'alpha') return toAlpha(Math.max(1, n));
    if (style === 'decimal' && sectionIdx !== undefined) return `${sectionIdx + 1}.${n}`;
    return String(n);
  }, []);

  const handleApplyNumbering = useCallback(() => {
    pushUndo();
    const prefix = numberingConfig.prefix || '';
    const suffix = numberingConfig.suffix || '';
    setTables(prev => {
      // Build ordered list of tables, grouped by section
      const sortedSections = [...sections].sort((a, b) => a.order - b.order);
      const grouped: Array<{ secIdx: number | undefined; tables: number[] }> = [];
      // Unsectioned first
      const unsectioned = prev.map((t, i) => (!t.section_id ? i : -1)).filter(i => i >= 0);
      if (unsectioned.length) grouped.push({ secIdx: undefined, tables: unsectioned });
      // Then by section order
      sortedSections.forEach((sec, si) => {
        const inSec = prev.map((t, i) => (t.section_id === sec.id ? i : -1)).filter(i => i >= 0);
        if (inSec.length) grouped.push({ secIdx: si, tables: inSec });
      });

      const numberByIdx: Record<number, string> = {};
      if (numberingConfig.scope === 'continuous') {
        let counter = 1;
        grouped.forEach(g => g.tables.forEach(idx => {
          numberByIdx[idx] = `${prefix}${formatTableNumber(counter, numberingConfig.style)}${suffix}`;
          counter++;
        }));
      } else {
        // per_section
        grouped.forEach(g => {
          let counter = 1;
          g.tables.forEach(idx => {
            numberByIdx[idx] = `${prefix}${formatTableNumber(counter, numberingConfig.style, g.secIdx)}${suffix}`;
            counter++;
          });
        });
      }
      return prev.map((tb, ti) => numberByIdx[ti] !== undefined
        ? { ...tb, table_number: numberByIdx[ti], table_number_prefix: '' }
        : tb);
    });
  }, [pushUndo, sections, numberingConfig, formatTableNumber]);

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
      if (data.columnTypeOverrides && dataset) {
        const overrides = data.columnTypeOverrides as Record<string, string>;
        setColumnTypeOverrides(overrides);
        setDataset(prev => prev ? ({
          ...prev,
          columns: prev.columns.map(c => overrides[c.name] ? { ...c, type: overrides[c.name] as any } : c),
        }) : prev);
        Object.entries(overrides).forEach(([col, newType]) => {
          changeColumnType(dataset.dataset_id, col, newType).catch(() => {});
        });
      }

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
        // Run tabulations in batches to avoid flooding backend
        const toRun = data.tables.filter((t: TableConfig) => t.values.length > 0);
        if (toRun.length > 0) {
          setLoading(true);
          const BATCH = 5;
          for (let i = 0; i < toRun.length; i += BATCH) {
            setLoadingMsg(`Generating tables ${i + 1}–${Math.min(i + BATCH, toRun.length)} of ${toRun.length}…`);
            await Promise.all(toRun.slice(i, i + BATCH).map((t: TableConfig) => runTabulationCore(t).catch(() => {})));
          }
          setLoading(false); setLoadingMsg('');
        }
      }
    } catch (e: any) {
      setError(e.message || 'Failed to apply project');
    }
  }, [allColumns, pushUndo, runTabulationCore]);

  const handleDataRefresh = useCallback(async () => {
    if (!dataset) return;
    try {
      setLoading(true); setLoadingMsg('Refreshing data…');
      await refreshDataset(dataset.dataset_id);
      tables.forEach(t => { if (t.values.length > 0) runTabulation(t); });
    } catch (e: any) {
      setError('Refresh failed: ' + (e.message || ''));
    } finally { setLoading(false); setLoadingMsg(''); }
  }, [dataset, tables, runTabulation]);

  // Cleaner handoff: open datacleaner in a new tab with a token, refresh dataset when it saves back.
  const cleanerWindowRef = useRef<Window | null>(null);
  const cleanerHandoffRef = useRef<string | null>(null);
  const cleanerPollRef = useRef<number | null>(null);

  const applyCleanerResult = useCallback((result: any) => {
    if (!result || !dataset) return;
    setDataset(prev => prev ? {
      ...prev,
      row_count: result.row_count ?? prev.row_count,
      columns: result.columns || prev.columns,
      preview: result.preview || prev.preview,
    } : prev);
    setColumnTypeOverrides({});
    setLoadingMsg('Regenerating tables from cleaned data…');
    setTimeout(() => {
      tables.forEach(t => { if (t.values.length > 0) runTabulation(t); });
      setLoadingMsg('');
    }, 50);
  }, [dataset, tables, runTabulation]);

  const handleOpenInCleaner = useCallback(async (focusCol?: string) => {
    if (!dataset) return;
    try {
      const { handoff_id } = await cleanerApi.handoff(dataset.dataset_id, focusCol);
      cleanerHandoffRef.current = handoff_id;
      const url = buildCleanerUrl(handoff_id, focusCol);
      const win = window.open(url, 'tf-cleaner', 'noopener=no');
      cleanerWindowRef.current = win;
      // Fallback: poll every 3s in case postMessage is blocked (e.g. cross-origin).
      if (cleanerPollRef.current) window.clearInterval(cleanerPollRef.current);
      cleanerPollRef.current = window.setInterval(async () => {
        if (!cleanerHandoffRef.current) return;
        try {
          const s = await cleanerApi.status(cleanerHandoffRef.current);
          if (s.completed && s.result) {
            applyCleanerResult(s.result);
            if (cleanerPollRef.current) window.clearInterval(cleanerPollRef.current);
            cleanerPollRef.current = null;
            const hid = cleanerHandoffRef.current;
            cleanerHandoffRef.current = null;
            if (hid) cleanerApi.revoke(hid);
          }
        } catch { /* network blip — keep polling */ }
      }, 3000);
    } catch (e: any) {
      // 502 here means the TF backend is reachable from the browser but somehow the handoff endpoint failed.
      // 502 inside the cleaner is a separate issue (cleaner backend can't reach TF over network).
      const raw = String(e?.message || '');
      const looksLikeHtml = /<html|<head|<body|nginx/i.test(raw);
      const cleaned = looksLikeHtml
        ? 'Cleaner service is unreachable (502 Bad Gateway from upstream). Check that the cleaner backend can reach TableForge at /api/cleaner/fetch/<handoff_id>.'
        : raw;
      setError('Could not open Cleaner: ' + cleaned);
    }
  }, [dataset, applyCleanerResult]);

  // Listen for postMessage from the cleaner window the moment it saves.
  useEffect(() => {
    const onMessage = async (ev: MessageEvent) => {
      const data = ev.data;
      if (!data || data.type !== 'tf-cleaner-saved') return;
      if (!cleanerHandoffRef.current || data.handoff_id !== cleanerHandoffRef.current) return;
      try {
        const s = await cleanerApi.status(cleanerHandoffRef.current);
        if (s.result) applyCleanerResult(s.result);
      } catch { /* polling fallback will pick it up */ }
      if (cleanerPollRef.current) { window.clearInterval(cleanerPollRef.current); cleanerPollRef.current = null; }
      const hid = cleanerHandoffRef.current;
      cleanerHandoffRef.current = null;
      if (hid) cleanerApi.revoke(hid);
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      if (cleanerPollRef.current) window.clearInterval(cleanerPollRef.current);
    };
  }, [applyCleanerResult]);

  const handleTextClean = useCallback(async (action: string, caseType?: string) => {
    if (!dataset) return;
    setLoading(true); setLoadingMsg('Cleaning text data…'); setError(null);
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
    } finally { setLoading(false); setLoadingMsg(''); }
  }, [dataset, tables, runTabulation]);

  const handleColumnTypeChange = useCallback(async (column: string, newType: string) => {
    if (!dataset) return;
    try {
      await changeColumnType(dataset.dataset_id, column, newType);
      setDataset(prev => prev ? ({
        ...prev,
        columns: prev.columns.map(c => c.name === column ? { ...c, type: newType as any } : c),
      }) : prev);
      setColumnTypeOverrides(prev => ({ ...prev, [column]: newType }));
      const activeT = tables[activeTableIdx];
      if (activeT && activeT.values.length > 0) runTabulation(activeT);
    } catch (e: any) {
      setError(e.message || 'Failed to change column type');
    }
  }, [dataset, tables, activeTableIdx, runTabulation]);

  const reloadFileRef = useRef<HTMLInputElement>(null);
  const handleReloadFile = useCallback(async (file: File) => {
    if (!dataset) return;
    setLoading(true); setLoadingMsg('Reloading data file…'); setError(null);
    try {
      const meta = await uploadFile(file);
      setDataset(meta);
      setExtraColumns([]);
      setLoadingMsg('Regenerating tables…');
      setTimeout(() => {
        tables.forEach(t => { if (t.values.length > 0) runTabulation(t); });
      }, 100);
    } catch (e: any) {
      setError('Reload failed: ' + (e.message || ''));
    } finally { setLoading(false); setLoadingMsg(''); }
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
          loadingMsg={loadingMsg}
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
          }}
          onLoadLocalProject={(path) => handleLoadProjectByPath(path)} />
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
        <DataPreview dataset={dataset}
          focusRow={previewFocus?.row ?? null}
          focusColumn={previewFocus?.column ?? null}
          onProceed={() => { setShowDataPreview(false); setPreviewFocus(null); }}
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
          else if (a === 'clean_open') handleOpenInCleaner();
          else if (a.startsWith('apply_template:')) handleApplyTemplate(a.slice('apply_template:'.length));
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
          else if (a === 'clean_open') handleOpenInCleaner();
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
          else if (a.startsWith('apply_template:')) handleApplyTemplate(a.slice('apply_template:'.length));
          else if (a.startsWith('load_project:')) handleLoadProjectByPath(a.slice('load_project:'.length));
          else if (a === 'stat_guide') { setGuidePendingModal(null); setGuideSection('overview'); }
          else if (ADVANCED_ACTIONS.has(a as AdvancedKind)) setAdvancedKind(a as AdvancedKind);
          else if (STAT_GUIDE_ACTIONS.has(a)) {
            if (isGuideSkipped(a)) setModal(a as ModalType);
            else { setGuidePendingModal(a as ModalType); setGuideSection(a); }
          }
          else setModal(a as ModalType);
        }}
        onUpdate={update => updateTable(update)}
        theme={theme}
        columns={allColumns}
        onColumnTypeChange={handleColumnTypeChange}
        onAskAI={q => { setSmartBuildPrefill({ query: q, autoSubmit: true }); setModal('ai-smart-build'); }}
      />
      {aiPolishUndo && (Date.now() - aiPolishUndo.appliedAt < 60000) && (
        <div style={{ margin: '0 12px', padding: '8px 14px', background: 'rgba(168,85,247,0.12)', border: '1px solid rgba(168,85,247,0.35)', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, flexShrink: 0 }}>
          <span>✨ AI Polish applied to {aiPolishUndo.scope === 'all' ? `${aiPolishUndo.snapshots.length} table${aiPolishUndo.snapshots.length === 1 ? '' : 's'}` : 'this table'}.</span>
          <button className="btn-secondary" style={{ fontSize: 11, padding: '4px 12px' }}
            onClick={() => {
              const byId = new Map(aiPolishUndo.snapshots.map(s => [s.id, s]));
              setTables(prev => prev.map(t => byId.get(t.id) || t));
              setAiPolishUndo(null);
            }}>
            Undo AI Polish
          </button>
          <span style={{ opacity: 0.55, fontSize: 10 }}>or press Ctrl+Z</span>
          <button style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 14, marginLeft: 'auto' }}
            onClick={() => setAiPolishUndo(null)}>×</button>
        </div>
      )}
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
          columnDescriptions={columnDescriptions}
          onColumnDescriptionChange={(col, desc) => setColumnDescriptions(prev => ({ ...prev, [col]: desc }))}
          columnRoles={columnRolesMap}
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
          onTogglePin={togglePinTable}
          onOpenChartFor={(idx) => { setActiveTableIdx(idx); setModal('charts'); }}
          sections={sections}
          onSectionsChange={setSections}
          onAssignSection={handleAssignSection}
          numberingConfig={numberingConfig}
          onNumberingConfigChange={setNumberingConfig}
          onApplyNumbering={handleApplyNumbering}
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
          {/* Column type-override hints — scoped to columns the active table actually uses */}
          {(() => {
            const inTable = new Set<string>([
              ...(activeTable.rows || []),
              ...(activeTable.columns || []),
              ...(activeTable.values || []).map(v => v.field),
              ...Object.keys(activeTable.filters || {}),
            ]);
            const relevant = typeHints.filter(h => !dismissedHints.has(h.column) && inTable.has(h.column));
            const irrelevantCount = typeHints.filter(h => !dismissedHints.has(h.column) && !inTable.has(h.column)).length;
            if (relevant.length === 0 && irrelevantCount === 0) return null;
            return (
              <div className="type-hint-banner">
                {relevant.slice(0, 4).map(h => (
                  <div key={h.column} className="type-hint-row">
                    <span className="type-hint-icon">{h.suggested_type === 'date' ? '📅' : '🔢'}</span>
                    <span className="type-hint-text">
                      <strong>{h.column}</strong> looks {h.suggested_type} (
                      {Math.round(h.success_rate * 100)}% parse OK
                      {h.fail_count > 0 ? `, ${h.fail_count} cells won't parse` : ''})
                    </span>
                    <button className="type-hint-btn type-hint-btn-primary" title="See what will fail to parse"
                      onClick={() => {
                        if (!dataset) return;
                        setTypeConvertModal({ column: h.column, newType: h.suggested_type });
                      }}>Preview &amp; convert</button>
                    <button className="type-hint-btn" title="Convert without preview"
                      onClick={() => handleColumnTypeChange(h.column, h.suggested_type)}>
                      Convert
                    </button>
                    <button className="type-hint-btn" title="Open this column in the Cleaner to inspect every cell, fix the failing ones, and return."
                      onClick={() => handleOpenInCleaner(h.column)}>
                      Fix in Cleaner
                    </button>
                    <button className="type-hint-dismiss" title="Dismiss this hint"
                      onClick={() => setDismissedHints(prev => new Set(prev).add(h.column))}>×</button>
                  </div>
                ))}
                {relevant.length > 4 && (
                  <div style={{ fontSize: 10, opacity: 0.6, padding: '2px 8px' }}>
                    + {relevant.length - 4} more hint(s) for columns in this table
                  </div>
                )}
                {irrelevantCount > 0 && (
                  <div style={{ fontSize: 10, opacity: 0.55, padding: '4px 8px', borderTop: relevant.length > 0 ? '1px dashed var(--border)' : 'none' }}>
                    {irrelevantCount} hint(s) for other columns hidden — they’ll appear when you use those columns in a table.
                  </div>
                )}
              </div>
            );
          })()}
          {/* Editable Table Title */}
          <div className="table-title-bar">
            <input className="table-title-input" type="text"
              value={activeTable.title} placeholder="Click to add table title..."
              onChange={e => updateTable({ title: e.target.value, name: e.target.value || activeTable.name, _autoTitle: false } as any)}
              onBlur={e => { if (dataset && e.target.value) logAuditEvent(dataset.dataset_id, 'table_title_change', `Title set to: "${e.target.value}" on table "${activeTable.name}"`); }} />
            <input className="table-subtitle-input" type="text"
              value={activeTable.subtitle} placeholder="Subtitle (optional)"
              onChange={e => updateTable({ subtitle: e.target.value, _autoTitle: false } as any)} />
            <select
              className="source-table-select"
              value={activeTable.source_table_id || ''}
              onChange={e => updateTable({ source_table_id: e.target.value || undefined } as any)}
              title={
                activeTable.source_table_id
                  ? `Source: #${tables.findIndex(t => t.id === activeTable.source_table_id) + 1} — ${tables.find(t => t.id === activeTable.source_table_id)?.title || tables.find(t => t.id === activeTable.source_table_id)?.name || ''}`
                  : 'Optional: mark this table as derived from another table (metadata for the pipeline view)'
              }
            >
              <option value="">No source</option>
              {tables.filter((_, i) => i !== activeTableIdx).map(t => {
                const idx = tables.indexOf(t) + 1;
                const label = t.title || t.name || '';
                return (
                  <option key={t.id} value={t.id} title={label}>
                    #{idx}{label ? ` — ${label.slice(0, 24)}${label.length > 24 ? '…' : ''}` : ''}
                  </option>
                );
              })}
            </select>
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
          ) : (<>
          {(() => {
            const hasChart = !!activeTable.chartConfig;
            const chartOnly = !!activeTable.chartConfig?.chart_only;
            const effectiveTab: 'table' | 'chart' = chartOnly ? 'chart' : (hasChart ? previewTab : 'table');
            return (
              <>
                {hasChart && !chartOnly && (
                  <div style={{ display: 'flex', gap: 0, padding: '8px 12px 0', borderBottom: '1px solid var(--border)' }}>
                    <button
                      onClick={() => setPreviewTab('table')}
                      style={{
                        padding: '6px 16px', fontSize: 12, fontWeight: 600,
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: effectiveTab === 'table' ? 'var(--primary, #3b82f6)' : 'var(--text-dim)',
                        borderBottom: effectiveTab === 'table' ? '2px solid var(--primary, #3b82f6)' : '2px solid transparent',
                        marginBottom: -1,
                      }}
                    >📋 Table</button>
                    <button
                      onClick={() => setPreviewTab('chart')}
                      style={{
                        padding: '6px 16px', fontSize: 12, fontWeight: 600,
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: effectiveTab === 'chart' ? 'var(--primary, #3b82f6)' : 'var(--text-dim)',
                        borderBottom: effectiveTab === 'chart' ? '2px solid var(--primary, #3b82f6)' : '2px solid transparent',
                        marginBottom: -1,
                      }}
                    >📊 Chart{activeTable.chartConfig?.chartTitle ? ` · ${activeTable.chartConfig.chartTitle}` : ''}</button>
                  </div>
                )}
                {effectiveTab === 'table' && (
                  <LivePreview result={currentResult} loading={loading} error={error}
                    title={activeTable.title} subtitle={activeTable.subtitle}
                    datasetId={dataset.dataset_id} tableConfig={activeTable}
                    annotations={annotationsMap[activeTable?.id] || []}
                    onAnnotationsChange={anns => setAnnotationsMap(prev => ({ ...prev, [activeTable.id]: anns }))}
                    tableMode={theme}
                    onHeaderRename={(original, newName) => {
                      const renames = { ...(activeTable.header_renames || {}) };
                      const trimmed = (newName || '').trim();
                      if (trimmed && trimmed !== original) {
                        renames[original] = trimmed;
                        if (dataset) logAuditEvent(dataset.dataset_id, 'column_rename', `Column "${original}" renamed to "${trimmed}" in table "${activeTable.name}"`);
                      } else {
                        delete renames[original];
                      }
                      updateTable({ header_renames: renames });
                    }}
                  />
                )}
                {effectiveTab === 'chart' && hasChart && (
                  <InlineChartPreview
                    table={activeTable}
                    result={currentResult}
                    onEdit={() => setModal('charts')}
                    onRemove={() => updateTable({ chartConfig: undefined } as any)}
                    onToggleChartOnly={() => updateTable({ chartConfig: { ...activeTable.chartConfig, chart_only: !activeTable.chartConfig?.chart_only } } as any)}
                  />
                )}
              </>
            );
          })()}
          </>)}
          {tableInterpretations[activeTable?.id] && (
            <div style={{ margin: '8px 12px', background: 'rgba(59,130,246,0.05)', border: '1px solid rgba(59,130,246,0.15)', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', cursor: 'pointer', userSelect: 'none' }}
                onClick={() => setExpandedInterpretations(prev => ({ ...prev, [activeTable.id]: !(prev[activeTable.id] ?? true) }))}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, transform: (expandedInterpretations[activeTable.id] ?? true) ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.15s', display: 'inline-block' }}>▼</span>
                  <span style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>AI Interpretation</span>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={e => { e.stopPropagation(); setEditingInterpretation(editingInterpretation === activeTable.id ? null : activeTable.id); }}
                    style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 12, padding: '2px 6px' }} title="Edit">✏️</button>
                  <button onClick={e => { e.stopPropagation(); setTableInterpretations(prev => { const n = { ...prev }; delete n[activeTable.id]; return n; }); }}
                    style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 12, padding: '2px 6px' }} title="Remove">×</button>
                </div>
              </div>
              {(expandedInterpretations[activeTable.id] ?? true) && (
                <div style={{ padding: '0 14px 12px' }}>
                  {editingInterpretation === activeTable.id ? (
                    <textarea
                      value={tableInterpretations[activeTable.id]}
                      onChange={e => setTableInterpretations(prev => ({ ...prev, [activeTable.id]: e.target.value }))}
                      onBlur={() => setEditingInterpretation(null)}
                      style={{ width: '100%', minHeight: 120, resize: 'vertical', fontSize: 13, lineHeight: 1.6, padding: '8px 10px', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: 6, color: 'var(--text)', fontFamily: 'inherit' }}
                      autoFocus
                    />
                  ) : (
                    <div style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap', color: 'var(--text)' }}>{tableInterpretations[activeTable.id]}</div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <StatusBar dataset={dataset} result={currentResult} undoCount={undoStack.length} redoCount={redoStack.length} />
      {(uploadProgress != null || (loading && loadingMsg)) && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999 }}>
          <div style={{ height: 3, background: 'rgba(59,130,246,0.2)' }}>
            {uploadProgress != null ? (
              <div style={{ height: '100%', width: `${uploadProgress}%`, background: '#3b82f6', transition: 'width 0.2s' }} />
            ) : (
              <div style={{ height: '100%', width: '100%', background: '#3b82f6', animation: 'indeterminate 1.5s ease-in-out infinite' }} />
            )}
          </div>
          <div style={{ position: 'absolute', top: 6, left: '50%', transform: 'translateX(-50%)', background: 'rgba(15,23,42,0.95)', color: '#e2e8f0', padding: '5px 18px', borderRadius: 6, fontSize: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 12, height: 12, border: '2px solid rgba(59,130,246,0.3)', borderTop: '2px solid #3b82f6', borderRadius: '50%', animation: 'spin 0.8s linear infinite', display: 'inline-block' }} />
            {uploadProgress != null
              ? (uploadProgress < 100 ? `Uploading… ${uploadProgress}%` : 'Processing file…')
              : loadingMsg}
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

      {numericPrompt && (
        <div className="modal-overlay" onClick={() => setNumericPrompt(null)}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Numeric Field</h2>
              <button className="modal-close" onClick={() => setNumericPrompt(null)}>×</button>
            </div>
            <div className="modal-body">
              <p>This field contains numbers. How should it be used?</p>
              <div className="date-group-grid">
                <button className="date-group-btn" onClick={() => {
                  const table = tables[activeTableIdx];
                  if (table && !table.columns.includes(numericPrompt.field))
                    updateTable({ columns: [...table.columns, numericPrompt.field] });
                  setNumericPrompt(null);
                }}>As Column (categorical)</button>
                {['sum', 'average', 'count', 'min', 'max'].map(agg => (
                  <button key={agg} className="date-group-btn" onClick={() => {
                    const table = tables[activeTableIdx];
                    if (table && !table.values.find(v => v.field === numericPrompt.field)) {
                      const vf = createValueField(table, numericPrompt.field);
                      vf.agg = agg;
                      vf.label = `${agg.charAt(0).toUpperCase() + agg.slice(1)} of ${numericPrompt.field}`;
                      updateTable({ values: [...table.values, vf] });
                    }
                    setNumericPrompt(null);
                  }}>Value → {agg.charAt(0).toUpperCase() + agg.slice(1)}</button>
                ))}
              </div>
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
      {modal === 'column-creator' && <ColumnCreator datasetId={dataset.dataset_id} columns={allColumns}
        onCreated={() => { refreshExtraColumns(); }} onClose={() => setModal(null)}
        onOpenLibrary={() => setModal('metric_library')} columnDescriptions={columnDescriptions} />}
      {modal === 'export' && <ExportDialog datasetId={dataset.dataset_id} tables={tables} results={results}
        annotationsMap={annotationsMap}
        interpretationsMap={tableInterpretations}
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
        activeTableIdx={activeTableIdx}
        onChartChange={(tableId, chartConfig) => {
          setTables(prev => prev.map(t => t.id === tableId ? { ...t, chartConfig } : t));
          setPreviewTab('chart');
        }}
        onClose={() => setModal(null)} />}
      {(modal === 'stat_correlation' || modal === 'stat_descriptive' || modal === 'stat_crosstab' || modal === 'stat_ttest' || modal === 'stat_anova' || modal === 'stat_regression' || modal === 'stat_normality' || modal === 'stat_outlier' || modal === 'stat_frequency' || modal === 'stat_paired_ttest' || modal === 'stat_wilcoxon' || modal === 'stat_mcnemar' || modal === 'stat_kruskal' || modal === 'stat_friedman' || modal === 'stat_spearman' || modal === 'stat_kendall' || modal === 'stat_logistic_regression' || modal === 'stat_multiple_regression' || modal === 'stat_posthoc' || modal === 'stat_reliability') && (
        <StatisticalTables
          type={modal.replace('stat_', '') as any}
          datasetId={dataset.dataset_id}
          columns={allColumns}
          onClose={() => setModal(null)}
        />
      )}
      {modal === 'audit' && <AuditTrail datasetId={dataset.dataset_id} onClose={() => setModal(null)} />}
      {modal === 'anomalies' && <AnomalyModal datasetId={dataset.dataset_id} onClose={() => setModal(null)} />}
      {modal === 'variable_metadata' && (
        <VariableMetadataPanel
          datasetId={dataset.dataset_id}
          columns={allColumns}
          onClose={() => setModal(null)}
          onSaved={r => setColumnRolesMap(r)}
        />
      )}
      {modal === 'study_design' && (
        <StudyDesignWizard
          datasetId={dataset.dataset_id}
          columns={allColumns}
          onClose={() => setModal(null)}
        />
      )}
      {modal === 'likert' && (
        <LikertPanel
          datasetId={dataset.dataset_id}
          columns={allColumns}
          columnRoles={columnRolesMap}
          onClose={() => setModal(null)}
          onCompositeCreated={handleDataRefresh}
        />
      )}
      {modal === 'multi_response' && (
        <MultiResponsePanel
          datasetId={dataset.dataset_id}
          columns={allColumns}
          columnRoles={columnRolesMap}
          onClose={() => setModal(null)}
        />
      )}
      {modal === 'observer' && (
        <ObserverPanel
          datasetId={dataset.dataset_id}
          columns={allColumns}
          columnRoles={columnRolesMap}
          onClose={() => setModal(null)}
        />
      )}
      {modal === 'balance' && (
        <BalancePanel
          datasetId={dataset.dataset_id}
          columns={allColumns}
          columnRoles={columnRolesMap}
          studyDesign={null}
          onClose={() => setModal(null)}
        />
      )}
      {modal === 'geo_summary' && (
        <GeoSummaryPanel
          datasetId={dataset.dataset_id}
          columns={allColumns}
          columnRoles={columnRolesMap}
          onClose={() => setModal(null)}
        />
      )}
      {modal === 'driver' && (
        <DriverPanel
          datasetId={dataset.dataset_id}
          columns={allColumns}
          columnRoles={columnRolesMap}
          onClose={() => setModal(null)}
        />
      )}
      {modal === 'cluster' && (
        <ClusterPanel
          datasetId={dataset.dataset_id}
          columns={allColumns}
          onClose={() => setModal(null)}
        />
      )}
      {modal === 'verbatim' && (
        <VerbatimPanel
          datasetId={dataset.dataset_id}
          columns={allColumns}
          onClose={() => setModal(null)}
        />
      )}
      {modal === 'play_mode' && (
        <PlayModePanel
          datasetId={dataset.dataset_id}
          onClose={() => setModal(null)}
          onAction={(action) => {
            // Close Play Mode and dispatch the chosen analysis action through the same pipeline.
            setModal(null);
            setTimeout(() => {
              if (ADVANCED_ACTIONS.has(action as AdvancedKind)) {
                setAdvancedKind(action as AdvancedKind);
              } else {
                setModal(action as ModalType);
              }
            }, 0);
          }}
        />
      )}
      {advancedKind && (
        <AdvancedAnalysisPanel
          kind={advancedKind}
          datasetId={dataset.dataset_id}
          columns={allColumns}
          analysisPack={lastAnalysisPack}
          onClose={() => setAdvancedKind(null)}
        />
      )}
      {modal === 'auto_analyze' && (
        <AutoAnalyzePanel
          datasetId={dataset.dataset_id}
          columns={allColumns}
          columnRoles={columnRolesMap}
          onPackReady={(pack) => setLastAnalysisPack(pack)}
          onClose={() => setModal(null)}
          onPromote={(label, headers, rows, interpretation) => {
            const id = String(Date.now() + Math.floor(Math.random() * 1000));
            pushUndo();
            const empty = createEmptyTable(id, label.slice(0, 30));
            empty.title = label;
            empty.subtitle = interpretation;
            setTables(prev => [...prev, empty]);
            setResults(prev => {
              const next = new Map(prev);
              next.set(id, { headers, rows, row_count: rows.length, col_count: headers.length });
              return next;
            });
          }}
        />
      )}
      {modal === 'survey_insights' && (
        <SurveyInsightsPanel
          datasetId={dataset.dataset_id}
          onClose={() => setModal(null)}
          onAdoptTables={(configs) => {
            if (!configs.length) return;
            pushUndo();
            setTables(prev => [...prev, ...configs]);
            setActiveTableIdx(tables.length);
          }}
        />
      )}
      {modal === 'survey_quality' && (
        <SurveyQualityPanel
          datasetId={dataset.dataset_id}
          columns={allColumns}
          columnRoles={columnRolesMap}
          onClose={() => setModal(null)}
        />
      )}
      {guideSection && (
        <StatGuide
          initialSection={guideSection}
          onClose={() => setGuideSection(null)}
          onContinue={guidePendingModal ? () => {
            const next = guidePendingModal;
            setGuidePendingModal(null);
            setModal(next);
          } : undefined}
        />
      )}
      {typeConvertModal && dataset && (
        <TypeConvertModal
          datasetId={dataset.dataset_id}
          column={typeConvertModal.column}
          newType={typeConvertModal.newType}
          onCancel={() => setTypeConvertModal(null)}
          onApply={() => {
            const { column, newType } = typeConvertModal;
            setTypeConvertModal(null);
            handleColumnTypeChange(column, newType);
          }}
          onOpenInCleaner={() => {
            const col = typeConvertModal.column;
            setTypeConvertModal(null);
            handleOpenInCleaner(col);
          }}
          onViewRow={(rowIdx) => {
            const col = typeConvertModal.column;
            setTypeConvertModal(null);
            setPreviewFocus({ row: rowIdx, column: col });
            setShowDataPreview(true);
          }}
        />
      )}
      {(modal === 'ai-polish' || modal === 'ai-interpret' || modal === 'ai-refine' || modal === 'ai-suggest' || modal === 'ai-smart-build' || modal === 'ai-auto-generate' || modal === 'ai-report' || modal === 'ai-config') && (
        <AISmartPanel
          mode={modal.replace('ai-', '') as any}
          table={tables[activeTableIdx] || null}
          tables={tables}
          allResults={results}
          dataset={dataset}
          result={results.get(tables[activeTableIdx]?.id) || null}
          interpretation={tableInterpretations[tables[activeTableIdx]?.id] || ''}
          projectFilters={projectFilters}
          columnDescriptions={columnDescriptions}
          prefillQuery={smartBuildPrefill || undefined}
          onClose={() => { setModal(null); setSmartBuildPrefill(null); }}
          onApplyPolish={(title, subtitle, renames) => {
            const t = tables[activeTableIdx];
            if (t) {
              pushUndo();
              setAiPolishUndo({ snapshots: [{ ...t, values: [...t.values], rows: [...t.rows], columns: [...t.columns], filters: { ...t.filters } }], scope: 'single', appliedAt: Date.now() });
              const updated = { ...t, title, subtitle, name: title || t.name, header_renames: { ...(t.header_renames || {}), ...renames }, _autoTitle: false };
              setTables(prev => prev.map(x => x.id === t.id ? updated : x));
            }
          }}
          onApplyPolishAll={(updates) => {
            pushUndo();
            const touchedIds = new Set(updates.map(u => u.tableId));
            setAiPolishUndo({
              snapshots: tables.filter(t => touchedIds.has(t.id)).map(t => ({ ...t, values: [...t.values], rows: [...t.rows], columns: [...t.columns], filters: { ...t.filters } })),
              scope: 'all',
              appliedAt: Date.now(),
            });
            setTables(prev => prev.map(t => {
              const u = updates.find(u => u.tableId === t.id);
              if (!u) return t;
              return { ...t, title: u.title, subtitle: u.subtitle, name: u.title || t.name, header_renames: { ...(t.header_renames || {}), ...u.renames }, _autoTitle: false };
            }));
          }}
          onApplyInterpretation={(text) => {
            const t = tables[activeTableIdx];
            if (t) setTableInterpretations(prev => ({ ...prev, [t.id]: text }));
          }}
          onApplyInterpretationAll={(updates) => {
            setTableInterpretations(prev => {
              const next = { ...prev };
              updates.forEach(u => { next[u.tableId] = u.text; });
              return next;
            });
          }}
          onApplySuggestion={(suggested) => {
            const newTables = suggested.map((s: any, i: number) => {
              const valField = (!s.value_field || s.value_field === '*') ? s.groupby_field : s.value_field;
              const valAgg = (!s.value_field || s.value_field === '*') ? 'count' : (s.aggregation || 'count');
              const hasCols = !!s.secondary_groupby;
              const tplId = s.template || (hasCols ? 'count_pct_row' : 'frequency');
              const tpl = TABLE_TEMPLATES.find(t => t.id === tplId);
              const baseTable: TableConfig = {
                id: `ai_${Date.now()}_${i}`,
                name: s.title || `AI Table ${i + 1}`,
                rows: [s.groupby_field].filter(Boolean),
                columns: s.secondary_groupby ? [s.secondary_groupby] : [],
                values: [{ field: valField, agg: valAgg, label: '' }],
                filters: {},
                grand_total: true,
                subtotals: false,
                missing_data: '',
                title: s.title || '',
                subtitle: s.description || '',
              };
              if (tpl) {
                const patch = tpl.apply(baseTable);
                if (patch.values) {
                  patch.values = baseTable.values.map(v => ({ ...v, ...(patch.values![0] || {}), field: v.field }));
                }
                Object.assign(baseTable, patch);
              }
              return baseTable;
            });
            setTables(prev => [...prev, ...newTables]);
            setActiveTableIdx(tables.length);
          }}
          onApplySmartBuild={(config) => {
            const valField = (!config.value_field || config.value_field === '*') ? config.groupby_field : config.value_field;
            const valAgg = (!config.value_field || config.value_field === '*') ? 'count' : (config.aggregation || 'count');
            const newTable = {
              id: `ai_${Date.now()}`,
              name: config.title || 'AI Table',
              rows: [config.groupby_field].filter(Boolean),
              columns: config.secondary_groupby ? [config.secondary_groupby] : [],
              values: [{ field: valField, agg: valAgg, label: '' }],
              filters: {},
              grand_total: true,
              subtotals: false,
              missing_data: '',
              title: config.title || '',
              subtitle: config.description || '',
              header_renames: config.column_labels || {},
            };
            setTables(prev => [...prev, newTable]);
            setActiveTableIdx(tables.length);
          }}
        />
      )}
      {modal === 'projects' && <ProjectManager currentTables={tables}
        currentAnnotationsMap={annotationsMap} currentComparisonState={comparisonState} currentProjectFilters={projectFilters} currentColumnTypeOverrides={columnTypeOverrides} currentFilename={dataset?.filename}
        currentDatasetId={dataset?.dataset_id} currentRowCount={dataset?.row_count} currentColCount={dataset?.columns?.length}
        currentSections={sections} currentNumberingConfig={numberingConfig}
        onLoad={(loadedTables, loadedAnnotations, loadedExtra) => {
          if (loadedAnnotations) setAnnotationsMap(loadedAnnotations);
          if (loadedExtra?.reportTemplate) setReportTemplate(loadedExtra.reportTemplate);
          if (loadedExtra?.comparisonState) setComparisonState(loadedExtra.comparisonState);
          if (loadedExtra?.projectFilters) setProjectFilters(loadedExtra.projectFilters);
          if (loadedExtra?.metadata) setPendingMetadataRestore(loadedExtra.metadata);
          if (Array.isArray(loadedExtra?.sections)) setSections(loadedExtra.sections);
          if (loadedExtra?.numberingConfig) setNumberingConfig(loadedExtra.numberingConfig);
          if (loadedExtra?.columnTypeOverrides) {
            const overrides = loadedExtra.columnTypeOverrides as Record<string, string>;
            setColumnTypeOverrides(overrides);
            if (dataset) {
              setDataset(prev => prev ? ({
                ...prev,
                columns: prev.columns.map(c => overrides[c.name] ? { ...c, type: overrides[c.name] as any } : c),
              }) : prev);
              Object.entries(overrides).forEach(([col, newType]) => {
                changeColumnType(dataset.dataset_id, col, newType).catch(() => {});
              });
            }
          }
          // Migrate legacy global comparisonState into per-table comparisonConfig
          if (loadedExtra?.comparisonState && loadedTables.length > 0) {
            const legacy = loadedExtra.comparisonState;
            loadedTables = loadedTables.map(t =>
              t.comparisonConfig ? t : { ...t, comparisonConfig: legacy }
            );
          }
          if (!dataset) {
            // Try to reload the source file from cache if available
            if (loadedExtra?.source_file?.cache_path || loadedExtra?.source_file?.dataset_id) {
              fetch(`${API_BASE}/project/reload-file`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(loadedExtra.source_file),
              }).then(r => r.ok ? r.json() : null).then(meta => {
                if (meta) {
                  const overrides = loadedExtra?.columnTypeOverrides as Record<string, string> | undefined;
                  if (overrides && Object.keys(overrides).length > 0) {
                    meta.columns = meta.columns.map((c: any) => overrides[c.name] ? { ...c, type: overrides[c.name] } : c);
                    Object.entries(overrides).forEach(([col, newType]) => {
                      changeColumnType(meta.dataset_id, col, newType).catch(() => {});
                    });
                  }
                  setDataset(meta);
                  pushUndo();
                  setTables(loadedTables);
                  setActiveTableIdx(0);
                  setResults(new Map());
                } else {
                  pushUndo();
                  setTables(loadedTables);
                  setActiveTableIdx(0);
                  setResults(new Map());
                }
                setModal(null);
              }).catch(() => {
                pushUndo();
                setTables(loadedTables);
                setActiveTableIdx(0);
                setResults(new Map());
                setModal(null);
              });
              return;
            }
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
