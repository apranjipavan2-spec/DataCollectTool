import React, { useState } from 'react';
import { TableConfig, TableResult } from '../types';
import { API_BASE } from '../api';

interface DocStyle {
  font: string;
  fontSize: number;
  headingFont: string;
  margins: 'normal' | 'narrow' | 'wide';
  orientation: 'portrait' | 'landscape';
  lineSpacing: number;
}

const DEFAULT_DOC_STYLE: DocStyle = {
  font: 'Calibri', fontSize: 11, headingFont: 'Calibri Light',
  margins: 'normal', orientation: 'portrait', lineSpacing: 1.15,
};

interface Props {
  tables: TableConfig[];
  results: Map<string, TableResult>;
  onClose: () => void;
  initialElements?: any[];
  initialDocStyle?: DocStyle;
  onSaveTemplate?: (elements: any[], docStyle: DocStyle) => void;
  datasetFilename?: string;
  datasetRowCount?: number;
  auditLog?: { timestamp: string; action: string; details: string }[];
}

type ElementType = 'cover' | 'toc' | 'heading' | 'text' | 'table_ref' | 'page_break' | 'appendix' | 'auto_narrative' | 'cell_ref' | 'audit_trail' | 'conditional';

interface ReportElement {
  id: string;
  type: ElementType;
  content: string;
  tableId?: string;
  level?: number;
  narrativeType?: string; // highest, lowest, total, shares, comparison, custom
  narrativeTemplate?: string; // custom template with tokens
  cellRow?: number;
  cellCol?: number;
  cellLabel?: string;
  conditional?: boolean;  // only include if table has data
  condTableId?: string;   // the table to check for data existence
}

const ELEMENT_TYPES: { type: ElementType; label: string; icon: string }[] = [
  { type: 'cover', label: 'Cover Page', icon: '📄' },
  { type: 'toc', label: 'Table of Contents', icon: '📑' },
  { type: 'heading', label: 'Section Heading', icon: 'H' },
  { type: 'text', label: 'Narrative Text', icon: '¶' },
  { type: 'auto_narrative', label: 'Auto-Narrative', icon: '🤖' },
  { type: 'table_ref', label: 'Table Reference', icon: '⊞' },
  { type: 'page_break', label: 'Page Break', icon: '—' },
  { type: 'appendix', label: 'Appendix', icon: '📎' },
  { type: 'audit_trail', label: 'Audit Trail', icon: '🔍' },
  { type: 'cell_ref', label: 'Cross-Table Cell Reference', icon: '🔗' },
  { type: 'conditional', label: 'Conditional Block', icon: '❓' },
];

function resolveTokens(text: string, context: { date?: string; filename?: string; total_rows?: number; table_name?: string }): string {
  return text
    .replace(/\{date\}/g, context.date || new Date().toLocaleDateString())
    .replace(/\{filename\}/g, context.filename || '')
    .replace(/\{total_rows\}/g, String(context.total_rows ?? ''))
    .replace(/\{table_name\}/g, context.table_name || '');
}

