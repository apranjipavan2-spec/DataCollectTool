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

type Tab = 'data' | 'style' | 'axes' | 'colors' | 'advanced' | 'size';
const ASPECT_PRESETS: { value: string; label: string; ratio: number | null }[] = [
  { value: 'auto',  label: 'Auto (fit text)', ratio: null },
  { value: '16:9',  label: '16 : 9 (wide)',   ratio: 16 / 9 },
  { value: '4:3',   label: '4 : 3 (slide)',   ratio: 4 / 3 },
  { value: '3:2',   label: '3 : 2',           ratio: 3 / 2 },
  { value: '1:1',   label: '1 : 1 (square)',  ratio: 1 },
  { value: 'custom', label: 'Custom',         ratio: null },
];

// Font family options — value is the CSS font-family stack so the SVG renders
// it correctly both in-app and after rasterization for Word/PNG.
const FONT_FAMILIES: { label: string; value: string }[] = [
  { label: 'Default (inherit)',  value: '' },
  { label: 'Arial',              value: 'Arial, sans-serif' },
  { label: 'Helvetica',          value: 'Helvetica, Arial, sans-serif' },
  { label: 'Inter',              value: 'Inter, system-ui, sans-serif' },
  { label: 'Segoe UI',           value: '"Segoe UI", Tahoma, sans-serif' },
  { label: 'Verdana',            value: 'Verdana, Geneva, sans-serif' },
  { label: 'Tahoma',             value: 'Tahoma, sans-serif' },
  { label: 'Trebuchet MS',       value: '"Trebuchet MS", sans-serif' },
  { label: 'Georgia (serif)',    value: 'Georgia, serif' },
  { label: 'Times New Roman',    value: '"Times New Roman", Times, serif' },
  { label: 'Cambria (serif)',    value: 'Cambria, Georgia, serif' },
  { label: 'Courier New (mono)', value: '"Courier New", Courier, monospace' },
];

