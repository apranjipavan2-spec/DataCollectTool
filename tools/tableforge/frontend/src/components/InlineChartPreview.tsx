import React, { useRef, useState, useEffect } from 'react';
import { TableResult, TableConfig } from '../types';
import { ChartCanvas, ChartCanvasConfig } from './ChartCanvas';
import {
  LegendPos, W_DEFAULT, H_DEFAULT, figTitleFromTable,
  buildChartExportSvg, svgXmlToPngDataUrl,
} from './chartUtils';

interface Props {
  table: TableConfig;
  result: TableResult | null;
  onEdit: () => void;
  onRemove: () => void;
  onToggleChartOnly: () => void;
}

export function InlineChartPreview({ table, result, onEdit, onRemove, onToggleChartOnly }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [boxW, setBoxW] = useState<number>(W_DEFAULT);
  const cc = table.chartConfig;

  // Measure container width and resize chart logically (so labels/spacing scale, not just visually stretch).
  useEffect(() => {
    if (!boxRef.current) return;
    const el = boxRef.current;
    const update = () => {
      const w = el.clientWidth;
      if (w > 0) setBoxW(Math.max(420, Math.min(1600, w - 20)));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (!cc) return null;

  const config: ChartCanvasConfig = {
    type: (cc.type as any) || 'bar',
    xField: cc.xField || '',
    yFields: cc.yFields || [],
    paletteName: cc.palette,
    showGrid: cc.showGrid !== false,
    showLabels: !!cc.showLabels,
    showLegend: (cc.showLegend as unknown as LegendPos) || 'right',
    xAxisLabel: cc.xAxisLabel,
    yAxisLabel: cc.yAxisLabel,
    labelFontSize: cc.labelFontSize || 10,
    barOpacity: cc.barOpacity ?? 0.9,
    xLabelRotation: cc.xLabelRotation,
    yLabelRotation: cc.yLabelRotation,
  };

  const chartOnly = !!cc.chart_only;
  const savedTitle = (cc.chartTitle as string | undefined) || '';
  const title = savedTitle.trim() || figTitleFromTable(table);
  const titleFontSize = (cc.titleFontSize as number | undefined) || 14;
  // Scale chart height proportionally with width so wider screens get taller chart area.
  const chartH = Math.max(H_DEFAULT, Math.round(boxW * (H_DEFAULT / W_DEFAULT)));

  const askIncludeTitle = (): boolean => {
    if (!title) return false;
    return window.confirm('Include chart title in the downloaded image?\n\nOK = with title, Cancel = without.');
  };

  const downloadSvg = () => {
    if (!svgRef.current) return;
    const includeTitle = askIncludeTitle();
    const { xml } = buildChartExportSvg({
      svgElement: svgRef.current,
      title: includeTitle ? title : '',
      titleFontSize,
      width: boxW,
      height: chartH,
    });
    const blob = new Blob([xml], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `chart_${table.name}.svg`; a.click();
    URL.revokeObjectURL(url);
  };

  const downloadPng = async () => {
    if (!svgRef.current) return;
    const includeTitle = askIncludeTitle();
    const { xml, totalHeight } = buildChartExportSvg({
      svgElement: svgRef.current,
      title: includeTitle ? title : '',
      titleFontSize,
      width: boxW,
      height: chartH,
    });
    try {
      const dataUrl = await svgXmlToPngDataUrl(xml, boxW, totalHeight, 2);
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `chart_${table.name}.png`;
      a.click();
    } catch (err) {
      console.error('PNG export failed', err);
      window.alert('Could not export PNG. Try SVG instead.');
    }
  };

  return (
    <div style={{
      margin: '8px 12px 12px',
      background: 'rgba(59,130,246,0.04)',
      border: '1px solid rgba(59,130,246,0.25)',
      borderRadius: 8,
      overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '6px 12px',
        borderBottom: '1px solid rgba(59,130,246,0.15)',
        background: 'rgba(59,130,246,0.06)',
        gap: 8,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1, overflow: 'hidden' }}>
          <span style={{ fontSize: 13, flexShrink: 0 }}>📊</span>
          <span style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, flexShrink: 0 }}>
            Chart{chartOnly ? ' (table hidden)' : ''}
          </span>
          {title && (
            <span style={{ fontSize: 12, color: 'var(--text)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
              · {title}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 4, overflowX: 'auto', flexShrink: 0, maxWidth: '60%' }}>
          <button onClick={onToggleChartOnly} title={chartOnly ? 'Show table again' : 'Hide table, keep only chart'}
            style={btnStyle()}>
            {chartOnly ? '🗂 Show table' : '🙈 Hide table'}
          </button>
          <button onClick={onEdit} title="Open Chart Builder" style={btnStyle()}>✏️ Edit</button>
          <button onClick={downloadSvg} title="Download SVG (asks: with or without title)" style={btnStyle()}>SVG</button>
          <button onClick={downloadPng} title="Download PNG (asks: with or without title)" style={btnStyle()}>PNG</button>
          <button onClick={onRemove} title="Remove chart from this table"
            style={{ ...btnStyle(), color: '#fca5a5' }}>×</button>
        </div>
      </div>

      <div ref={boxRef} style={{ padding: 10, width: '100%', boxSizing: 'border-box' }}>
        {title && (
          <div className="chart-title-display" style={{
            fontSize: titleFontSize, textAlign: 'center', marginBottom: 8,
            color: 'var(--text)', fontWeight: 600, width: '100%',
          }}>
            {title}
          </div>
        )}
        <div style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
          <ChartCanvas ref={svgRef} result={result} config={config} width={boxW} height={chartH}
            style={{ width: '100%', maxWidth: '100%' }} />
        </div>
      </div>
    </div>
  );
}

function btnStyle(): React.CSSProperties {
  return {
    background: 'rgba(0,0,0,0.25)',
    border: '1px solid rgba(255,255,255,0.08)',
    color: 'var(--text)',
    cursor: 'pointer',
    fontSize: 11,
    padding: '3px 8px',
    borderRadius: 4,
    flexShrink: 0,
    whiteSpace: 'nowrap',
  };
}
