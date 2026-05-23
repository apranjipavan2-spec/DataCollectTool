import React, { useState, useEffect, useMemo, useRef } from 'react';
import { TableResult, TableConfig } from '../types';
import { ChartCanvas, ChartCanvasConfig } from './ChartCanvas';
import { CHART_TYPES, PALETTES, ChartType, LegendPos, classifyColumns, W_DEFAULT, H_DEFAULT, figTitleFromTable, buildChartExportSvg, svgXmlToPngDataUrl } from './chartUtils';

interface Props {
  tables: TableConfig[];
  results: Map<string, TableResult>;
  onClose: () => void;
  onChartChange?: (tableId: string, chartConfig: any) => void;
  activeTableIdx?: number;
}

type Tab = 'data' | 'style' | 'axes' | 'size';
const ASPECT_PRESETS: { value: string; label: string; ratio: number | null }[] = [
  { value: 'auto',  label: 'Auto (fit text)', ratio: null },
  { value: '16:9',  label: '16 : 9 (wide)',   ratio: 16 / 9 },
  { value: '4:3',   label: '4 : 3 (slide)',   ratio: 4 / 3 },
  { value: '3:2',   label: '3 : 2',           ratio: 3 / 2 },
  { value: '1:1',   label: '1 : 1 (square)',  ratio: 1 },
  { value: 'custom', label: 'Custom',         ratio: null },
];