function generateNarrative(
  tableId: string | undefined,
  tables: TableConfig[],
  results: Map<string, TableResult>,
  narrativeType: string,
  narrativeTemplate?: string,
  context?: { date?: string; filename?: string; total_rows?: number }
): string {
  if (!tableId) return '— Select a table and narrative type —';
  const table = tables.find(t => t.id === tableId);
  const result = results.get(tableId);
  if (!table || !result || result.rows.length === 0) return '— No data available for this table —';

  const rows = result.rows.filter(r => String(r[0]) !== 'Grand Total');
  const headers = result.headers;
  const numIdx = headers.findIndex((h, i) => i > 0 && rows.some(r => typeof r[i] === 'number'));

  if (numIdx < 0) return '— No numeric data found —';

  const values = rows.map(r => ({ label: String(r[0]), val: Number(r[numIdx]) || 0 }));
  const sorted = [...values].sort((a, b) => b.val - a.val);
  const total = values.reduce((s, v) => s + v.val, 0);
  const valueLabel = headers[numIdx];

  let raw = '';
  if (narrativeType === 'custom' && narrativeTemplate) {
    raw = narrativeTemplate
      .replace(/\{top_label\}/g, sorted[0]?.label || '')
      .replace(/\{top_value\}/g, sorted[0]?.val.toLocaleString() || '')
      .replace(/\{bottom_label\}/g, sorted[sorted.length - 1]?.label || '')
      .replace(/\{bottom_value\}/g, sorted[sorted.length - 1]?.val.toLocaleString() || '')
      .replace(/\{total\}/g, total.toLocaleString())
      .replace(/\{count\}/g, String(values.length))
      .replace(/\{metric\}/g, valueLabel)
      .replace(/\{table_name\}/g, table.name);
  } else if (narrativeType === 'highest') {
    const top = sorted.slice(0, 3);
    raw = `The highest ${valueLabel} was recorded for ${top[0].label} at ${top[0].val.toLocaleString()}, followed by ${top[1]?.label || ''} (${top[1]?.val.toLocaleString() || ''}) and ${top[2]?.label || ''} (${top[2]?.val.toLocaleString() || ''}).`;
  } else if (narrativeType === 'lowest') {
    const bottom = sorted.slice(-3).reverse();
    raw = `The lowest ${valueLabel} was for ${bottom[0].label} at ${bottom[0].val.toLocaleString()}.`;
  } else if (narrativeType === 'total') {
    raw = `The grand total ${valueLabel} across all ${values.length} categories was ${total.toLocaleString()}, with an average of ${(total / values.length).toFixed(1)} per category.`;
  } else if (narrativeType === 'shares') {
    const top = sorted.slice(0, 2);
    raw = `${top[0].label} accounted for ${((top[0].val / total) * 100).toFixed(1)}% of total ${valueLabel}${top[1] ? `, while ${top[1].label} contributed ${((top[1].val / total) * 100).toFixed(1)}%` : ''}.`;
  } else if (narrativeType === 'comparison') {
    const above = values.filter(v => v.val > total / values.length);
    const below = values.filter(v => v.val < total / values.length);
    const avg = (total / values.length).toFixed(1);
    raw = `Compared to the average ${valueLabel} of ${avg}, ${above.length} categories performed above average (${above.map(v => v.label).join(', ')}) and ${below.length} performed below average.`;
  } else {
    raw = '— Select a narrative type —';
  }

  return context ? resolveTokens(raw, context) : raw;
}