// Style preset persistence — list of named style snapshots stored in localStorage.
// Each preset captures palette, font, all colors, sizes, opacity — the visual
// settings only. Data + axes + size are NOT part of a preset so the same preset
// can be re-applied across different tables/charts.
const PRESET_KEY = 'tableforge_chart_presets';
interface ChartStylePreset {
  paletteName: string;
  fontFamily: string;
  axisColor: string;
  gridColor: string;
  tickColor: string;
  axisLabelColor: string;
  dataLabelColor: string;
  titleColor: string;
  singleColor: string;
  labelFontSize: number;
  titleFontSize: number;
  barOpacity: number;
  showGrid: boolean;
  showLabels: boolean;
  showLegend: LegendPos;
}
function loadPresets(): Record<string, ChartStylePreset> {
  try {
    const raw = localStorage.getItem(PRESET_KEY);
    if (!raw) return {};
    const p = JSON.parse(raw);
    return (p && typeof p === 'object') ? p : {};
  } catch { return {}; }
}
function savePresets(p: Record<string, ChartStylePreset>) {
  try { localStorage.setItem(PRESET_KEY, JSON.stringify(p)); } catch { /* quota or disabled */ }
}

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
  // ─── Color & font customisation ──────────────────────────────────────────
  const [fontFamily, setFontFamily] = useState<string>('');
  const [axisColor, setAxisColor] = useState<string>('#374151');
  const [gridColor, setGridColor] = useState<string>('rgba(255,255,255,0.05)');
  const [tickColor, setTickColor] = useState<string>('#9ca3af');
  const [axisLabelColor, setAxisLabelColor] = useState<string>('#e4e4e7');
  const [dataLabelColor, setDataLabelColor] = useState<string>('');  // blank = use series color
  const [titleColor, setTitleColor] = useState<string>('');          // blank = default fill
  const [singleColor, setSingleColor] = useState<string>('');        // blank = use palette
  const [seriesColors, setSeriesColors] = useState<Record<number, string>>({});
  const [presets, setPresets] = useState<Record<string, ChartStylePreset>>(() => loadPresets());
  const [presetName, setPresetName] = useState<string>('');
  // ─── Advanced chart options (title align/bold/italic, ref line, sort/topN,
  // stacked100, label position, trendline, hatch fills, conditional bars, light mode) ─
  const [titleAlign, setTitleAlign] = useState<'left' | 'center' | 'right'>('center');
  const [titleBold, setTitleBold] = useState<boolean>(true);
  const [titleItalic, setTitleItalic] = useState<boolean>(false);
  const [refLineValue, setRefLineValue] = useState<string>('');
  const [refLineLabel, setRefLineLabel] = useState<string>('');
  const [refLineColor, setRefLineColor] = useState<string>('#f97316');
  const [categorySort, setCategorySort] = useState<'none' | 'asc' | 'desc'>('none');
  const [topN, setTopN] = useState<number>(0);
  const [topNOther, setTopNOther] = useState<boolean>(false);
  const [stacked100, setStacked100] = useState<boolean>(false);
  const [labelPosition, setLabelPosition] = useState<'inside' | 'outside'>('outside');
  const [trendline, setTrendline] = useState<boolean>(false);
  const [patternFills, setPatternFills] = useState<boolean>(false);
  const [condEnabled, setCondEnabled] = useState<boolean>(false);
  const [condThreshold, setCondThreshold] = useState<number>(0);
  const [condBelow, setCondBelow] = useState<string>('#ef4444');
  const [condAbove, setCondAbove] = useState<string>('#10b981');
  const [lightMode, setLightMode] = useState<boolean>(false);
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
      setFontFamily(typeof cc.fontFamily === 'string' ? cc.fontFamily : '');
      setAxisColor(typeof cc.axisColor === 'string' ? cc.axisColor : '#374151');
      setGridColor(typeof cc.gridColor === 'string' ? cc.gridColor : 'rgba(255,255,255,0.05)');
      setTickColor(typeof cc.tickColor === 'string' ? cc.tickColor : '#9ca3af');
      setAxisLabelColor(typeof cc.axisLabelColor === 'string' ? cc.axisLabelColor : '#e4e4e7');
      setDataLabelColor(typeof cc.dataLabelColor === 'string' ? cc.dataLabelColor : '');
      setTitleColor(typeof cc.titleColor === 'string' ? cc.titleColor : '');
      setSingleColor(typeof cc.singleColor === 'string' ? cc.singleColor : '');
      setSeriesColors(cc.seriesColors && typeof cc.seriesColors === 'object' ? cc.seriesColors : {});
      setTitleAlign((cc.titleAlign as any) || 'center');
      setTitleBold(cc.titleBold !== false);
      setTitleItalic(!!cc.titleItalic);
      const rl = Array.isArray(cc.referenceLines) && cc.referenceLines[0];
      setRefLineValue(rl && isFinite(rl.value) ? String(rl.value) : '');
      setRefLineLabel(rl?.label || '');
      setRefLineColor(rl?.color || '#f97316');
      setCategorySort((cc.categorySort as any) || 'none');
      setTopN(typeof cc.topN === 'number' ? cc.topN : 0);
      setTopNOther(!!cc.topNOther);
      setStacked100(!!cc.stacked100);
      setLabelPosition((cc.labelPosition as any) || 'outside');
      setTrendline(!!cc.trendline);
      setPatternFills(!!cc.patternFills);
      const cc2 = cc.conditionalColor;
      setCondEnabled(!!cc2);
      setCondThreshold(cc2 && isFinite(cc2.threshold) ? cc2.threshold : 0);
      setCondBelow(cc2?.below || '#ef4444');
      setCondAbove(cc2?.above || '#10b981');
      setLightMode(!!cc.lightMode);
    } else {
      setChartType('bar'); setXField(''); setYFields([]);
      setPalette(0); setShowGrid(true); setShowLabels(false); setShowLegend('right');
      setChartTitle(''); setXAxisLabel(''); setYAxisLabel('');
      setLabelFontSize(10); setTitleFontSize(14); setBarOpacity(0.9);
      setChartOnly(false);
      setXLabelRotation('auto'); setYLabelRotation(0);
      setChartWidth(W_DEFAULT); setChartHeight(H_DEFAULT); setAspectPreset('auto');
      setValueLabelSplit(false);
      setFontFamily(''); setAxisColor('#374151'); setGridColor('rgba(255,255,255,0.05)');
      setTickColor('#9ca3af'); setAxisLabelColor('#e4e4e7');
      setDataLabelColor(''); setTitleColor(''); setSingleColor(''); setSeriesColors({});
      setTitleAlign('center'); setTitleBold(true); setTitleItalic(false);
      setRefLineValue(''); setRefLineLabel(''); setRefLineColor('#f97316');
      setCategorySort('none'); setTopN(0); setTopNOther(false);
      setStacked100(false); setLabelPosition('outside');
      setTrendline(false); setPatternFills(false);
      setCondEnabled(false); setCondThreshold(0); setCondBelow('#ef4444'); setCondAbove('#10b981');
      setLightMode(false);
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

  const refLineParsed = (() => {
    const v = parseFloat(refLineValue);
    if (!isFinite(v)) return [];
    return [{ value: v, label: refLineLabel || undefined, color: refLineColor }];
  })();

  const buildConfig = (): ChartCanvasConfig => ({
    type: chartType,
    xField: effectiveX,
    yFields: effectiveY,
    paletteName: PALETTES[palette]?.name,
    showGrid, showLabels, showLegend,
    xAxisLabel, yAxisLabel, labelFontSize, barOpacity,
    xLabelRotation, yLabelRotation,
    valueLabelSplit,
    fontFamily: fontFamily || undefined,
    axisColor, gridColor,
    tickColor, axisLabelColor,
    dataLabelColor: dataLabelColor || undefined,
    singleColor: singleColor || undefined,
    seriesColors,
    referenceLines: refLineParsed,
    categorySort,
    topN: topN > 0 ? topN : undefined,
    topNOther,
    stacked100,
    labelPosition,
    trendline,
    patternFills,
    conditionalColor: condEnabled
      ? { threshold: condThreshold, below: condBelow, above: condAbove }
      : undefined,
    lightMode,
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
        fontFamily, axisColor, gridColor,
        tickColor, axisLabelColor, dataLabelColor, titleColor,
        singleColor, seriesColors,
        titleAlign, titleBold, titleItalic,
        referenceLines: refLineParsed,
        categorySort,
        topN: topN > 0 ? topN : undefined,
        topNOther,
        stacked100,
        labelPosition,
        trendline,
        patternFills,
        conditionalColor: condEnabled
          ? { threshold: condThreshold, below: condBelow, above: condAbove }
          : undefined,
        lightMode,
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
      titleColor: titleColor || undefined,
      fontFamily: fontFamily || undefined,
      titleAlign, titleBold, titleItalic,
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
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <label style={{ margin: 0 }}>
                Y Axis / Values {effectiveY.length > 1 && `(${effectiveY.length})`}
                {numCols.length === 0 && <span style={{ color: '#fbbf24', fontWeight: 400, fontSize: 10, marginLeft: 4 }}>(no numeric cols detected)</span>}
              </label>
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  type="button"
                  title="Select all numeric columns (multi-series grouped bars)"
                  onClick={() => {
                    const pool = numCols.length ? numCols : headers.slice(1);
                    const nonTotal = pool.filter(c => !/\btotal\b/i.test(c) && !/grand\s*total/i.test(c));
                    setYFields(nonTotal.length > 0 ? nonTotal : pool);
                  }}
                  style={{
                    fontSize: 10, padding: '2px 8px', borderRadius: 4,
                    background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.4)',
                    color: '#93c5fd', cursor: 'pointer',
                  }}
                >Select all (multi-series)</button>
                {effectiveY.length > 1 && (
                  <button
                    type="button"
                    title="Clear Y selection"
                    onClick={() => setYFields([])}
                    style={{
                      fontSize: 10, padding: '2px 8px', borderRadius: 4,
                      background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)',
                      color: 'var(--text-dim)', cursor: 'pointer',
                    }}
                  >Clear</button>
                )}
              </div>
            </div>
            <div style={{ maxHeight: 120, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 4, padding: 4 }}>
              {(numCols.length ? numCols : headers.slice(1)).map(h => (
                <label key={h} className="checkbox-label" style={{ fontSize: 11, padding: '2px 4px' }}>
                  <input type="checkbox" checked={effectiveY.includes(h)} onChange={() => toggleYField(h)} />
                  {h.length > 25 ? h.slice(0, 25) + '...' : h}
                </label>
              ))}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4 }}>
              Tip: tick multiple columns (e.g. Beneficiary <em>and</em> Non-Beneficiary) to render side-by-side grouped bars with a legend.
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
          <option value="left">Left</option>
          <option value="top">Top</option>
          <option value="bottom">Bottom</option>
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

  // ─── Preset application + persistence ──────────────────────────────────
  const applyPreset = (name: string) => {
    const p = presets[name];
    if (!p) return;
    const idx = PALETTES.findIndex(pp => pp.name === p.paletteName);
    if (idx >= 0) setPalette(idx);
    setFontFamily(p.fontFamily || '');
    setAxisColor(p.axisColor || '#374151');
    setGridColor(p.gridColor || 'rgba(255,255,255,0.05)');
    setTickColor(p.tickColor || '#9ca3af');
    setAxisLabelColor(p.axisLabelColor || '#e4e4e7');
    setDataLabelColor(p.dataLabelColor || '');
    setTitleColor(p.titleColor || '');
    setSingleColor(p.singleColor || '');
    setLabelFontSize(p.labelFontSize || 10);
    setTitleFontSize(p.titleFontSize || 14);
    setBarOpacity(typeof p.barOpacity === 'number' ? p.barOpacity : 0.9);
    setShowGrid(!!p.showGrid);
    setShowLabels(!!p.showLabels);
    setShowLegend((p.showLegend as LegendPos) || 'right');
  };
  const saveCurrentAsPreset = () => {
    const n = presetName.trim();
    if (!n) return;
    const next: Record<string, ChartStylePreset> = {
      ...presets,
      [n]: {
        paletteName: PALETTES[palette]?.name || 'Blueprint',
        fontFamily, axisColor, gridColor, tickColor, axisLabelColor,
        dataLabelColor, titleColor, singleColor,
        labelFontSize, titleFontSize, barOpacity,
        showGrid, showLabels, showLegend,
      },
    };
    setPresets(next);
    savePresets(next);
  };
  const deletePreset = (name: string) => {
    if (!presets[name]) return;
    const next = { ...presets };
    delete next[name];
    setPresets(next);
    savePresets(next);
  };

  // Series-color editor: the indices here track whatever the chart iterates by
  // (categories for single-series bar/pie, series for stacked/grouped/line),
  // so we surface the matching labels for the user.
  const seriesEditorLabels = useMemo<string[]>(() => {
    const multiSeries = effectiveY.length > 1
      && ['stacked', 'grouped', 'line', 'area', 'combo'].includes(chartType);
    if (multiSeries) return effectiveY.slice();
    return rows.map(r => String(r[0] ?? '')).slice(0, 20);
  }, [effectiveY, chartType, rows]);

  const paletteColors = PALETTES[palette]?.colors || PALETTES[0].colors;
  const setSeriesColor = (i: number, c: string) => {
    setSeriesColors(prev => {
      const next = { ...prev };
      if (!c) delete next[i]; else next[i] = c;
      return next;
    });
  };
  const clearSeriesColors = () => setSeriesColors({});

  const renderColorsTab = () => (
    <>
      <div className="form-group">
        <label>Font family (charts & figures)</label>
        <select value={fontFamily} onChange={e => setFontFamily(e.target.value)}>
          {FONT_FAMILIES.map(f => <option key={f.label} value={f.value}>{f.label}</option>)}
        </select>
      </div>

      <div className="form-group">
        <label style={{ display: 'block', marginBottom: 4 }}>Title (export) color</label>
        <input type="color" value={titleColor || '#1f2937'} onChange={e => setTitleColor(e.target.value)} style={{ width: 60, height: 28, padding: 0, border: '1px solid var(--border)', borderRadius: 4 }} />
        {titleColor && <button className="btn-small" style={{ marginLeft: 8, fontSize: 10 }} onClick={() => setTitleColor('')}>Reset</button>}
      </div>

      <div className="form-group" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <label style={{ fontSize: 11 }}>Axis lines
          <input type="color" value={axisColor} onChange={e => setAxisColor(e.target.value)} style={{ display: 'block', width: '100%', height: 26, padding: 0, marginTop: 2 }} />
        </label>
        <label style={{ fontSize: 11 }}>Grid lines
          <input type="color" value={gridColor.startsWith('rgba') ? '#1f2937' : gridColor} onChange={e => setGridColor(e.target.value)} style={{ display: 'block', width: '100%', height: 26, padding: 0, marginTop: 2 }} />
        </label>
        <label style={{ fontSize: 11 }}>Tick & legend text
          <input type="color" value={tickColor} onChange={e => setTickColor(e.target.value)} style={{ display: 'block', width: '100%', height: 26, padding: 0, marginTop: 2 }} />
        </label>
        <label style={{ fontSize: 11 }}>Axis captions
          <input type="color" value={axisLabelColor} onChange={e => setAxisLabelColor(e.target.value)} style={{ display: 'block', width: '100%', height: 26, padding: 0, marginTop: 2 }} />
        </label>
        <label style={{ fontSize: 11 }}>Value labels (override)
          <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
            <input type="color" value={dataLabelColor || '#ffffff'} onChange={e => setDataLabelColor(e.target.value)} style={{ flex: 1, height: 26, padding: 0 }} />
            {dataLabelColor && <button className="btn-small" style={{ fontSize: 10 }} onClick={() => setDataLabelColor('')} title="Use bar/series color">×</button>}
          </div>
          <span style={{ fontSize: 9, color: 'var(--text-dim)' }}>{dataLabelColor ? 'Custom' : 'Uses series colour'}</span>
        </label>
        <label style={{ fontSize: 11 }}>Single bar colour
          <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
            <input type="color" value={singleColor || '#3b82f6'} onChange={e => setSingleColor(e.target.value)} style={{ flex: 1, height: 26, padding: 0 }} />
            {singleColor && <button className="btn-small" style={{ fontSize: 10 }} onClick={() => setSingleColor('')} title="Use palette">×</button>}
          </div>
          <span style={{ fontSize: 9, color: 'var(--text-dim)' }}>{singleColor ? 'All bars one color' : 'Uses palette'}</span>
        </label>
      </div>

      <div className="form-group">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <label style={{ margin: 0 }}>
            {effectiveY.length > 1 && ['stacked','grouped','line','area','combo'].includes(chartType)
              ? 'Per-series colour (by legend)'
              : 'Per-category colour'}
          </label>
          {Object.keys(seriesColors).length > 0 && (
            <button className="btn-small" style={{ fontSize: 10 }} onClick={clearSeriesColors}>Clear all</button>
          )}
        </div>
        <div style={{ maxHeight: 140, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 4, padding: 4, marginTop: 4 }}>
          {seriesEditorLabels.length === 0 && (
            <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>No data series yet — pick X / Y on the Data tab.</div>
          )}
          {seriesEditorLabels.map((name, i) => {
            const fallback = paletteColors[i % paletteColors.length];
            const cur = seriesColors[i] || singleColor || fallback;
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0', fontSize: 11 }}>
                <input type="color" value={cur} onChange={e => setSeriesColor(i, e.target.value)} style={{ width: 28, height: 20, padding: 0, border: '1px solid var(--border)' }} />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={name}>{name || `Item ${i + 1}`}</span>
                {seriesColors[i] && (
                  <button className="btn-small" style={{ fontSize: 10, padding: '0 6px' }} onClick={() => setSeriesColor(i, '')} title="Reset to palette/single">↺</button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="form-group" style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
        <label style={{ fontSize: 11, fontWeight: 600 }}>Style presets</label>
        <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
          <select value="" onChange={e => { if (e.target.value) applyPreset(e.target.value); }} style={{ flex: 1, fontSize: 11 }}>
            <option value="">— Load preset —</option>
            {Object.keys(presets).sort().map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
          <input type="text" value={presetName} onChange={e => setPresetName(e.target.value)}
            placeholder="Preset name" style={{ flex: 1, fontSize: 11, padding: '4px 6px' }} />
          <button className="btn-small btn-primary" style={{ fontSize: 11 }}
            disabled={!presetName.trim()} onClick={saveCurrentAsPreset}>Save</button>
        </div>
        {Object.keys(presets).length > 0 && (
          <div style={{ marginTop: 6, maxHeight: 100, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 4, padding: 4 }}>
            {Object.keys(presets).sort().map(n => (
              <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0', fontSize: 11 }}>
                <button className="btn-small" style={{ fontSize: 10, padding: '1px 8px' }} onClick={() => applyPreset(n)}>Apply</button>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={n}>{n}</span>
                <button className="btn-small" style={{ fontSize: 10, padding: '1px 6px', color: '#ef4444' }}
                  onClick={() => deletePreset(n)} title="Delete preset">×</button>
              </div>
            ))}
          </div>
        )}
        <div style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 4 }}>
          Presets save palette + colour overrides + fonts + sizes. Stored in this browser only.
        </div>
      </div>
    </>
  );

  const renderAdvancedTab = () => (
    <>
      <div className="form-group">
        <label style={{ fontSize: 11, fontWeight: 600 }}>Title style</label>
        <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
          <select value={titleAlign} onChange={e => setTitleAlign(e.target.value as any)} style={{ flex: 1, fontSize: 11 }}>
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </select>
          <label className="checkbox-label" style={{ fontSize: 11 }}><input type="checkbox" checked={titleBold} onChange={e => setTitleBold(e.target.checked)} /> Bold</label>
          <label className="checkbox-label" style={{ fontSize: 11 }}><input type="checkbox" checked={titleItalic} onChange={e => setTitleItalic(e.target.checked)} /> Italic</label>
        </div>
      </div>

      <div className="form-group">
        <label style={{ fontSize: 11, fontWeight: 600 }}>Reference / target line</label>
        <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
          <input type="number" value={refLineValue} onChange={e => setRefLineValue(e.target.value)}
            placeholder="value" style={{ flex: 1, fontSize: 11 }} />
          <input type="text" value={refLineLabel} onChange={e => setRefLineLabel(e.target.value)}
            placeholder="label (e.g. 80% target)" style={{ flex: 2, fontSize: 11 }} />
          <input type="color" value={refLineColor} onChange={e => setRefLineColor(e.target.value)}
            style={{ width: 32, height: 24, padding: 0 }} />
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>Leave value empty to hide the line.</div>
      </div>

      <div className="form-group" style={{ display: 'flex', gap: 6 }}>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 11 }}>Sort categories</label>
          <select value={categorySort} onChange={e => setCategorySort(e.target.value as any)} style={{ width: '100%', fontSize: 11 }}>
            <option value="none">Original order</option>
            <option value="desc">By value (high → low)</option>
            <option value="asc">By value (low → high)</option>
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 11 }}>Top N</label>
          <input type="number" min={0} max={50} value={topN}
            onChange={e => setTopN(Math.max(0, Math.min(50, +e.target.value || 0)))}
            placeholder="0 = all" style={{ width: '100%', fontSize: 11 }} />
        </div>
      </div>
      <label className="checkbox-label" style={{ fontSize: 11 }}>
        <input type="checkbox" checked={topNOther} onChange={e => setTopNOther(e.target.checked)} disabled={topN <= 0} />
        Roll remaining into "Other" bucket
      </label>

      <div className="form-group" style={{ borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 8 }}>
        <label className="checkbox-label" style={{ fontSize: 11 }}>
          <input type="checkbox" checked={stacked100} onChange={e => setStacked100(e.target.checked)} />
          Stacked 100% (normalised — only applies to Stacked chart)
        </label>
      </div>

      <div className="form-group" style={{ display: 'flex', gap: 6 }}>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 11 }}>Data label position</label>
          <select value={labelPosition} onChange={e => setLabelPosition(e.target.value as any)} style={{ width: '100%', fontSize: 11 }}>
            <option value="outside">Outside bar (above)</option>
            <option value="inside">Inside bar</option>
          </select>
        </div>
      </div>

      <label className="checkbox-label" style={{ fontSize: 11 }}>
        <input type="checkbox" checked={trendline} onChange={e => setTrendline(e.target.checked)} />
        Trendline / linear regression (scatter only)
      </label>

      <label className="checkbox-label" style={{ fontSize: 11 }}>
        <input type="checkbox" checked={patternFills} onChange={e => setPatternFills(e.target.checked)} />
        Hatch / pattern fills (B&W print-safe)
      </label>

      <div className="form-group" style={{ borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 8 }}>
        <label className="checkbox-label" style={{ fontSize: 11 }}>
          <input type="checkbox" checked={condEnabled} onChange={e => setCondEnabled(e.target.checked)} />
          Colour bars by value (threshold)
        </label>
        {condEnabled && (
          <div style={{ display: 'flex', gap: 4, marginTop: 4, alignItems: 'center' }}>
            <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>If &lt;</span>
            <input type="number" value={condThreshold} onChange={e => setCondThreshold(+e.target.value || 0)}
              style={{ width: 60, fontSize: 11 }} />
            <input type="color" value={condBelow} onChange={e => setCondBelow(e.target.value)}
              style={{ width: 28, height: 22, padding: 0 }} title="Below threshold" />
            <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>else</span>
            <input type="color" value={condAbove} onChange={e => setCondAbove(e.target.value)}
              style={{ width: 28, height: 22, padding: 0 }} title="At/above threshold" />
          </div>
        )}
      </div>

      <label className="checkbox-label" style={{ fontSize: 11 }}>
        <input type="checkbox" checked={lightMode} onChange={e => setLightMode(e.target.checked)} />
        Light-mode preview (white background, dark text — for printed reports)
      </label>

      <div className="form-group" style={{ borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 8 }}>
        <button className="btn-small" style={{ fontSize: 11, width: '100%' }}
          onClick={() => {
            if (!onChartChange) return;
            const styleSubset = {
              palette: PALETTES[palette]?.name,
              fontFamily, axisColor, gridColor, tickColor, axisLabelColor,
              dataLabelColor, titleColor, singleColor,
              labelFontSize, titleFontSize, barOpacity,
              showGrid, showLabels, showLegend,
              titleAlign, titleBold, titleItalic,
              patternFills, lightMode, labelPosition,
            };
            tables.forEach(t => {
              if (t.id === table?.id) return;
              if (!t.chartConfig) return;
              onChartChange(t.id, { ...t.chartConfig, ...styleSubset });
            });
            window.alert('Style applied to all charts with a chart configured.');
          }}>
          Apply this style to all charts
        </button>
        <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4 }}>
          Copies fonts, palette, colours, legend/grid, label sizes — leaves Data/Axes alone.
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
              <button className={`chart-tab ${tab === 'colors' ? 'active' : ''}`} onClick={() => setTab('colors')}>Colors · Fonts</button>
              <button className={`chart-tab ${tab === 'advanced' ? 'active' : ''}`} onClick={() => setTab('advanced')}>Advanced</button>
              <button className={`chart-tab ${tab === 'size' ? 'active' : ''}`} onClick={() => setTab('size')}>Size · Export</button>
            </div>
            <div className="chart-controls-body">
              {tab === 'data' && renderDataTab()}
              {tab === 'style' && renderStyleTab()}
              {tab === 'axes' && renderAxesTab()}
              {tab === 'colors' && renderColorsTab()}
              {tab === 'advanced' && renderAdvancedTab()}
              {tab === 'size' && renderSizeTab()}
            </div>
          </div>

          {/* Chart canvas */}
          <div className="chart-canvas-wrap" style={{ flex: 1, overflow: 'auto' }}>
            <input
              className="chart-title-inline-input"
              style={{
                fontSize: titleFontSize,
                textAlign: titleAlign,
                fontWeight: titleBold ? 700 : 400,
                fontStyle: titleItalic ? 'italic' : 'normal',
                color: titleColor || undefined,
                fontFamily: fontFamily || undefined,
              }}
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
