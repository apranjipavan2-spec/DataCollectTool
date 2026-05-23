import React, { useState, useEffect, useMemo, useRef } from 'react';
import { TableResult, TableConfig } from '../types';
import { ChartCanvas, ChartCanvasConfig } from './ChartCanvas';
import { CHART_TYPES, PALETTES, ChartType, LegendPos, classifyColumns, W_DEFAULT, H_DEFAULT, figTitleFromTable } from './chartUtils';

interface Props {
  tables: TableConfig[];
  results: Map<string, TableResult>;
  onClose: () => void;
  onChartChange?: (tableId: string, chartConfig: any) => void;
  activeTableIdx?: number;
}

export function ChartBuilder({ tables, results, onClose, onChartChange, activeTableIdx }: Props) {
  const initialIdx = (typeof activeTableIdx === 'number' && activeTableIdx >= 0 && activeTableIdx < tables.length) ? activeTableIdx : 0;
  const [tableIdx, setTableIdx] = useState(initialIdx);
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
  const svgRef = useRef<SVGSVGElement>(null);

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
    } else {
      setChartType('bar'); setXField(''); setYFields([]);
      setPalette(0); setShowGrid(true); setShowLabels(false); setShowLegend('right');
      setChartTitle(''); setXAxisLabel(''); setYAxisLabel('');
      setLabelFontSize(10); setTitleFontSize(14); setBarOpacity(0.9);
      setChartOnly(false);
      setXLabelRotation('auto'); setYLabelRotation(0);
    }
  }, [table?.id]);

  const result: TableResult | null = (table ? results.get(table.id) : null) || null;
  const headers = result?.headers || [];
  const rows = useMemo(() => (result?.rows || []).filter(r => String(r[0]) !== 'Grand Total'), [result]);
  const { textCols, numCols } = useMemo(() => classifyColumns(headers, rows), [headers, rows]);

  const effectiveX = xField || textCols[0] || headers[0] || '';
  const effectiveY = yFields.length > 0 ? yFields : (numCols[0] ? [numCols[0]] : (headers[1] ? [headers[1]] : []));

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
      });
    }
    onClose();
  };

  const handleDownload = (format: 'svg' | 'png') => {
    if (!svgRef.current) return;
    const xml = new XMLSerializer().serializeToString(svgRef.current);
    if (format === 'svg') {
      const blob = new Blob([xml], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `chart_${table?.name || 'export'}.svg`; a.click();
      URL.revokeObjectURL(url);
    } else {
      const canvas = document.createElement('canvas');
      canvas.width = W_DEFAULT * 2; canvas.height = H_DEFAULT * 2;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const img = new Image();
      img.onload = () => {
        ctx.fillStyle = '#1a1d27'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(blob => {
          if (!blob) return;
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a'); a.href = url; a.download = `chart_${table?.name || 'export'}.png`; a.click();
          URL.revokeObjectURL(url);
        });
      };
      img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(xml)));
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal chart-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 980 }}>
        <div className="modal-header">
          <h2>Chart Builder</h2>
          <button className="modal-close" onClick={saveAndClose}>×</button>
        </div>
        <div className="chart-layout">
          {/* Controls sidebar */}
          <div className="chart-controls" style={{ minWidth: 220, maxWidth: 240 }}>
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
                  <div style={{ maxHeight: 100, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 4, padding: 4 }}>
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

            <div className="form-group">
              <label>Color Palette</label>
              <div className="palette-grid">
                {PALETTES.map((p, i) => (
                  <button key={i} className={`palette-btn ${palette === i ? 'active' : ''}`} onClick={() => setPalette(i)} title={p.name}>
                    {p.colors.slice(0, 4).map((c, j) => <span key={j} style={{ background: c, width: 12, height: 12, borderRadius: 2, display: 'inline-block', marginRight: 1 }} />)}
                  </button>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label>Chart Title</label>
              <input type="text" value={chartTitle} onChange={e => setChartTitle(e.target.value)} placeholder={autoFigTitle || 'Optional title'} />
              {!chartTitle && autoFigTitle && (
                <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 3 }}>
                  Defaulting to: <span style={{ color: '#60a5fa' }}>{autoFigTitle}</span>
                </div>
              )}
            </div>

            <div className="form-group" style={{ display: 'flex', gap: 6 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 10 }}>X Label</label>
                <input type="text" value={xAxisLabel} onChange={e => setXAxisLabel(e.target.value)} placeholder="Auto" style={{ fontSize: 11 }} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 10 }}>Y Label</label>
                <input type="text" value={yAxisLabel} onChange={e => setYAxisLabel(e.target.value)} placeholder="Auto" style={{ fontSize: 11 }} />
              </div>
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

            <div className="form-group">
              <label>Legend</label>
              <select value={showLegend} onChange={e => setShowLegend(e.target.value as LegendPos)}>
                <option value="right">Right</option>
                <option value="bottom">Bottom</option>
                <option value="top">Top</option>
                <option value="none">Hidden</option>
              </select>
            </div>

            <div className="form-group" style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 10 }}>Label Size</label>
                <input type="number" value={labelFontSize} min={7} max={16} onChange={e => setLabelFontSize(+e.target.value)} style={{ width: '100%' }} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 10 }}>Title Size</label>
                <input type="number" value={titleFontSize} min={10} max={24} onChange={e => setTitleFontSize(+e.target.value)} style={{ width: '100%' }} />
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label className="checkbox-label"><input type="checkbox" checked={showGrid} onChange={e => setShowGrid(e.target.checked)} /> Grid Lines</label>
              <label className="checkbox-label"><input type="checkbox" checked={showLabels} onChange={e => setShowLabels(e.target.checked)} /> Value Labels</label>
              <label className="checkbox-label" title="Hide the data table and only show this chart in the workspace">
                <input type="checkbox" checked={chartOnly} onChange={e => setChartOnly(e.target.checked)} /> Show chart only (hide table)
              </label>
            </div>

            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <button className="btn-secondary" style={{ flex: 1, fontSize: 11 }} onClick={() => handleDownload('svg')}>SVG</button>
              <button className="btn-secondary" style={{ flex: 1, fontSize: 11 }} onClick={() => handleDownload('png')}>PNG</button>
            </div>
            <button className="btn-primary" style={{ width: '100%', marginTop: 8, fontSize: 12 }} onClick={saveAndClose}>
              Save & Close
            </button>
          </div>

          {/* Chart canvas */}
          <div className="chart-canvas-wrap" style={{ flex: 1 }}>
            {effectiveTitle && <div className="chart-title-display" style={{ fontSize: titleFontSize }}>{effectiveTitle}</div>}
            <ChartCanvas ref={svgRef} result={result} config={buildConfig()} width={W_DEFAULT} height={H_DEFAULT} />
            {result && (
              <div className="chart-meta">
                {rows.length} data points · {effectiveY.length} series · {effectiveX} vs {effectiveY.join(', ')}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