export function ChartBuilder({ tables, results, onClose, onChartChange, activeTableIdx }: Props) {
  const initialIdx = (typeof activeTableIdx === 'number' && activeTableIdx >= 0 && activeTableIdx < tables.length) ? activeTableIdx : 0;
  const [tableIdx, setTableIdx] = useState(initialIdx);
  const [tab, setTab] = useState<Tab>('data');
  const [chartType, setChartType] = useState<ChartType>('bar');
  const [xField, setXField] = useState('');
  const [yFields, setYFields] = useState<string[]>([]);
  const [palette, setPalette] = useState(0);
  const [showGrid, setShowGrid] = useState(true);
  const [showLabels, setShowLabels] = useState(false);
  const [showLegend, setShowLegend] = useState<LegendPos>('right');
  const [chartTitle, setChartTitle] = useState('');
  const [xAxisLabel, setXAxisLabel] = useState('');
  const [yAxisLabel, setYAxisLabel] = useState('');
  const [labelFontSize, setLabelFontSize] = useState(10);
  const [titleFontSize, setTitleFontSize] = useState(14);
  const [barOpacity, setBarOpacity] = useState(0.9);
  const [chartOnly, setChartOnly] = useState(false);
  const [xLabelRotation, setXLabelRotation] = useState<number | 'auto'>('auto');
  const [yLabelRotation, setYLabelRotation] = useState<number>(0);
  const [chartWidth, setChartWidth] = useState<number>(W_DEFAULT);
  const [chartHeight, setChartHeight] = useState<number>(H_DEFAULT);
  const [aspectPreset, setAspectPreset] = useState<string>('auto');
  const [valueLabelSplit, setValueLabelSplit] = useState<boolean>(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; startW: number; startH: number } | null>(null);

  const table = tables[tableIdx];

  useEffect(() => {
    const cc = table?.chartConfig;
    if (cc) {
      setChartType((cc.type as ChartType) || 'bar');
      setXField(cc.xField || '');
      setYFields(cc.yFields || []);
      setPalette(Math.max(0, PALETTES.findIndex(p => p.name === cc.palette)));
      setShowGrid(cc.showGrid !== false);
      setShowLabels(cc.showLabels || false);
      setShowLegend((cc.showLegend as unknown as LegendPos) || 'right');
      setChartTitle(cc.chartTitle || '');
      setXAxisLabel(cc.xAxisLabel || '');
      setYAxisLabel(cc.yAxisLabel || '');
      setLabelFontSize(cc.labelFontSize || 10);
      setTitleFontSize(cc.titleFontSize || 14);
      setBarOpacity(cc.barOpacity ?? 0.9);
      setChartOnly(!!cc.chart_only);
      const xRot = cc.xLabelRotation;
      setXLabelRotation(xRot === undefined || xRot === null ? 'auto' : (xRot === 'auto' ? 'auto' : Number(xRot)));
      setYLabelRotation(typeof cc.yLabelRotation === 'number' ? cc.yLabelRotation : 0);
      setChartWidth(typeof cc.chartWidth === 'number' ? cc.chartWidth : W_DEFAULT);
      setChartHeight(typeof cc.chartHeight === 'number' ? cc.chartHeight : H_DEFAULT);
      setAspectPreset(typeof cc.aspectPreset === 'string' ? cc.aspectPreset : 'auto');
      setValueLabelSplit(!!cc.valueLabelSplit);
    } else {
      setChartType('bar'); setXField(''); setYFields([]);
      setPalette(0); setShowGrid(true); setShowLabels(false); setShowLegend('right');
      setChartTitle(''); setXAxisLabel(''); setYAxisLabel('');
      setLabelFontSize(10); setTitleFontSize(14); setBarOpacity(0.9);
      setChartOnly(false);
      setXLabelRotation('auto'); setYLabelRotation(0);
      setChartWidth(W_DEFAULT); setChartHeight(H_DEFAULT); setAspectPreset('auto');
      setValueLabelSplit(false);
    }
  }, [table?.id]);

  // When a non-auto/non-custom aspect preset is picked, keep height locked to width / ratio.
  useEffect(() => {
    const preset = ASPECT_PRESETS.find(p => p.value === aspectPreset);
    if (preset && preset.ratio) {
      setChartHeight(Math.round(chartWidth / preset.ratio));
    }
  }, [aspectPreset, chartWidth]);

  const result: TableResult | null = (table ? results.get(table.id) : null) || null;
  const headers = result?.headers || [];
  const rows = useMemo(() => (result?.rows || []).filter(r => String(r[0]) !== 'Grand Total'), [result]);
  const { textCols, numCols } = useMemo(() => classifyColumns(headers, rows), [headers, rows]);

  const effectiveX = xField || textCols[0] || headers[0] || '';
  // Default Y selection: pick all numeric columns except Total/Grand Total
  // (so a District × Beneficiary/Non-Beneficiary table renders both series).
  // Caps at 4 to keep the chart readable; user can deselect via the Y picker.
  const effectiveY = (() => {
    if (yFields.length > 0) return yFields;
    const nonTotal = numCols.filter(c => !/\btotal\b/i.test(c));
    const pool = nonTotal.length > 0 ? nonTotal : numCols;
    if (pool.length > 0) return pool.slice(0, 4);
    return headers[1] ? [headers[1]] : [];
  })();

  const toggleYField = (field: string) => {
    setYFields(prev => {
      const next = prev.includes(field) ? prev.filter(f => f !== field) : [...prev, field];
      return next.length > 0 ? next : prev;
    });
  };

  const buildConfig = (): ChartCanvasConfig => ({
    type: chartType,
    xField: effectiveX,
    yFields: effectiveY,
    paletteName: PALETTES[palette]?.name,
    showGrid, showLabels, showLegend,
    xAxisLabel, yAxisLabel, labelFontSize, barOpacity,
    xLabelRotation, yLabelRotation,
    valueLabelSplit,
  });

  const autoFigTitle = useMemo(() => table ? figTitleFromTable(table) : '', [table?.title, table?.name, table?.table_number]);
  const effectiveTitle = chartTitle.trim() || autoFigTitle;

  const saveAndClose = () => {
    if (onChartChange && table) {
      onChartChange(table.id, {
        type: chartType,
        xField: effectiveX,
        yFields: effectiveY,
        palette: PALETTES[palette].name,
        showGrid, showLabels, showLegend,
        chartTitle, xAxisLabel, yAxisLabel,
        labelFontSize, titleFontSize, barOpacity,
        chart_only: chartOnly,
        xLabelRotation, yLabelRotation,
        chartWidth, chartHeight, aspectPreset,
        valueLabelSplit,
      });
    }
    onClose();
  };

  const handleDownload = async (format: 'svg' | 'png') => {
    if (!svgRef.current) return;
    // Wrap the chart SVG with the title so it appears in both SVG and PNG downloads.
    // (The title is rendered as an HTML input outside the SVG in the builder, so
    // the raw SVG serialization would lose it.)
    const { xml, totalHeight } = buildChartExportSvg({
      svgElement: svgRef.current,
      title: effectiveTitle,
      titleFontSize,
      width: chartWidth,
      height: effectiveHeight,
    });
    const fileBase = `chart_${table?.name || 'export'}`;
    if (format === 'svg') {
      const blob = new Blob([xml], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `${fileBase}.svg`; a.click();
      URL.revokeObjectURL(url);
    } else {
      try {
        const dataUrl = await svgXmlToPngDataUrl(xml, chartWidth, totalHeight, 2);
        const a = document.createElement('a'); a.href = dataUrl; a.download = `${fileBase}.png`; a.click();
      } catch (err) {
        console.error('PNG export failed', err);
      }
    }
  };

  const renderDataTab = () => (
    <>
      <div className="form-group">
        <label>Table</label>
        <select value={tableIdx} onChange={e => { setTableIdx(+e.target.value); setXField(''); setYFields([]); }}>
          {tables.map((t, i) => <option key={t.id} value={i}>{t.name}</option>)}
        </select>
      </div>

      <div className="form-group">
        <label>Chart Type</label>
        <div className="chart-type-grid">
          {CHART_TYPES.map(ct => (
            <button key={ct.value} className={`chart-type-btn ${chartType === ct.value ? 'active' : ''}`}
              onClick={() => setChartType(ct.value)} title={ct.label}>
              <span className="chart-type-icon">{ct.icon}</span>
              <span>{ct.label}</span>
            </button>
          ))}
        </div>
      </div>

      {chartType !== 'scatter' && chartType !== 'heatmap' && chartType !== 'correlation' && (
        <>
          <div className="form-group">
            <label>X Axis / Labels</label>
            <select value={effectiveX} onChange={e => setXField(e.target.value)}>
              {headers.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>
              Y Axis / Values {effectiveY.length > 1 && `(${effectiveY.length})`}
              {numCols.length === 0 && <span style={{ color: '#fbbf24', fontWeight: 400, fontSize: 10, marginLeft: 4 }}>(no numeric cols detected)</span>}
            </label>
            <div style={{ maxHeight: 120, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 4, padding: 4 }}>
              {(numCols.length ? numCols : headers.slice(1)).map(h => (
                <label key={h} className="checkbox-label" style={{ fontSize: 11, padding: '2px 4px' }}>
                  <input type="checkbox" checked={effectiveY.includes(h)} onChange={() => toggleYField(h)} />
                  {h.length > 25 ? h.slice(0, 25) + '...' : h}
                </label>
              ))}
            </div>
          </div>
        </>
      )}
      {(chartType === 'heatmap' || chartType === 'correlation') && (
        <div className="form-group" style={{ fontSize: 11, color: 'var(--text-dim)', padding: 6, border: '1px dashed var(--border)', borderRadius: 4 }}>
          Uses the whole table as a matrix. First column = row labels; remaining columns = numeric cells.
          {chartType === 'correlation' && <div style={{ marginTop: 4 }}>Color scale fixed to −1 → +1 (red → green).</div>}
        </div>
      )}
    </>
  );

  const renderStyleTab = () => (
    <>
      <div className="form-group">
        <label>Color Palette</label>
        <div className="palette-grid">
          {PALETTES.map((p, i) => (
            <button key={i} className={`palette-btn ${palette === i ? 'active' : ''}`} onClick={() => setPalette(i)} title={p.name}>
              {p.colors.slice(0, 4).map((c, j) => <span key={j} style={{ background: c, width: 12, height: 12, borderRadius: 2, display: 'inline-block', marginRight: 1 }} />)}
              <span style={{ fontSize: 10, marginLeft: 6, color: 'var(--text-dim)' }}>{p.name}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="form-group">
        <label>Legend</label>
        <select value={showLegend} onChange={e => setShowLegend(e.target.value as LegendPos)}>
          <option value="right">Right</option>
          <option value="bottom">Bottom</option>
          <option value="top">Top</option>
          <option value="none">Hidden</option>
        </select>
      </div>

      <div className="form-group">
        <label>Bar / Slice Opacity</label>
        <input type="range" min={0.3} max={1} step={0.05} value={barOpacity}
          onChange={e => setBarOpacity(+e.target.value)} style={{ width: '100%' }} />
        <div style={{ fontSize: 10, color: 'var(--text-dim)', textAlign: 'right' }}>{Math.round(barOpacity * 100)}%</div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label className="checkbox-label"><input type="checkbox" checked={showGrid} onChange={e => setShowGrid(e.target.checked)} /> Grid lines</label>
        <label className="checkbox-label"
          title="Show the table's own cell value above each bar (multi-line like '7\n(88%)' is preserved)">
          <input type="checkbox" checked={showLabels} onChange={e => setShowLabels(e.target.checked)} /> Value labels (mirror table cells)
        </label>
        <label className="checkbox-label"
          title="When a cell shows 'value (pct%)', render value on line 1 and percent on line 2 above the bar">
          <input type="checkbox" checked={valueLabelSplit} disabled={!showLabels}
            onChange={e => setValueLabelSplit(e.target.checked)} /> Split value &amp; % on two lines
        </label>
        <label className="checkbox-label" title="Hide the data table and only show this chart in the workspace">
          <input type="checkbox" checked={chartOnly} onChange={e => setChartOnly(e.target.checked)} /> Show chart only (hide table)
        </label>
      </div>
    </>
  );

  const renderAxesTab = () => (
    <>
      <div className="form-group">
        <label>X Axis Label</label>
        <input type="text" value={xAxisLabel} onChange={e => setXAxisLabel(e.target.value)} placeholder="Auto" />
      </div>
      <div className="form-group">
        <label>Y Axis Label</label>
        <input type="text" value={yAxisLabel} onChange={e => setYAxisLabel(e.target.value)} placeholder="Auto" />
      </div>

      <div className="form-group" style={{ display: 'flex', gap: 6 }}>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 10 }}>X Label Angle</label>
          <select value={String(xLabelRotation)} onChange={e => setXLabelRotation(e.target.value === 'auto' ? 'auto' : Number(e.target.value))} style={{ fontSize: 11 }}>
            <option value="auto">Auto</option>
            <option value="0">0° (horizontal)</option>
            <option value="-30">-30°</option>
            <option value="-45">-45°</option>
            <option value="-60">-60°</option>
            <option value="-90">-90° (vertical)</option>
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 10 }}>Y Tick Angle</label>
          <select value={String(yLabelRotation)} onChange={e => setYLabelRotation(Number(e.target.value))} style={{ fontSize: 11 }}>
            <option value="0">0°</option>
            <option value="-30">-30°</option>
            <option value="-45">-45°</option>
            <option value="-90">-90°</option>
          </select>
        </div>
      </div>

      <div className="form-group" style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 10 }}>Tick Size</label>
          <input type="number" value={labelFontSize} min={7} max={16} onChange={e => setLabelFontSize(+e.target.value)} style={{ width: '100%' }} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 10 }}>Title Size</label>
          <input type="number" value={titleFontSize} min={10} max={24} onChange={e => setTitleFontSize(+e.target.value)} style={{ width: '100%' }} />
        </div>
      </div>
    </>
  );

  const renderSizeTab = () => (
    <>
      <div className="form-group">
        <label>Aspect Ratio</label>
        <select value={aspectPreset} onChange={e => setAspectPreset(e.target.value)}>
          {ASPECT_PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
        <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 3 }}>
          Auto: width fixed, height grows to keep tick labels legible. Use 16:9 / 4:3 for slides; 1:1 for square exports.
        </div>
      </div>

      <div className="form-group" style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 10 }}>Width (px)</label>
          <input type="number" min={320} max={2000} step={20} value={chartWidth}
            onChange={e => setChartWidth(Math.max(320, Math.min(2000, +e.target.value || 320)))} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 10 }}>Height (px)</label>
          <input type="number" min={200} max={1400} step={20} value={chartHeight}
            disabled={aspectPreset !== 'auto' && aspectPreset !== 'custom'}
            onChange={e => setChartHeight(Math.max(200, Math.min(1400, +e.target.value || 200)))} />
        </div>
      </div>

      <div className="form-group" style={{ display: 'flex', gap: 6 }}>
        <button className="btn-secondary" style={{ flex: 1, fontSize: 11 }} onClick={() => handleDownload('svg')}>↓ SVG</button>
        <button className="btn-secondary" style={{ flex: 1, fontSize: 11 }} onClick={() => handleDownload('png')}>↓ PNG</button>
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>
        PNG exports at 2× the chosen dimensions for crisp Word/PowerPoint embedding.
      </div>
    </>
  );

  // Auto height for "auto" preset: grow vertically when many x-labels or rotated labels need more room.
  const effectiveHeight = useMemo(() => {
    if (aspectPreset !== 'auto') return chartHeight;
    const n = rows.length;
    const rotation = typeof xLabelRotation === 'number'
      ? xLabelRotation
      : (n > 8 ? -35 : 0);
    const rotMag = Math.abs(rotation);
    const extra = rotMag >= 60 ? 60 : rotMag >= 30 ? 30 : 0;
    return Math.min(900, chartHeight + extra);
  }, [aspectPreset, chartHeight, rows.length, xLabelRotation]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal chart-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Chart Builder</h2>
          <button className="modal-close" onClick={saveAndClose} title="Save & Close">×</button>
        </div>
        <div className="chart-layout">
          {/* Controls sidebar with tabs */}
          <div className="chart-controls">
            <div className="chart-tabs" role="tablist">
              <button className={`chart-tab ${tab === 'data' ? 'active' : ''}`} onClick={() => setTab('data')}>Data</button>
              <button className={`chart-tab ${tab === 'style' ? 'active' : ''}`} onClick={() => setTab('style')}>Style</button>
              <button className={`chart-tab ${tab === 'axes' ? 'active' : ''}`} onClick={() => setTab('axes')}>Axes</button>
              <button className={`chart-tab ${tab === 'size' ? 'active' : ''}`} onClick={() => setTab('size')}>Size · Export</button>
            </div>
            <div className="chart-controls-body">
              {tab === 'data' && renderDataTab()}
              {tab === 'style' && renderStyleTab()}
              {tab === 'axes' && renderAxesTab()}
              {tab === 'size' && renderSizeTab()}
            </div>
          </div>

          {/* Chart canvas */}
          <div className="chart-canvas-wrap" style={{ flex: 1, overflow: 'auto' }}>
            <input
              className="chart-title-inline-input"
              style={{ fontSize: titleFontSize }}
              value={chartTitle}
              placeholder={autoFigTitle || 'Click to add chart title (used in Word export)'}
              onChange={e => setChartTitle(e.target.value)}
              title="Chart title — appears above the chart and in Word export. Defaults to the table's Fig title."
            />
            {!chartTitle && autoFigTitle && (
              <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: -4 }}>
                Defaulting to: <span style={{ color: '#60a5fa' }}>{autoFigTitle}</span>
              </div>
            )}
            <div className="chart-resize-frame" style={{ position: 'relative', width: chartWidth, maxWidth: '100%', margin: '0 auto' }}>
              <ChartCanvas ref={svgRef} result={result} config={buildConfig()}
                width={chartWidth} height={effectiveHeight}
                style={{ maxWidth: '100%', display: 'block' }} />
              <div
                className="chart-resize-handle"
                title="Drag to resize"
                onMouseDown={e => {
                  e.preventDefault();
                  dragRef.current = { startX: e.clientX, startY: e.clientY, startW: chartWidth, startH: chartHeight };
                  const preset = ASPECT_PRESETS.find(p => p.value === aspectPreset);
                  const lockedRatio = preset && preset.ratio ? preset.ratio : null;
                  const onMove = (ev: MouseEvent) => {
                    const d = dragRef.current; if (!d) return;
                    const dw = ev.clientX - d.startX;
                    const dh = ev.clientY - d.startY;
                    const newW = Math.max(320, Math.min(2000, d.startW + dw));
                    const newH = lockedRatio
                      ? Math.round(newW / lockedRatio)
                      : Math.max(200, Math.min(1400, d.startH + dh));
                    setChartWidth(newW);
                    setChartHeight(newH);
                  };
                  const onUp = () => {
                    dragRef.current = null;
                    window.removeEventListener('mousemove', onMove);
                    window.removeEventListener('mouseup', onUp);
                  };
                  window.addEventListener('mousemove', onMove);
                  window.addEventListener('mouseup', onUp);
                }}
              />
            </div>
            {result && (
              <div className="chart-meta">
                {rows.length} data points · {effectiveY.length} series · {effectiveX} vs {effectiveY.join(', ')}
                {' · '}<span>{chartWidth}×{effectiveHeight}px</span>
                {' · '}<span style={{ opacity: 0.7 }}>drag ↘ corner to resize</span>
              </div>
            )}
          </div>
        </div>

        {/* Sticky footer */}
        <div className="chart-modal-footer">
          <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            Title saves with the chart and is used as the figure caption on Word export.
          </div>
          <div className="footer-spacer" />
          <button className="btn-secondary" onClick={() => handleDownload('svg')} title="Download as SVG">↓ SVG</button>
          <button className="btn-secondary" onClick={() => handleDownload('png')} title="Download as PNG (2×)">↓ PNG</button>
          <button className="btn-primary" onClick={saveAndClose}>Save &amp; Close</button>
        </div>
      </div>
    </div>
  );
}
