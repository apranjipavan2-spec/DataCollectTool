import React, { useState } from 'react';
import { TableResult, TableConfig } from '../types';

interface Props {
  datasetId: string;
  tables: TableConfig[];
  results: Map<string, TableResult>;
  annotationsMap?: Record<string, { rowIdx: number; colIdx: number; text: string; color: string }[]>;
  onClose: () => void;
}

interface ExportOptions {
  cover_page: boolean;
  cover_title: string;
  cover_subtitle: string;
  header_text: string;
  footer_text: string;
  page_numbers: boolean;
  include_raw_data: boolean;
  landscape: boolean;
  formula_export: boolean;
}

export function ExportDialog({ datasetId, tables, results, annotationsMap = {}, onClose }: Props) {
  const [format, setFormat] = useState('xlsx');
  const [filename, setFilename] = useState('TableForge_Export');
  const [selectedTables, setSelectedTables] = useState<Set<string>>(new Set(tables.map(t => t.id)));
  const [exporting, setExporting] = useState(false);
  const [resultMsg, setResultMsg] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [opts, setOpts] = useState<ExportOptions>({
    cover_page: false, cover_title: '', cover_subtitle: '',
    header_text: '', footer_text: '', page_numbers: true,
    include_raw_data: false, landscape: false, formula_export: false,
  });

  const toggleTable = (id: string) => {
    const next = new Set(selectedTables);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedTables(next);
  };

  const handleExport = async () => {
    setExporting(true);
    setError('');
    setResultMsg(null);
    try {
      const exportData = tables
        .filter(t => selectedTables.has(t.id))
        .map(t => {
          const res = results.get(t.id);
          return {
            name: t.name, headers: res?.headers || [], rows: res?.rows || [],
            title: t.title, subtitle: t.subtitle, footnote: t.footnote,
            header_renames: t.header_renames,
            annotations: annotationsMap[t.id] || [],
            // Formatting options for export fidelity
            column_widths: t.column_widths,
            row_height: t.row_height,
            serial_number: t.serial_number,
            serial_number_mode: t.serial_number_mode,
            conditional_formats: t.conditional_formats,
            header_formats: t.header_formats,
            zebra: t.zebra,
            zebra_color: t.zebra_color,
            theme: t.theme,
            title_color: t.title_color,
          };
        })
        .filter(t => t.headers.length > 0);

      if (exportData.length === 0) {
        setError('No tables with data to export');
        setExporting(false);
        return;
      }

      const res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dataset_id: datasetId, tables: exportData,
          format, filename, options: opts,
        }),
      });

      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setResultMsg(data.message);

      // Trigger browser download
      if (data.download_filename) {
        triggerDownload(`/api/export/download/${data.download_filename}`, data.download_filename);
      }
    } catch (e: any) {
      setError(e.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const handleBatchExport = async () => {
    setExporting(true); setError(''); setResultMsg(null);
    const exportData = tables
      .filter(t => selectedTables.has(t.id))
      .map(t => {
        const res = results.get(t.id);
        return {
          name: t.name, headers: res?.headers || [], rows: res?.rows || [],
          title: t.title, subtitle: t.subtitle, footnote: t.footnote,
          annotations: annotationsMap[t.id] || [],
          column_widths: t.column_widths,
          row_height: t.row_height,
          serial_number: t.serial_number,
          serial_number_mode: t.serial_number_mode,
          conditional_formats: t.conditional_formats,
          header_formats: t.header_formats,
          zebra: t.zebra,
          zebra_color: t.zebra_color,
          theme: t.theme,
          title_color: t.title_color,
        };
      })
      .filter(t => t.headers.length > 0);

    if (exportData.length === 0) { setError('No tables with data'); setExporting(false); return; }

    try {
      const [xlsxRes, docxRes] = await Promise.all([
        fetch('/api/export', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dataset_id: datasetId, tables: exportData, format: 'xlsx', filename: filename + '_batch', options: opts }) }),
        fetch('/api/export', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dataset_id: datasetId, tables: exportData, format: 'docx', filename: filename + '_batch', options: opts }) }),
      ]);
      const xlsxData = xlsxRes.ok ? await xlsxRes.json() : null;
      const docxData = docxRes.ok ? await docxRes.json() : null;
      if (xlsxData?.download_filename) {
        triggerDownload(`/api/export/download/${xlsxData.download_filename}`, xlsxData.download_filename);
      }
      if (docxData?.download_filename) {
        // Small delay to ensure first download starts before triggering second
        await new Promise(r => setTimeout(r, 100));
        triggerDownload(`/api/export/download/${docxData.download_filename}`, docxData.download_filename);
      }
      setResultMsg('Batch export complete: Excel + Word downloaded');
    } catch (e: any) {
      setError(e.message || 'Batch export failed');
    } finally { setExporting(false); }
  };

  const handleClipboard = async () => {
    const selected = tables.filter(t => selectedTables.has(t.id));
    const textParts: string[] = [];
    const htmlParts: string[] = [];

    for (const t of selected) {
      const res = results.get(t.id);
      if (!res || res.headers.length === 0) continue;

      // Plain text version
      const lines = [
        ...(t.title ? [t.title] : []),
        res.headers.join('\t'),
        ...res.rows.map(row => row.map(cell => cell != null ? String(cell) : '').join('\t')),
      ];
      textParts.push(lines.join('\n'));

      // HTML version for rich paste into Word/Excel
      let html = '';
      if (t.title) html += `<h3>${t.title}</h3>`;
      html += '<table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse;">';
      html += '<thead><tr>' + res.headers.map(h => `<th style="background:#1e293b;color:#fff;padding:6px 10px;">${h}</th>`).join('') + '</tr></thead>';
      html += '<tbody>';
      res.rows.forEach((row, ri) => {
        const bg = ri % 2 === 1 ? ' style="background:#f8f9fa;"' : '';
        html += `<tr${bg}>` + row.map(cell => `<td style="padding:4px 8px;">${cell != null ? String(cell) : ''}</td>`).join('') + '</tr>';
      });
      html += '</tbody></table>';
      htmlParts.push(html);
    }

    try {
      const textBlob = new Blob([textParts.join('\n\n')], { type: 'text/plain' });
      const htmlBlob = new Blob([htmlParts.join('<br/>')], { type: 'text/html' });
      await navigator.clipboard.write([
        new ClipboardItem({ 'text/plain': textBlob, 'text/html': htmlBlob })
      ]);
      setResultMsg('Copied to clipboard (HTML + text) — paste into Word or Excel');
    } catch {
      // Fallback to plain text if ClipboardItem not supported
      try {
        await navigator.clipboard.writeText(textParts.join('\n\n'));
        setResultMsg('Copied to clipboard as tab-separated text');
      } catch {
        setError('Clipboard access denied');
      }
    }
  };

  const formats = [
    { value: 'xlsx', label: 'Excel (.xlsx)', icon: '📊' },
    { value: 'docx', label: 'Word (.docx)', icon: '📄' },
    { value: 'csv', label: 'CSV (.csv)', icon: '📋' },
    { value: 'pdf', label: 'PDF (.pdf)', icon: '📕' },
    { value: 'python', label: 'Python Script', icon: '🐍' },
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-md" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Export Tables</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label>Filename</label>
            <input type="text" value={filename} onChange={e => setFilename(e.target.value)} />
          </div>

          <div className="form-group">
            <label>Format</label>
            <div className="btn-group format-group">
              {formats.map(f => (
                <button key={f.value}
                  className={`btn-toggle ${format === f.value ? 'active' : ''}`}
                  onClick={() => setFormat(f.value)}>
                  {f.icon} {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label>Tables to Export</label>
            <div className="table-select-list">
              {tables.map(t => {
                const res = results.get(t.id);
                const hasData = res && res.rows.length > 0;
                return (
                  <label key={t.id} className={`table-select-item ${!hasData ? 'disabled' : ''}`}>
                    <input type="checkbox" checked={selectedTables.has(t.id)}
                      onChange={() => toggleTable(t.id)} disabled={!hasData} />
                    <span>{t.name}</span>
                    <span className="table-info">{hasData ? `${res!.row_count} rows` : 'No data'}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Advanced Options */}
          <div className="advanced-toggle" onClick={() => setShowAdvanced(!showAdvanced)}>
            {showAdvanced ? '▾' : '▸'} Advanced Options
          </div>
          {showAdvanced && (
            <div className="advanced-opts">
              {(format === 'docx' || format === 'pdf') && (
                <>
                  <label className="checkbox-label">
                    <input type="checkbox" checked={opts.cover_page}
                      onChange={e => setOpts(o => ({ ...o, cover_page: e.target.checked }))} />
                    Include Cover Page
                  </label>
                  {opts.cover_page && (
                    <div className="form-row" style={{ marginTop: 8 }}>
                      <div className="form-group" style={{ flex: 1 }}>
                        <label>Cover Title</label>
                        <input type="text" value={opts.cover_title}
                          onChange={e => setOpts(o => ({ ...o, cover_title: e.target.value }))} />
                      </div>
                      <div className="form-group" style={{ flex: 1 }}>
                        <label>Cover Subtitle</label>
                        <input type="text" value={opts.cover_subtitle}
                          onChange={e => setOpts(o => ({ ...o, cover_subtitle: e.target.value }))} />
                      </div>
                    </div>
                  )}
                  <div className="form-row" style={{ marginTop: 8 }}>
                    <div className="form-group" style={{ flex: 1 }}>
                      <label>Header Text</label>
                      <input type="text" value={opts.header_text}
                        onChange={e => setOpts(o => ({ ...o, header_text: e.target.value }))}
                        placeholder="Report Title" />
                    </div>
                    <div className="form-group" style={{ flex: 1 }}>
                      <label>Footer Text</label>
                      <input type="text" value={opts.footer_text}
                        onChange={e => setOpts(o => ({ ...o, footer_text: e.target.value }))}
                        placeholder="Confidential" />
                    </div>
                  </div>
                  <label className="checkbox-label">
                    <input type="checkbox" checked={opts.page_numbers}
                      onChange={e => setOpts(o => ({ ...o, page_numbers: e.target.checked }))} />
                    Include Page Numbers
                  </label>
                  <label className="checkbox-label" style={{ marginTop: 6 }}>
                    <input type="checkbox" checked={opts.landscape}
                      onChange={e => setOpts(o => ({ ...o, landscape: e.target.checked }))} />
                    Landscape Orientation
                  </label>
                </>
              )}
              {format === 'xlsx' && (
                <>
                  <label className="checkbox-label">
                    <input type="checkbox" checked={opts.include_raw_data}
                      onChange={e => setOpts(o => ({ ...o, include_raw_data: e.target.checked }))} />
                    Include Raw Data Sheet
                  </label>
                  <label className="checkbox-label">
                    <input type="checkbox" checked={opts.formula_export}
                      onChange={e => setOpts(o => ({ ...o, formula_export: e.target.checked }))} />
                    Formula-Based Export (SUM/AVERAGE formulas instead of values)
                  </label>
                </>
              )}
            </div>
          )}

          {format === 'python' && (
            <div className="python-info" style={{ marginTop: 8, padding: '8px 12px', background: 'rgba(59,130,246,0.1)', borderRadius: 6, fontSize: 12, color: '#94a3b8' }}>
              Generates a pandas script reproducing the selected tables from your source file.
            </div>
          )}

          {/* Batch export */}
          <div className="advanced-toggle" onClick={() => {}} style={{ marginTop: 12, cursor: 'default', color: 'var(--text-dim)', fontSize: 12 }}>
            <span style={{ marginRight: 6 }}>📦</span>
            <span style={{ fontWeight: 600 }}>Batch Export: </span>
            <button className="btn-secondary" style={{ marginLeft: 8, padding: '2px 10px', fontSize: 11 }}
              onClick={handleBatchExport} disabled={exporting}>
              Export as Excel + Word
            </button>
          </div>

          {resultMsg && <div className="success-msg">{resultMsg}</div>}
          {error && <div className="error-msg">{error}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={handleClipboard} title="Copy as tab-separated text">
            📋 Copy to Clipboard
          </button>
          <button className="btn-secondary" onClick={onClose}>Close</button>
          <button className="btn-primary" onClick={handleExport} disabled={exporting || selectedTables.size === 0}>
            {exporting ? 'Exporting...' : `↓ Export ${selectedTables.size} Table(s)`}
          </button>
        </div>
      </div>
    </div>
  );
}

function triggerDownload(url: string, filename: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