export function ReportBuilder({ tables, results, onClose, initialElements, initialDocStyle, onSaveTemplate, datasetFilename, datasetRowCount, auditLog }: Props) {
  const [elements, setElements] = useState<ReportElement[]>(initialElements || [
    { id: '1', type: 'cover', content: 'Report Title' },
    { id: '2', type: 'toc', content: 'Table of Contents' },
  ]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState('');
  const [docStyle, setDocStyle] = useState<DocStyle>(initialDocStyle || DEFAULT_DOC_STYLE);
  const [showDocStyle, setShowDocStyle] = useState(false);
  const updateDocStyle = (upd: Partial<DocStyle>) => setDocStyle(s => ({ ...s, ...upd }));

  const addElement = (type: ElementType) => {
    const id = String(Date.now());
    const defaults: Record<string, string> = {
      cover: 'Report Title', toc: 'Table of Contents', heading: 'Section Heading',
      text: 'Enter narrative text here...', page_break: '— Page Break —',
      appendix: 'Appendix', auto_narrative: '', table_ref: '', cell_ref: '',
      audit_trail: 'Audit Trail', conditional: 'Conditional Block',
    };
    setElements([...elements, { id, type, content: defaults[type] || '', level: type === 'heading' ? 1 : undefined, narrativeType: 'highest' }]);
    setSelectedId(id);
  };

  const tokenContext = { date: new Date().toLocaleDateString(), filename: datasetFilename || '', total_rows: datasetRowCount };

  const updateElement = (id: string, update: Partial<ReportElement>) => {
    setElements(elements.map(e => e.id === id ? { ...e, ...update } : e));
  };

  const removeElement = (id: string) => {
    setElements(elements.filter(e => e.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const moveElement = (idx: number, dir: -1 | 1) => {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= elements.length) return;
    const next = [...elements];
    [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
    setElements(next);
  };

  const handleExportWord = async () => {
    const tableElements = elements.filter(e => e.type === 'table_ref' && e.tableId);
    const exportTables = tableElements.map(e => {
      const t = tables.find(tbl => tbl.id === e.tableId);
      const r = results.get(e.tableId!);
      return { name: t?.name || '', headers: r?.headers || [], rows: r?.rows || [], title: t?.title || '', subtitle: t?.subtitle || '' };
    }).filter(t => t.headers.length > 0);

    const narrativeElements = elements.filter(e => e.type === 'auto_narrative');
    const textElements = elements.filter(e => e.type === 'text' || e.type === 'heading');

    // Build report structure for backend — resolve tokens & conditional elements
    const reportContent = elements.map(el => {
      // Check conditional elements: skip if linked table has no data
      if (el.conditional && el.condTableId) {
        const condResult = results.get(el.condTableId);
        if (!condResult || condResult.rows.length === 0) return null;
      }

      if (el.type === 'heading') return { type: 'heading', text: resolveTokens(el.content, tokenContext), level: el.level || 1 };
      if (el.type === 'text') return { type: 'text', text: resolveTokens(el.content, tokenContext) };
      if (el.type === 'auto_narrative') return { type: 'text', text: generateNarrative(el.tableId, tables, results, el.narrativeType || 'highest', el.narrativeTemplate, tokenContext) };
      if (el.type === 'cover') return { type: 'cover', text: resolveTokens(el.content, tokenContext) };
      if (el.type === 'page_break') return { type: 'page_break', text: '' };
      if (el.type === 'appendix') return { type: 'heading', text: el.content || 'Appendix', level: 1 };
      if (el.type === 'audit_trail') {
        const logText = (auditLog || []).map(e => `${e.timestamp} | ${e.action} | ${e.details}`).join('\n') || 'No audit log available.';
        return { type: 'text', text: `Audit Trail:\n${logText}` };
      }
      if (el.type === 'table_ref') {
        const t = tables.find(tbl => tbl.id === el.tableId);
        const r = results.get(el.tableId || '');
        return { type: 'table', name: t?.name, headers: r?.headers || [], rows: r?.rows || [], title: t?.title, subtitle: t?.subtitle };
      }
      if (el.type === 'cell_ref') {
        const r = results.get(el.tableId || '');
        const val = r?.rows[el.cellRow ?? 0]?.[el.cellCol ?? 0];
        const label = el.cellLabel || r?.headers[el.cellCol ?? 0] || 'Value';
        const dispVal = val != null ? (typeof val === 'number' ? val.toLocaleString() : String(val)) : '—';
        return { type: 'text', text: `${label}: ${dispVal}` };
      }
      if (el.type === 'conditional') {
        // Content element - render its nested content text
        return { type: 'text', text: resolveTokens(el.content, tokenContext) };
      }
      return null;
    }).filter(Boolean);

    try {
      setExportStatus('Exporting...');
      const res = await fetch(`${API_BASE}/report/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataset_id: '', elements: reportContent, filename: 'TableForge_Report', doc_style: docStyle }),
      });
      if (res.ok) {
        const data = await res.json();
        setExportStatus(`Saved: ${data.download_filename}`);
        if (data.download_filename) {
          const a = document.createElement('a');
          a.href = `${API_BASE}/export/download/${data.download_filename}`;
          a.download = data.download_filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        }
      } else {
        setExportStatus('Export failed');
      }
    } catch {
      setExportStatus('Export failed');
    }
  };

  const selectedEl = elements.find(e => e.id === selectedId);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()} style={{ height: '85vh' }}>
        <div className="modal-header">
          <h2>Report Template Builder</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body" style={{ display: 'flex', gap: 16, padding: 0, overflow: 'hidden' }}>
          {/* Element palette */}
          <div className="report-palette">
            <h4>Add Elements</h4>
            {ELEMENT_TYPES.map(et => (
              <button key={et.type} className="palette-btn" onClick={() => addElement(et.type)}>
                <span className="palette-icon">{et.icon}</span>
                {et.label}
              </button>
            ))}
          </div>

          {/* Canvas */}
          <div className="report-canvas">
            <h4>Report Structure ({elements.length} elements)</h4>
            <div className="canvas-elements">
              {elements.map((el, idx) => (
                <div key={el.id}
                  className={`canvas-element ${selectedId === el.id ? 'selected' : ''} el-${el.type}`}
                  onClick={() => setSelectedId(el.id)}>
                  <div className="el-drag-handle">
                    <button className="el-move" onClick={e => { e.stopPropagation(); moveElement(idx, -1); }} disabled={idx === 0}>▲</button>
                    <button className="el-move" onClick={e => { e.stopPropagation(); moveElement(idx, 1); }} disabled={idx === elements.length - 1}>▼</button>
                  </div>
                  <div className="el-content">
                    <span className="el-type-badge">{ELEMENT_TYPES.find(t => t.type === el.type)?.icon} {ELEMENT_TYPES.find(t => t.type === el.type)?.label}</span>
                    {el.type === 'table_ref' ? (
                      <span className="el-preview">{el.tableId ? tables.find(t => t.id === el.tableId)?.name || 'Unknown' : 'No table selected'}</span>
                    ) : el.type === 'cell_ref' ? (
                      <span className="el-preview">
                        {el.tableId ? `${tables.find(t => t.id === el.tableId)?.name} [${el.cellRow ?? 0},${el.cellCol ?? 0}]` : 'No cell selected'}
                      </span>
                    ) : el.type === 'auto_narrative' ? (
                      <span className="el-preview" style={{ fontStyle: 'italic', color: 'var(--primary)' }}>
                        {generateNarrative(el.tableId, tables, results, el.narrativeType || 'highest').substring(0, 80)}...
                      </span>
                    ) : (
                      <span className="el-preview">{el.content.substring(0, 60)}{el.content.length > 60 ? '...' : ''}</span>
                    )}
                  </div>
                  <button className="el-remove" onClick={e => { e.stopPropagation(); removeElement(el.id); }}>×</button>
                </div>
              ))}
              {elements.length === 0 && (
                <div className="empty-state" style={{ padding: 40 }}>
                  <p>Add elements from the palette to build your report</p>
                </div>
              )}
            </div>
          </div>

          {/* Properties panel */}
          <div className="report-props">
            <h4>Properties</h4>
            {selectedEl ? (
              <div className="props-form">
                <div className="form-group">
                  <label>Type</label>
                  <input type="text" value={ELEMENT_TYPES.find(t => t.type === selectedEl.type)?.label || ''} readOnly />
                </div>
                {selectedEl.type === 'heading' && (
                  <div className="form-group">
                    <label>Level</label>
                    <select value={selectedEl.level || 1} onChange={e => updateElement(selectedEl.id, { level: parseInt(e.target.value) })}>
                      <option value={1}>H1 - Main Section</option>
                      <option value={2}>H2 - Subsection</option>
                      <option value={3}>H3 - Sub-subsection</option>
                    </select>
                  </div>
                )}
                {(selectedEl.type === 'table_ref' || selectedEl.type === 'auto_narrative') && (
                  <div className="form-group">
                    <label>Table</label>
                    <select value={selectedEl.tableId || ''} onChange={e => updateElement(selectedEl.id, { tableId: e.target.value })}>
                      <option value="">Select table...</option>
                      {tables.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                )}
                {selectedEl.type === 'auto_narrative' && (
                  <>
                    <div className="form-group">
                      <label>Narrative Type</label>
                      <select value={selectedEl.narrativeType || 'highest'} onChange={e => updateElement(selectedEl.id, { narrativeType: e.target.value })}>
                        <option value="highest">Highest Values</option>
                        <option value="lowest">Lowest Values</option>
                        <option value="total">Grand Total Statement</option>
                        <option value="shares">Share Percentages</option>
                        <option value="comparison">Comparison vs Average</option>
                        <option value="custom">Custom Template</option>
                      </select>
                    </div>
                    {selectedEl.narrativeType === 'custom' && (
                      <div className="form-group">
                        <label>Template (use tokens)</label>
                        <textarea rows={4}
                          value={selectedEl.narrativeTemplate || ''}
                          onChange={e => updateElement(selectedEl.id, { narrativeTemplate: e.target.value })}
                          placeholder="{top_label} led with {top_value} out of {total} total {metric}." />
                        <div className="hint-text" style={{ marginTop: 4 }}>
                          Tokens: {'{top_label}'} {'{top_value}'} {'{bottom_label}'} {'{bottom_value}'} {'{total}'} {'{count}'} {'{metric}'} {'{table_name}'} {'{date}'} {'{filename}'} {'{total_rows}'}
                        </div>
                      </div>
                    )}
                    <div className="narrative-preview">
                      <label>Preview:</label>
                      <p style={{ fontSize: 11, color: 'var(--text-dim)', fontStyle: 'italic' }}>
                        {generateNarrative(selectedEl.tableId, tables, results, selectedEl.narrativeType || 'highest', selectedEl.narrativeTemplate, tokenContext)}
                      </p>
                    </div>
                  </>
                )}
                {selectedEl.type === 'cell_ref' && (
                  <>
                    <div className="form-group">
                      <label>Source Table</label>
                      <select value={selectedEl.tableId || ''} onChange={e => updateElement(selectedEl.id, { tableId: e.target.value, cellRow: 0, cellCol: 0 })}>
                        <option value="">Select table...</option>
                        {tables.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    </div>
                    {selectedEl.tableId && (() => {
                      const r = results.get(selectedEl.tableId);
                      if (!r) return <p style={{ fontSize: 11, color: 'var(--text-dim)' }}>No data</p>;
                      return (
                        <>
                          <div className="form-row">
                            <div className="form-group" style={{ flex: 1 }}>
                              <label>Row</label>
                              <select value={selectedEl.cellRow ?? 0} onChange={e => updateElement(selectedEl.id, { cellRow: parseInt(e.target.value) })}>
                                {r.rows.map((row, i) => <option key={i} value={i}>{String(row[0]).substring(0, 30)}</option>)}
                              </select>
                            </div>
                            <div className="form-group" style={{ flex: 1 }}>
                              <label>Column</label>
                              <select value={selectedEl.cellCol ?? 0} onChange={e => updateElement(selectedEl.id, { cellCol: parseInt(e.target.value) })}>
                                {r.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                              </select>
                            </div>
                          </div>
                          <div className="form-group">
                            <label>Display Label</label>
                            <input type="text" value={selectedEl.cellLabel || ''}
                              onChange={e => updateElement(selectedEl.id, { cellLabel: e.target.value })}
                              placeholder="Optional label" />
                          </div>
                          <div style={{ padding: '8px', background: 'var(--bg-2)', borderRadius: 4, fontSize: 12 }}>
                            Value: <strong>
                              {(() => {
                                const val = r.rows[selectedEl.cellRow ?? 0]?.[selectedEl.cellCol ?? 0];
                                return val != null ? String(val) : '—';
                              })()}
                            </strong>
                          </div>
                        </>
                      );
                    })()}
                  </>
                )}
                {['cover', 'heading', 'text', 'appendix', 'conditional'].includes(selectedEl.type) && (
                  <div className="form-group">
                    <label>{selectedEl.type === 'text' || selectedEl.type === 'conditional' ? 'Content' : 'Title'}</label>
                    {(selectedEl.type === 'text' || selectedEl.type === 'conditional') ? (
                      <textarea rows={6} value={selectedEl.content}
                        onChange={e => updateElement(selectedEl.id, { content: e.target.value })} />
                    ) : (
                      <input type="text" value={selectedEl.content}
                        onChange={e => updateElement(selectedEl.id, { content: e.target.value })} />
                    )}
                  </div>
                )}
                {selectedEl.type === 'conditional' && (
                  <div style={{ marginTop: 8, padding: 8, background: 'var(--bg-2)', borderRadius: 4 }}>
                    <label className="checkbox-label">
                      <input type="checkbox" checked={selectedEl.conditional ?? false}
                        onChange={e => updateElement(selectedEl.id, { conditional: e.target.checked })} />
                      Only include if table has data
                    </label>
                    {selectedEl.conditional && (
                      <div className="form-group" style={{ marginTop: 6 }}>
                        <label>Check Table</label>
                        <select value={selectedEl.condTableId || ''} onChange={e => updateElement(selectedEl.id, { condTableId: e.target.value })}>
                          <option value="">Select table...</option>
                          {tables.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                      </div>
                    )}
                  </div>
                )}
                {['text', 'heading', 'cover', 'conditional'].includes(selectedEl.type) && (
                  <div className="form-group" style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                    Tokens: {'{date}'} → {tokenContext.date}, {'{filename}'} → {tokenContext.filename || 'none'}, {'{total_rows}'} → {tokenContext.total_rows ?? 'none'}
                  </div>
                )}
              </div>
            ) : (
              <p className="props-empty">Select an element to edit its properties</p>
            )}
          </div>
        </div>
        <div className="modal-footer">
          {exportStatus && <span style={{ fontSize: 12, color: 'var(--success)' }}>{exportStatus}</span>}
          <button className="btn-secondary" onClick={() => setShowDocStyle(s => !s)}>⚙ Doc Style</button>
          <button className="btn-secondary" onClick={onClose}>Close</button>
          <button className="btn-secondary" onClick={handleExportWord}>📄 Export Report as Word</button>
          <button className="btn-primary" onClick={() => { if (onSaveTemplate) onSaveTemplate(elements, docStyle); setExportStatus('Template saved'); setTimeout(() => setExportStatus(''), 2000); }}>
            Save Template
          </button>
        </div>

        {showDocStyle && (
          <div style={{ position: 'absolute', bottom: 60, right: 20, background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 8, padding: 16, width: 280, zIndex: 10, boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
              <strong>Global Document Styling</strong>
              <button className="btn-icon" onClick={() => setShowDocStyle(false)}>×</button>
            </div>
            <div className="form-row" style={{ gap: 8 }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label>Body Font</label>
                <select value={docStyle.font} onChange={e => updateDocStyle({ font: e.target.value })}>
                  <option>Calibri</option><option>Arial</option><option>Times New Roman</option>
                  <option>Georgia</option><option>Garamond</option>
                </select>
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label>Font Size</label>
                <input type="number" min={8} max={16} value={docStyle.fontSize} onChange={e => updateDocStyle({ fontSize: parseInt(e.target.value) || 11 })} />
              </div>
            </div>
            <div className="form-group">
              <label>Heading Font</label>
              <select value={docStyle.headingFont} onChange={e => updateDocStyle({ headingFont: e.target.value })}>
                <option>Calibri Light</option><option>Arial</option><option>Times New Roman</option>
                <option>Georgia</option><option>Franklin Gothic Medium</option>
              </select>
            </div>
            <div className="form-row" style={{ gap: 8 }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label>Margins</label>
                <select value={docStyle.margins} onChange={e => updateDocStyle({ margins: e.target.value as any })}>
                  <option value="normal">Normal (1")</option>
                  <option value="narrow">Narrow (0.5")</option>
                  <option value="wide">Wide (1.5")</option>
                </select>
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label>Orientation</label>
                <select value={docStyle.orientation} onChange={e => updateDocStyle({ orientation: e.target.value as any })}>
                  <option value="portrait">Portrait</option>
                  <option value="landscape">Landscape</option>
                </select>
              </div>
            </div>
            <div className="form-group">
              <label>Line Spacing</label>
              <select value={docStyle.lineSpacing} onChange={e => updateDocStyle({ lineSpacing: parseFloat(e.target.value) })}>
                <option value={1}>Single</option>
                <option value={1.15}>1.15</option>
                <option value={1.5}>1.5</option>
                <option value={2}>Double</option>
              </select>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
