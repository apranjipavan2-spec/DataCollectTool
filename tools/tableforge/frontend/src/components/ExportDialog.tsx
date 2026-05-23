import React, { useState, useRef } from 'react';
import { TableResult, TableConfig, NumberFormat } from '../types';
import { API_BASE } from '../api';
import { ChartCanvas } from './ChartCanvas';
import { buildChartExportSvg, svgXmlToPngDataUrl, figTitleFromTable, ChartType, LegendPos, W_DEFAULT, H_DEFAULT } from './chartUtils';

function formatCell(cell: any): string {
  if (cell == null) return '';
  if (typeof cell === 'number') {
    if (Number.isInteger(cell) && Math.abs(cell) < 1e15) return cell.toLocaleString();
    return cell.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  return String(cell);
}

function applyFormat(val: number, fmt: NumberFormat): string {
  const { style, decimals, separator, currency_symbol, prefix, suffix } = fmt;
  const opts: Intl.NumberFormatOptions = {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: separator,
  };
  let formatted = '';
  if (style === 'percent') {
    formatted = val.toLocaleString(undefined, opts) + '%';
  } else if (style === 'currency') {
    formatted = (currency_symbol || '$') + val.toLocaleString(undefined, opts);
  } else {
    formatted = val.toLocaleString(undefined, opts);
  }
  return (prefix || '') + formatted + (suffix || '');
}

function buildFormattedRows(t: TableConfig, res: TableResult): string[][] {
  const numRowFields = t.rows?.length || 0;
  const valFormats: NumberFormat[] = (t.values || []).map(v => {
    const base = v.number_format || {
      style: 'number' as const, decimals: 2, separator: true, prefix: '', suffix: '', currency_symbol: '$',
    };
    if (v.decimals !== undefined && v.decimals !== null) {
      return { ...base, decimals: v.decimals };
    }
    return base;
  });

  return res.rows.map((row, ri) => {
    const isGrandTotal = String(row[0]) === 'Grand Total';
    const serialNum = t.serial_number
      ? (isGrandTotal ? '' : String(ri + 1))
      : null;

    const cells: string[] = [];
    if (t.serial_number) cells.push(serialNum || '');

    for (let ci = 0; ci < row.length; ci++) {
      const cell = row[ci];
      if (cell == null) { cells.push(''); continue; }
      const valIdx = ci - numRowFields;
      if (typeof cell === 'number' && valIdx >= 0 && valFormats.length > 0) {
        cells.push(applyFormat(cell, valFormats[valIdx % valFormats.length]));
      } else {
        cells.push(formatCell(cell));
      }
    }
    return cells;
  });
}

function buildExportHtml(t: TableConfig, res: TableResult, fmtRows: string[][]): string {
  const renames = t.header_renames || {};
  const dispHeaders = res.headers.map(h => renames[h] || h);
  const allHeaders = t.serial_number ? ['#', ...dispHeaders] : dispHeaders;
  const nRowCols = (t.rows?.length || 0) + (t.serial_number ? 1 : 0);
  const cg = res.column_groups;
  const hasMultiLevel = cg?.has_multi_level;

  const hdrFmtMap: Record<string, any> = {};
  for (const hf of (t.header_formats || [])) {
    if (hf.field) {
      const displayName = renames[hf.field] || hf.field;
      hdrFmtMap[displayName] = hf;
    }
  }

  const headerBg = t.header_bg_color || '#1e293b';
  const headerColor = t.header_text_color || '#fff';
  const hdrAlign = t.header_align || 'center';
  const cellAlign = t.cell_align || 'right';
  const rowLabelAlign = t.row_label_align || 'left';
  const totalBg = t.total_bg_color || '#e8f0fe';
  const colWidths: Record<string, number> = {};
  if (t.column_widths) {
    for (const [key, val] of Object.entries(t.column_widths)) {
      colWidths[renames[key] || key] = val as number;
    }
  }
  const TF = "Times New Roman";

  function thStyle(colName: string, align = hdrAlign): string {
    const fmt = hdrFmtMap[colName];
    const w = colWidths[colName];
    let s = `background:${fmt?.backgroundColor || headerBg};color:${fmt?.color || headerColor};padding:6px 10px;text-align:${align};font-size:12pt;font-family:${TF},Georgia,serif;`;
    if (w) s += `width:${w}px;`;
    if (fmt?.font) s += `font-family:${fmt.font};`;
    if (fmt?.size) s += `font-size:${Math.round(fmt.size * 0.75)}pt;`;
    if (fmt?.bold === false) s += 'font-weight:normal;';
    if (fmt?.italic) s += 'font-style:italic;';
    return s;
  }

  let html = `<table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse;font-family:${TF},Georgia,serif;font-size:12pt;width:100%;">`;
  html += '<thead>';

  if (hasMultiLevel) {
    const totalCols = allHeaders.length;
    const topStyle = `background:${headerBg};color:${headerColor};padding:6px 10px;text-align:center;font-size:12pt;font-family:${TF},Georgia,serif;`;
    html += '<tr>';
    for (let i = 0; i < nRowCols; i++) {
      html += `<th style="${thStyle(allHeaders[i])};vertical-align:middle;">${allHeaders[i]}</th>`;
    }
    for (const g of cg!.top) {
      html += `<th style="${topStyle}">${g.label}</th>`;
      for (let s = 1; s < g.colspan; s++) html += `<th style="${topStyle}"></th>`;
    }
    html += '</tr><tr>';
    for (let i = 0; i < nRowCols; i++) html += `<th style="${thStyle(allHeaders[i])}"></th>`;
    const bottomLabels = cg!.bottom.map((b: string) => String(b));
    for (let i = 0; i < bottomLabels.length; i++) {
      const colIdx = (t.rows?.length || 0) + i;
      const colName = dispHeaders[colIdx] || bottomLabels[i];
      html += `<th style="${thStyle(colName)}">${bottomLabels[i]}</th>`;
    }
    html += '</tr>';
  } else {
    html += '<tr>' + allHeaders.map(h => `<th style="${thStyle(h)}">${h}</th>`).join('') + '</tr>';
  }

  html += '</thead><tbody>';
  fmtRows.forEach((row, ri) => {
    const isGrand = row[0] === 'Grand Total';
    const zebraStyle = !isGrand && t.zebra && ri % 2 === 1 ? `background:${t.zebra_color || '#f8f9fa'};` : '';
    const grandStyle = isGrand ? `background:${totalBg};font-weight:bold;` : '';
    html += '<tr>' + row.map((cell, ci) => {
      const isValCol = ci >= nRowCols;
      const align = isValCol ? cellAlign : rowLabelAlign;
      const cellHtml = cell.includes('\n') ? cell.replace(/\n/g, '<br>') : cell;
      return `<td style="padding:4px 8px;text-align:${align};font-size:12pt;font-family:${TF},Georgia,serif;${grandStyle}${zebraStyle}">${cellHtml}</td>`;
    }).join('') + '</tr>';
  });
  html += '</tbody></table>';

  return html;
}

interface Props {
  datasetId: string;
  tables: TableConfig[];
  results: Map<string, TableResult>;
  annotationsMap?: Record<string, { rowIdx: number; colIdx: number; text: string; color: string }[]>;
  interpretationsMap?: Record<string, string>;
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

export function ExportDialog({ datasetId, tables, results, annotationsMap = {}, interpretationsMap = {}, onClose }: Props) {
  const [format, setFormat] = useState('docx');
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

  // Off-screen ChartCanvas refs so we can serialize SVGs to PNG for Word/PPTX export.
  // One ref per table id; populated when the hidden <ChartCanvas> below mounts.
  const chartRefs = useRef<Record<string, SVGSVGElement | null>>({});

  // For each selected table that has a chartConfig + result, render the chart
  // to a PNG (base64) and return { chart_image, chart_title } for the payload.
  // Title is sent SEPARATELY so the Word doc can place it as an editable paragraph
  // above the image (per user request: image = chart, title = editable text).
  async function renderChartFor(t: TableConfig): Promise<{ chart_image?: string; chart_title?: string }> {
    const cc = t.chartConfig;
    const res = results.get(t.id);
    if (!cc || !cc.xField || !res) return {};
    if (!cc.yFields || cc.yFields.length === 0) return {};
    const svg = chartRefs.current[t.id];
    if (!svg) return {};
    const title = ((cc.chartTitle as string) || '').trim() || figTitleFromTable(t);
    const width = (typeof cc.chartWidth === 'number' && cc.chartWidth > 0) ? cc.chartWidth : W_DEFAULT;
    const height = (typeof cc.chartHeight === 'number' && cc.chartHeight > 0) ? cc.chartHeight : H_DEFAULT;
    const titleFs = (typeof cc.titleFontSize === 'number' && cc.titleFontSize > 0) ? cc.titleFontSize : 14;
    const { xml, totalHeight } = buildChartExportSvg({
      svgElement: svg,
      title: '',  // image carries chart only; title is sent separately for Word editability
      titleFontSize: titleFs,
      width,
      height,
    });
    try {
      const dataUrl = await svgXmlToPngDataUrl(xml, width, totalHeight, 2);
      const base64 = dataUrl.split(',')[1] || '';
      return { chart_image: base64, chart_title: title };
    } catch (err) {
      console.error('Chart PNG render failed for table', t.id, err);
      return {};
    }
  }

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
      const selectedT = tables.filter(t => selectedTables.has(t.id));
      // Pre-render charts only for formats that embed them (Word currently).
      // Sequential rendering — keeps memory bounded for large packs.
      const chartFieldsByTable: Record<string, { chart_image?: string; chart_title?: string }> = {};
      const formatEmbedsCharts = format === 'docx';
      const tablesWithCharts = formatEmbedsCharts
        ? selectedT.filter(t => t.chartConfig && t.chartConfig.xField)
        : [];
      for (let i = 0; i < tablesWithCharts.length; i++) {
        const t = tablesWithCharts[i];
        setResultMsg(`Rendering chart ${i + 1} of ${tablesWithCharts.length}: ${t.title || t.name}`);
        chartFieldsByTable[t.id] = await renderChartFor(t);
      }
      if (selectedT.length > 0) {
        setResultMsg(`Packaging ${selectedT.length} table${selectedT.length !== 1 ? 's' : ''} for ${format.toUpperCase()} export…`);
      }

      const exportData = selectedT
        .map(t => {
          const res = results.get(t.id);
          if (!res) return null;
          const renames = t.header_renames || {};
          const displayHeaders = res.headers.map(h => renames[h] || h);
          const fmtRows = buildFormattedRows(t, res);
          const nRowCols = (t.rows?.length || 0) + (t.serial_number ? 1 : 0);
          const cg = res.column_groups;
          const columnGroups = cg?.has_multi_level ? {
            top: cg.top.map(g => ({
              label: g.label,
              colspan: g.colspan,
            })),
            bottom: cg.bottom.map(b => String(b)),
            has_multi_level: true,
          } : undefined;
          const remappedWidths: Record<string, number> = {};
          if (t.column_widths) {
            for (const [key, val] of Object.entries(t.column_widths)) {
              remappedWidths[renames[key] || key] = val as number;
            }
          }
          const remappedHdrFmts = (t.header_formats || []).map(hf => ({
            ...hf,
            field: hf.field ? (renames[hf.field] || hf.field) : hf.field,
          }));
          return {
            name: t.name,
            headers: t.serial_number ? ['#', ...displayHeaders] : displayHeaders,
            rows: t.serial_number
              ? res.rows.map((row, ri) => {
                  const isGT = String(row[0]) === 'Grand Total';
                  return [isGT ? '' : ri + 1, ...row];
                })
              : res.rows,
            formatted_rows: fmtRows,
            styled_html: buildExportHtml(t, res, fmtRows),
            title: t.title, subtitle: t.subtitle, footnote: t.footnote,
            annotations: annotationsMap[t.id] || [],
            interpretation: interpretationsMap[t.id] || '',
            num_row_fields: nRowCols,
            column_groups: columnGroups,
            cell_align: t.cell_align || 'right',
            header_align: t.header_align || 'center',
            row_label_align: t.row_label_align || 'left',
            column_widths: remappedWidths,
            row_height: t.row_height,
            serial_number: t.serial_number,
            zebra: t.zebra,
            zebra_color: t.zebra_color,
            title_color: t.title_color,
            title_bold: t.title_bold,
            title_italic: t.title_italic,
            title_size: t.title_size,
            title_align: t.title_align,
            header_bg_color: t.header_bg_color,
            header_text_color: t.header_text_color,
            total_bg_color: t.total_bg_color,
            bg_color: t.bg_color,
            row_bg_color: t.row_bg_color,
            header_formats: remappedHdrFmts,
            footnotes: t.footnotes,
            value_formats: (t.values || []).map(v => ({
              decimals: v.decimals ?? 2,
              style: v.number_format?.style || 'number',
              separator: v.number_format?.separator ?? true,
              prefix: v.number_format?.prefix || '',
              suffix: v.number_format?.suffix || '',
              currency_symbol: v.number_format?.currency_symbol || '$',
            })),
            ...(chartFieldsByTable[t.id] || {}),
          };
        })
        .filter(t => t && t.headers.length > 0);

      if (exportData.length === 0) {
        setError('No tables with data to export');
        setExporting(false);
        return;
      }

      const res = await fetch(`${API_BASE}/export`, {
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

      if (data.download_filename) {
        await triggerDownload(`${API_BASE}/export/download/${data.download_filename}`, data.download_filename);
      }
    } catch (e: any) {
      setError(e.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const handleBatchExport = async () => {
    setExporting(true); setError(''); setResultMsg(null);
    const selectedT = tables.filter(t => selectedTables.has(t.id));
    const chartFieldsByTable: Record<string, { chart_image?: string; chart_title?: string }> = {};
    const tablesWithCharts = selectedT.filter(t => t.chartConfig && t.chartConfig.xField);
    for (let i = 0; i < tablesWithCharts.length; i++) {
      const t = tablesWithCharts[i];
      setResultMsg(`Rendering chart ${i + 1} of ${tablesWithCharts.length}: ${t.title || t.name}`);
      chartFieldsByTable[t.id] = await renderChartFor(t);
    }
    if (selectedT.length > 0) {
      setResultMsg(`Packaging ${selectedT.length} table${selectedT.length !== 1 ? 's' : ''} for batch (Excel + Word) export…`);
    }
    const exportData = selectedT
      .map(t => {
        const res = results.get(t.id);
        if (!res) return null;
        const renames = t.header_renames || {};
        const displayHeaders = res.headers.map(h => renames[h] || h);
        const fmtRows = buildFormattedRows(t, res);
        const nRowCols = (t.rows?.length || 0) + (t.serial_number ? 1 : 0);
        const cg = res.column_groups;
        const columnGroups = cg?.has_multi_level ? {
          top: cg.top.map(g => ({ label: g.label, colspan: g.colspan })),
          bottom: cg.bottom.map(b => String(b)),
          has_multi_level: true,
        } : undefined;
        const batchRemappedWidths: Record<string, number> = {};
        if (t.column_widths) {
          for (const [key, val] of Object.entries(t.column_widths)) {
            batchRemappedWidths[renames[key] || key] = val as number;
          }
        }
        const batchRemappedHdrFmts = (t.header_formats || []).map(hf => ({
          ...hf,
          field: hf.field ? (renames[hf.field] || hf.field) : hf.field,
        }));
        return {
          name: t.name,
          headers: t.serial_number ? ['#', ...displayHeaders] : displayHeaders,
          rows: t.serial_number
            ? res.rows.map((row, ri) => {
                const isGT = String(row[0]) === 'Grand Total';
                return [isGT ? '' : ri + 1, ...row];
              })
            : res.rows,
          formatted_rows: fmtRows,
          styled_html: buildExportHtml(t, res, fmtRows),
          title: t.title, subtitle: t.subtitle, footnote: t.footnote,
          header_renames: t.header_renames,
          annotations: annotationsMap[t.id] || [],
          interpretation: interpretationsMap[t.id] || '',
          num_row_fields: nRowCols,
          column_groups: columnGroups,
          cell_align: t.cell_align || 'right',
          header_align: t.header_align || 'center',
          row_label_align: t.row_label_align || 'left',
          column_widths: batchRemappedWidths,
          row_height: t.row_height,
          serial_number: t.serial_number,
          zebra: t.zebra,
          zebra_color: t.zebra_color,
          title_color: t.title_color,
          title_bold: t.title_bold,
          title_italic: t.title_italic,
          title_size: t.title_size,
          title_align: t.title_align,
          header_bg_color: t.header_bg_color,
          header_text_color: t.header_text_color,
          total_bg_color: t.total_bg_color,
          bg_color: t.bg_color,
          row_bg_color: t.row_bg_color,
          header_formats: batchRemappedHdrFmts,
          footnotes: t.footnotes,
          value_formats: (t.values || []).map(v => ({
            decimals: v.decimals ?? 2,
            style: v.number_format?.style || 'number',
            separator: v.number_format?.separator ?? true,
            prefix: v.number_format?.prefix || '',
            suffix: v.number_format?.suffix || '',
            currency_symbol: v.number_format?.currency_symbol || '$',
          })),
          ...(chartFieldsByTable[t.id] || {}),
        };
      })
      .filter(t => t && t.headers.length > 0);

    if (exportData.length === 0) { setError('No tables with data'); setExporting(false); return; }

    try {
      const [xlsxRes, docxRes] = await Promise.all([
        fetch(`${API_BASE}/export`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dataset_id: datasetId, tables: exportData, format: 'xlsx', filename: filename + '_batch', options: opts }) }),
        fetch(`${API_BASE}/export`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dataset_id: datasetId, tables: exportData, format: 'docx', filename: filename + '_batch', options: opts }) }),
      ]);
      const xlsxData = xlsxRes.ok ? await xlsxRes.json() : null;
      const docxData = docxRes.ok ? await docxRes.json() : null;
      if (xlsxData?.download_filename) {
        await triggerDownload(`${API_BASE}/export/download/${xlsxData.download_filename}`, xlsxData.download_filename);
      }
      if (docxData?.download_filename) {
        await triggerDownload(`${API_BASE}/export/download/${docxData.download_filename}`, docxData.download_filename);
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

      const renames = t.header_renames || {};
      const dispHeaders = res.headers.map(h => renames[h] || h);
      const fmtRows = buildFormattedRows(t, res);
      const allHeaders = t.serial_number ? ['#', ...dispHeaders] : dispHeaders;
      const nRowCols = (t.rows?.length || 0) + (t.serial_number ? 1 : 0);
      const cg = res.column_groups;
      const hasMultiLevel = cg?.has_multi_level;

      // Plain text version
      const lines: string[] = [];
      if (t.title) lines.push(t.title);
      if (t.subtitle) lines.push(t.subtitle);
      if (hasMultiLevel) {
        const topRow: string[] = [];
        for (let i = 0; i < nRowCols; i++) topRow.push(allHeaders[i]);
        for (const g of cg!.top) {
          topRow.push(g.label);
          for (let s = 1; s < g.colspan; s++) topRow.push('');
        }
        lines.push(topRow.join('\t'));
        const botRow: string[] = [];
        for (let i = 0; i < nRowCols; i++) botRow.push('');
        const bottomLabels = cg!.bottom.map((b: string, i: number) => {
          const origH = res.headers[i + (t.rows?.length || 0)];
          return origH ? (renames[origH] || b) : b;
        });
        botRow.push(...bottomLabels);
        lines.push(botRow.join('\t'));
      } else {
        lines.push(allHeaders.join('\t'));
      }
      lines.push(...fmtRows.map(row => row.join('\t')));
      textParts.push(lines.join('\n'));

      // HTML version for rich paste into Word/Excel
      const headerFormats = t.header_formats || [];
      const hdrFmtMap: Record<string, any> = {};
      for (const hf of headerFormats) { if (hf.field) hdrFmtMap[hf.field] = hf; }
      const headerBg = t.header_bg_color || '#1e293b';
      const headerColor = t.header_text_color || '#fff';
      const hdrAlign = t.header_align || 'center';
      const cellAlign = t.cell_align || 'right';
      const rowLabelAlign = t.row_label_align || 'left';

      function thStyle(colName: string, align = hdrAlign) {
        const fmt = hdrFmtMap[colName];
        let s = `background:${fmt?.backgroundColor || headerBg};color:${fmt?.color || headerColor};padding:6px 10px;text-align:${align};`;
        if (fmt?.font) s += `font-family:${fmt.font};`;
        if (fmt?.size) s += `font-size:${fmt.size}px;`;
        if (fmt?.bold === false) s += 'font-weight:normal;';
        if (fmt?.italic) s += 'font-style:italic;';
        return s;
      }

      let html = '';
      if (t.title) html += `<h3>${t.title}</h3>`;
      if (t.subtitle) html += `<p style="color:#666;font-size:11px;">${t.subtitle}</p>`;
      html += '<table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse;">';
      html += '<thead>';
      if (hasMultiLevel) {
        html += '<tr>';
        for (let i = 0; i < nRowCols; i++) {
          html += `<th rowspan="2" style="${thStyle(allHeaders[i], hdrAlign)};vertical-align:middle;">${allHeaders[i]}</th>`;
        }
        for (const g of cg!.top) {
          html += `<th colspan="${g.colspan}" style="background:${headerBg};color:${headerColor};padding:6px 10px;text-align:center;">${g.label}</th>`;
        }
        html += '</tr><tr>';
        const bottomLabels = cg!.bottom.map((b: string, i: number) => {
          const origH = res.headers[i + (t.rows?.length || 0)];
          return origH ? (renames[origH] || b) : b;
        });
        for (let i = 0; i < bottomLabels.length; i++) {
          const colName = dispHeaders[(t.rows?.length || 0) + i] || bottomLabels[i];
          html += `<th style="${thStyle(colName, hdrAlign)}">${bottomLabels[i]}</th>`;
        }
        html += '</tr>';
      } else {
        html += '<tr>' + allHeaders.map(h => `<th style="${thStyle(h, hdrAlign)}">${h}</th>`).join('') + '</tr>';
      }
      html += '</thead>';
      html += '<tbody>';
      fmtRows.forEach((row, ri) => {
        const bg = ri % 2 === 1 ? 'background:#f8f9fa;' : '';
        html += `<tr>` + row.map((cell, ci) => {
          const isValCol = ci >= nRowCols;
          const align = isValCol ? cellAlign : rowLabelAlign;
          return `<td style="padding:4px 8px;text-align:${align};${bg}">${cell}</td>`;
        }).join('') + '</tr>';
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
    { value: 'docx', label: 'Word (.docx)', icon: '📄' },
    { value: 'xlsx', label: 'Excel (.xlsx)', icon: '📊' },
    { value: 'csv', label: 'CSV (.csv)', icon: '📋' },
    { value: 'pdf', label: 'PDF (.pdf)', icon: '📕' },
    { value: 'pptx', label: 'PowerPoint (.pptx)', icon: '📽' },
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label>Tables to Export</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn-secondary" style={{ padding: '2px 10px', fontSize: 11 }}
                  onClick={() => setSelectedTables(new Set(tables.filter(t => results.get(t.id)?.rows?.length).map(t => t.id)))}>
                  Select All
                </button>
                <button className="btn-secondary" style={{ padding: '2px 10px', fontSize: 11 }}
                  onClick={() => setSelectedTables(new Set())}>
                  Deselect All
                </button>
              </div>
            </div>
            <div className="table-select-list">
              {tables.map((t, i) => {
                const res = results.get(t.id);
                const hasData = res && res.rows.length > 0;
                return (
                  <label key={t.id} className={`table-select-item ${!hasData ? 'disabled' : ''}`}>
                    <input type="checkbox" checked={selectedTables.has(t.id)}
                      onChange={() => toggleTable(t.id)} disabled={!hasData} />
                    <span className="exp-table-num">#{i + 1}</span>
                    {t.pinned && <span title="Pinned" style={{ color: '#f59e0b', marginRight: 4 }}>★</span>}
                    {t.chartConfig && t.chartConfig.xField && (
                      <span title={`Chart attached${format === 'docx' ? ' — will be embedded in Word' : ' — only embedded in Word (.docx) exports'}`}
                        style={{ color: '#60a5fa', marginRight: 4, fontSize: 12 }}>📊</span>
                    )}
                    <span>{t.title || t.name}</span>
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

      {/* Off-screen ChartCanvas instances for tables with a configured chart.
          We serialize these SVGs to PNG when the user hits Export. They are
          positioned off-screen but still in the layout tree so refs populate. */}
      <div aria-hidden="true" style={{
        position: 'fixed', left: -100000, top: -100000,
        pointerEvents: 'none', visibility: 'hidden',
      }}>
        {tables.filter(t => selectedTables.has(t.id) && t.chartConfig && t.chartConfig.xField).map(t => {
          const cc = t.chartConfig!;
          const res = results.get(t.id);
          if (!res) return null;
          const width = (typeof cc.chartWidth === 'number' && cc.chartWidth > 0) ? cc.chartWidth : W_DEFAULT;
          const height = (typeof cc.chartHeight === 'number' && cc.chartHeight > 0) ? cc.chartHeight : H_DEFAULT;
          const canvasConfig = {
            type: (cc.type as ChartType) || 'bar',
            xField: cc.xField as string,
            yFields: (cc.yFields as string[]) || [],
            paletteName: cc.palette as string | undefined,
            showGrid: cc.showGrid as boolean | undefined,
            showLabels: cc.showLabels as boolean | undefined,
            showLegend: (cc.showLegend as LegendPos | undefined),
            xAxisLabel: cc.xAxisLabel as string | undefined,
            yAxisLabel: cc.yAxisLabel as string | undefined,
            labelFontSize: cc.labelFontSize as number | undefined,
            barOpacity: cc.barOpacity as number | undefined,
            xLabelRotation: cc.xLabelRotation as number | 'auto' | undefined,
            yLabelRotation: cc.yLabelRotation as number | undefined,
            valueLabelSplit: cc.valueLabelSplit as boolean | undefined,
          };
          return (
            <ChartCanvas
              key={t.id}
              ref={el => { chartRefs.current[t.id] = el; }}
              result={res}
              config={canvasConfig}
              width={width}
              height={height}
              interactive={false}
            />
          );
        })}
      </div>
    </div>
  );
}

async function triggerDownload(url: string, filename: string) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
  } catch {
    window.open(url, '_blank');
  }
}
