import React, { useRef } from 'react';
import { TableResult, TableConfig } from '../types';
import { ChartCanvas, ChartCanvasConfig } from './ChartCanvas';
import { LegendPos, W_DEFAULT, H_DEFAULT, figTitleFromTable } from './chartUtils';

interface Props {
  table: TableConfig;
  result: TableResult | null;
  onEdit: () => void;
  onRemove: () => void;
  onToggleChartOnly: () => void;
}

export function InlineChartPreview({ table, result, onEdit, onRemove, onToggleChartOnly }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const cc = table.chartConfig;
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

  const downloadSvg = () => {
    if (!svgRef.current) return;
    const xml = new XMLSerializer().serializeToString(svgRef.current);
    const blob = new Blob([xml], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `chart_${table.name}.svg`; a.click();
    URL.revokeObjectURL(url);
  };

  const downloadPng = () => {
    if (!svgRef.current) return;
    const xml = new XMLSerializer().serializeToString(svgRef.current);
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
        const a = document.createElement('a'); a.href = url; a.download = `chart_${table.name}.png`; a.click();
        URL.revokeObjectURL(url);
      });
    };
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(xml)));
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
          <button onClick={downloadSvg} title="Download SVG" style={btnStyle()}>SVG</button>
          <button onClick={downloadPng} title="Download PNG" style={btnStyle()}>PNG</button>
          <button onClick={onRemove} title="Remove chart from this table"
            style={{ ...btnStyle(), color: '#fca5a5' }}>×</button>
        </div>
      </div>

      <div style={{ padding: 10 }}>
        {title && (
          <div className="chart-title-display" style={{ fontSize: titleFontSize, textAlign: 'center', marginBottom: 6, color: 'var(--text)', fontWeight: 600 }}>
            {title}
          </div>
        )}
        <ChartCanvas ref={svgRef} result={result} config={config} width={W_DEFAULT} height={H_DEFAULT}
          style={{ margin: '0 auto', maxWidth: '100%' }} />
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
