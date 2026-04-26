import React, { useState, useEffect, useMemo, useRef } from 'react';
import { TableResult, TableConfig } from '../types';

interface Props {
  tables: TableConfig[];
  results: Map<string, TableResult>;
  onClose: () => void;
  onChartChange?: (tableId: string, chartConfig: any) => void;
}

type ChartType = 'bar' | 'bar_h' | 'stacked' | 'grouped' | 'line' | 'area' | 'pie' | 'donut' | 'scatter' | 'waterfall' | 'combo';
type LegendPos = 'right' | 'bottom' | 'top' | 'none';

const CHART_TYPES: { value: ChartType; label: string; icon: string }[] = [
  { value: 'bar',      label: 'Bar',         icon: '▐▐▐' },
  { value: 'bar_h',    label: 'Horizontal',   icon: '≡' },
  { value: 'stacked',  label: 'Stacked',      icon: '▊' },
  { value: 'grouped',  label: 'Grouped',      icon: '▐▌' },
  { value: 'line',     label: 'Line',         icon: '∿' },
  { value: 'area',     label: 'Area',         icon: '◟◝' },
  { value: 'combo',    label: 'Combo',        icon: '▐∿' },
  { value: 'pie',      label: 'Pie',          icon: '◔' },
  { value: 'donut',    label: 'Donut',        icon: '⊙' },
  { value: 'scatter',  label: 'Scatter',      icon: '∴' },
  { value: 'waterfall',label: 'Waterfall',    icon: '⤵' },
];

const PALETTES: { name: string; colors: string[] }[] = [
  { name: 'Blueprint', colors: ['#3b82f6','#60a5fa','#93c5fd','#1d4ed8','#2563eb','#6366f1','#8b5cf6'] },
  { name: 'Emerald',   colors: ['#10b981','#34d399','#6ee7b7','#059669','#047857','#065f46','#0d9488'] },
  { name: 'Sunset',    colors: ['#f97316','#fb923c','#fdba74','#ef4444','#f59e0b','#eab308','#84cc16'] },
  { name: 'Lavender',  colors: ['#8b5cf6','#a78bfa','#c4b5fd','#7c3aed','#6d28d9','#ec4899','#f472b6'] },
  { name: 'Mono',      colors: ['#e2e8f0','#cbd5e1','#94a3b8','#64748b','#475569','#334155','#1e293b'] },
  { name: 'Corporate', colors: ['#1e3a5f','#4a90d9','#7ab3ef','#2c5f2d','#97bc62','#d4a017','#c75b12'] },
];

const W = 700, H = 340;
const ML = 62, MR = 24, MT = 28, MB = 60;
const PW = W - ML - MR, PH = H - MT - MB;

function nice(v: number, up = true): number {
  if (v === 0) return 0;
  const exp = Math.pow(10, Math.floor(Math.log10(Math.abs(v))));
  const f = v / exp;
  const nf = up ? Math.ceil(f) : Math.floor(f);
  return nf * exp;
}

function ticksArr(min: number, max: number, count = 5): number[] {
  const range = nice(max - min, true) || 1;
  const step = nice(range / count, true) || 1;
  const t: number[] = [];
  const start = Math.floor(min / step) * step;
  for (let v = start; v <= max + step * 0.01; v += step) t.push(parseFloat(v.toFixed(10)));
  return t;
}

function fmt(n: number): string {
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function arcPath(cx: number, cy: number, r: number, startAngle: number, endAngle: number, inner = 0): string {
  const s = { x: cx + r * Math.cos(startAngle), y: cy + r * Math.sin(startAngle) };
  const e = { x: cx + r * Math.cos(endAngle),   y: cy + r * Math.sin(endAngle) };
  const large = endAngle - startAngle > Math.PI ? 1 : 0;
  if (inner === 0) return `M${cx},${cy} L${s.x},${s.y} A${r},${r} 0 ${large},1 ${e.x},${e.y} Z`;
  const si = { x: cx + inner * Math.cos(startAngle), y: cy + inner * Math.sin(startAngle) };
  const ei = { x: cx + inner * Math.cos(endAngle),   y: cy + inner * Math.sin(endAngle) };
  return `M${s.x},${s.y} A${r},${r} 0 ${large},1 ${e.x},${e.y} L${ei.x},${ei.y} A${inner},${inner} 0 ${large},0 ${si.x},${si.y} Z`;
}

export function ChartBuilder({ tables, results, onClose, onChartChange }: Props) {
  const [tableIdx, setTableIdx] = useState(0);
  const [chartType, setChartType] = useState<ChartType>('bar');
  const [xField, setXField] = useState('');
  const [yFields, setYFields] = useState<string[]>([]);
  const [palette, setPalette] = useState(0);
  const [showGrid, setShowGrid] = useState(true);
  const [showLabels, setShowLabels] = useState(false);
  const [showLegend, setShowLegend] = useState<LegendPos>('right');
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);
  const [chartTitle, setChartTitle] = useState('');
  const [xAxisLabel, setXAxisLabel] = useState('');
  const [yAxisLabel, setYAxisLabel] = useState('');
  const [labelFontSize, setLabelFontSize] = useState(10);
  const [titleFontSize, setTitleFontSize] = useState(14);
  const [barOpacity, setBarOpacity] = useState(0.9);
  const svgRef = useRef<SVGSVGElement>(null);

  const table = tables[tableIdx];

  // Load chart config from table when table changes
  useEffect(() => {
    const cc = table?.chartConfig;
    if (cc) {
      setChartType((cc.type as ChartType) || 'bar');
      setXField(cc.xField || '');
      setYFields(cc.yFields || []);
      setPalette(PALETTES.findIndex(p => p.name === cc.palette) || 0);
      setShowGrid(cc.showGrid !== false);
      setShowLabels(cc.showLabels || false);
      setShowLegend((cc.showLegend as unknown as LegendPos) || 'right');
      setChartTitle(cc.chartTitle || '');
      setXAxisLabel(cc.xAxisLabel || '');
      setYAxisLabel(cc.yAxisLabel || '');
      setLabelFontSize(cc.labelFontSize || 10);
      setTitleFontSize(cc.titleFontSize || 14);
      setBarOpacity(cc.barOpacity || 0.9);
    }
  }, [table?.id]);
  const result = table ? results.get(table.id) : null;
  const headers = result?.headers || [];
  const rows = useMemo(() => (result?.rows || []).filter(r => String(r[0]) !== 'Grand Total'), [result]);

  const textCols = headers.filter((_, i) => rows.length > 0 && typeof rows[0][i] !== 'number');
  const numCols  = headers.filter((_, i) => rows.length > 0 && typeof rows[0][i] === 'number');

  const effectiveX = xField || textCols[0] || headers[0] || '';
  const effectiveY = yFields.length > 0 ? yFields : [numCols[0] || headers[1] || ''];
  const xIdx = headers.indexOf(effectiveX);
  const yIndices = effectiveY.map(f => headers.indexOf(f)).filter(i => i >= 0);
  const colors = PALETTES[palette].colors;

  // Multi-series data
  const multiData = useMemo(() => {
    if (xIdx < 0 || yIndices.length === 0) return [];
    return rows.map(r => ({
      label: String(r[xIdx] ?? ''),
      values: yIndices.map(yi => Number(r[yi]) || 0),
    }));
  }, [rows, xIdx, yIndices]);

  const allValues = multiData.flatMap(d => d.values);
  const maxVal = allValues.length ? Math.max(...allValues) : 1;
  const minVal = Math.min(0, allValues.length ? Math.min(...allValues) : 0);

  // For stacked: max is sum of all series per label
  const stackMax = chartType === 'stacked' || chartType === 'waterfall'
    ? Math.max(...multiData.map(d => d.values.reduce((s, v) => s + Math.max(v, 0), 0)), 1)
    : maxVal;
  const effectiveMax = chartType === 'stacked' ? stackMax : maxVal;

  const yTicks = ticksArr(minVal, effectiveMax);
  const yMax = Math.max(...yTicks);
  const yMin = Math.min(...yTicks);
  const yRange = yMax - yMin || 1;

  const yToSvg = (v: number) => MT + PH - ((v - yMin) / yRange) * PH;
  const xToSvg = (i: number, n: number) => ML + (i + 0.5) * (PW / n);

  const toggleYField = (field: string) => {
    setYFields(prev => {
      const next = prev.includes(field) ? prev.filter(f => f !== field) : [...prev, field];
      return next.length > 0 ? next : prev;
    });
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
      canvas.width = W * 2; canvas.height = H * 2;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const img = new Image();
      img.onload = () => {
        ctx.fillStyle = '#0f1117'; ctx.fillRect(0, 0, canvas.width, canvas.height);
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

  const seriesNames = effectiveY.map(f => headers[headers.indexOf(f)] || f);
  const barW = multiData.length > 0 ? Math.max(4, Math.min(48, (PW / multiData.length) * 0.72)) : 20;
  const groupBarW = yIndices.length > 0 ? barW / yIndices.length : barW;

  const renderLegend = () => {
    if (showLegend === 'none' || seriesNames.length <= 1) return null;
    if (showLegend === 'right') {
      return seriesNames.map((name, i) => (
        <g key={i} transform={`translate(${ML + PW + 8}, ${MT + i * 18})`}>
          <rect width={10} height={10} fill={colors[i % colors.length]} rx={2} />
          <text x={14} y={9} fontSize={labelFontSize - 1} fill="#9ca3af">{name.length > 15 ? name.slice(0, 15) + '...' : name}</text>
        </g>
      ));
    }
    if (showLegend === 'bottom') {
      let cx = ML;
      return seriesNames.map((name, i) => {
        const x = cx; cx += name.length * 6 + 24;
        return (
          <g key={i} transform={`translate(${x}, ${MT + PH + 38})`}>
            <rect width={8} height={8} fill={colors[i % colors.length]} rx={2} />
            <text x={12} y={8} fontSize={labelFontSize - 1} fill="#9ca3af">{name}</text>
          </g>
        );
      });
    }
    if (showLegend === 'top') {
      let cx = ML;
      return seriesNames.map((name, i) => {
        const x = cx; cx += name.length * 6 + 24;
        return (
          <g key={i} transform={`translate(${x}, ${8})`}>
            <rect width={8} height={8} fill={colors[i % colors.length]} rx={2} />
            <text x={12} y={8} fontSize={labelFontSize - 1} fill="#9ca3af">{name}</text>
          </g>
        );
      });
    }
    return null;
  };

  const renderChart = () => {
    if (!multiData.length) return <text x={W / 2} y={H / 2} textAnchor="middle" fill="#64748b" fontSize={14}>No data — select table and fields</text>;

    const axisColor = '#374151';
    const gridColor = 'rgba(255,255,255,0.05)';
    const labelColor = '#9ca3af';

    const axes = (['bar', 'bar_h', 'stacked', 'grouped', 'line', 'area', 'combo', 'waterfall'].includes(chartType)) && (
      <g>
        <line x1={ML} y1={MT} x2={ML} y2={MT + PH} stroke={axisColor} strokeWidth={1} />
        <line x1={ML} y1={MT + PH} x2={ML + PW} y2={MT + PH} stroke={axisColor} strokeWidth={1} />
        {yTicks.map((t, i) => {
          const y = yToSvg(t);
          return (
            <g key={i}>
              {showGrid && <line x1={ML} y1={y} x2={ML + PW} y2={y} stroke={gridColor} strokeWidth={1} strokeDasharray="3,3" />}
              <text x={ML - 6} y={y + 4} textAnchor="end" fontSize={labelFontSize} fill={labelColor}>{fmt(t)}</text>
            </g>
          );
        })}
        {chartType !== 'bar_h' && multiData.map((d, i) => {
          const x = xToSvg(i, multiData.length);
          return (
            <text key={i} x={x} y={MT + PH + 14} textAnchor="middle" fontSize={labelFontSize} fill={labelColor}
              transform={multiData.length > 8 ? `rotate(-35,${x},${MT + PH + 14})` : undefined}>
              {d.label.length > 12 ? d.label.slice(0, 12) + '...' : d.label}
            </text>
          );
        })}
        {/* Axis labels */}
        {(xAxisLabel || effectiveX) && chartType !== 'bar_h' && (
          <text x={ML + PW / 2} y={MT + PH + (multiData.length > 8 ? 48 : 32)} textAnchor="middle" fontSize={labelFontSize + 1} fill="#e4e4e7" fontWeight={500}>
            {xAxisLabel || effectiveX}
          </text>
        )}
        {(yAxisLabel || effectiveY[0]) && (
          <text x={14} y={MT + PH / 2} textAnchor="middle" fontSize={labelFontSize + 1} fill="#e4e4e7" fontWeight={500}
            transform={`rotate(-90,14,${MT + PH / 2})`}>
            {yAxisLabel || effectiveY[0]}
          </text>
        )}
      </g>
    );

    // Bar chart
    if (chartType === 'bar') {
      return (
        <g>
          {axes}
          {multiData.map((d, i) => {
            const x = xToSvg(i, multiData.length) - barW / 2;
            const v = d.values[0];
            const y = yToSvg(Math.max(v, 0));
            const h = Math.abs(yToSvg(Math.min(v, 0)) - yToSvg(Math.max(v, 0)));
            return (
              <g key={i}>
                <rect x={x} y={y} width={barW} height={Math.max(h, 1)} fill={colors[i % colors.length]} rx={2} opacity={barOpacity}
                  onMouseEnter={e => setTooltip({ x: e.clientX, y: e.clientY, text: `${d.label}\n${fmt(v)}` })}
                  onMouseLeave={() => setTooltip(null)} style={{ cursor: 'pointer' }}>
                  <animate attributeName="height" from="0" to={Math.max(h, 1)} dur="0.4s" fill="freeze" />
                  <animate attributeName="y" from={yToSvg(0)} to={y} dur="0.4s" fill="freeze" />
                </rect>
                {showLabels && <text x={x + barW / 2} y={y - 4} textAnchor="middle" fontSize={labelFontSize - 1} fill={colors[i % colors.length]}>{fmt(v)}</text>}
              </g>
            );
          })}
          {renderLegend()}
        </g>
      );
    }

    // Horizontal bar
    if (chartType === 'bar_h') {
      const xMax2 = maxVal || 1;
      const xMin2 = Math.min(0, minVal);
      const xRange2 = xMax2 - xMin2 || 1;
      const rowH = Math.max(4, Math.min(36, (PH / multiData.length) * 0.72));
      const xScale = (v: number) => ML + ((v - xMin2) / xRange2) * PW;
      return (
        <g>
          <line x1={ML} y1={MT} x2={ML} y2={MT + PH} stroke={axisColor} strokeWidth={1} />
          <line x1={ML} y1={MT + PH} x2={ML + PW} y2={MT + PH} stroke={axisColor} strokeWidth={1} />
          {multiData.map((d, i) => {
            const v = d.values[0];
            const y = MT + i * (PH / multiData.length) + (PH / multiData.length - rowH) / 2;
            return (
              <g key={i}>
                <text x={ML - 6} y={y + rowH / 2 + 4} textAnchor="end" fontSize={labelFontSize} fill={labelColor}>
                  {d.label.length > 14 ? d.label.slice(0, 14) + '...' : d.label}
                </text>
                <rect x={xScale(0)} y={y} width={Math.abs(xScale(v) - xScale(0))} height={rowH}
                  fill={colors[i % colors.length]} rx={2} opacity={barOpacity}
                  onMouseEnter={e => setTooltip({ x: e.clientX, y: e.clientY, text: `${d.label}\n${fmt(v)}` })}
                  onMouseLeave={() => setTooltip(null)} style={{ cursor: 'pointer' }} />
                {showLabels && <text x={Math.max(xScale(0), xScale(v)) + 4} y={y + rowH / 2 + 4} fontSize={labelFontSize - 1} fill={colors[i % colors.length]}>{fmt(v)}</text>}
              </g>
            );
          })}
          {renderLegend()}
        </g>
      );
    }

    // Stacked bar
    if (chartType === 'stacked') {
      return (
        <g>
          {axes}
          {multiData.map((d, i) => {
            const x = xToSvg(i, multiData.length) - barW / 2;
            let cumY = yToSvg(0);
            return (
              <g key={i}>
                {d.values.map((v, si) => {
                  const h = Math.abs(yToSvg(0) - yToSvg(v));
                  const y = cumY - h;
                  cumY = y;
                  return (
                    <rect key={si} x={x} y={y} width={barW} height={Math.max(h, 0.5)} fill={colors[si % colors.length]}
                      rx={si === d.values.length - 1 ? 2 : 0} opacity={barOpacity}
                      onMouseEnter={e => setTooltip({ x: e.clientX, y: e.clientY, text: `${d.label}\n${seriesNames[si]}: ${fmt(v)}` })}
                      onMouseLeave={() => setTooltip(null)} style={{ cursor: 'pointer' }} />
                  );
                })}
                {showLabels && <text x={x + barW / 2} y={cumY - 4} textAnchor="middle" fontSize={labelFontSize - 1} fill="#e4e4e7">{fmt(d.values.reduce((s, v) => s + v, 0))}</text>}
              </g>
            );
          })}
          {renderLegend()}
        </g>
      );
    }

    // Grouped bar
    if (chartType === 'grouped') {
      return (
        <g>
          {axes}
          {multiData.map((d, i) => {
            const baseX = xToSvg(i, multiData.length) - barW / 2;
            return (
              <g key={i}>
                {d.values.map((v, si) => {
                  const x = baseX + si * groupBarW;
                  const y = yToSvg(Math.max(v, 0));
                  const h = Math.abs(yToSvg(0) - y);
                  return (
                    <rect key={si} x={x} y={y} width={Math.max(groupBarW - 1, 2)} height={Math.max(h, 1)}
                      fill={colors[si % colors.length]} rx={1} opacity={barOpacity}
                      onMouseEnter={e => setTooltip({ x: e.clientX, y: e.clientY, text: `${d.label}\n${seriesNames[si]}: ${fmt(v)}` })}
                      onMouseLeave={() => setTooltip(null)} style={{ cursor: 'pointer' }} />
                  );
                })}
              </g>
            );
          })}
          {renderLegend()}
        </g>
      );
    }

    // Line / Area
    if (chartType === 'line' || chartType === 'area') {
      return (
        <g>
          {axes}
          {yIndices.map((_, si) => {
            const pts = multiData.map((d, i) => `${xToSvg(i, multiData.length)},${yToSvg(d.values[si])}`).join(' ');
            const first = xToSvg(0, multiData.length), last = xToSvg(multiData.length - 1, multiData.length);
            const baseY = yToSvg(0);
            return (
              <g key={si}>
                {chartType === 'area' && <polygon points={`${first},${baseY} ${pts} ${last},${baseY}`} fill={colors[si % colors.length]} opacity={0.12} />}
                <polyline points={pts} fill="none" stroke={colors[si % colors.length]} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
                {multiData.map((d, i) => (
                  <circle key={i} cx={xToSvg(i, multiData.length)} cy={yToSvg(d.values[si])} r={3.5}
                    fill={colors[si % colors.length]} stroke="#0f1117" strokeWidth={1.5}
                    onMouseEnter={e => setTooltip({ x: e.clientX, y: e.clientY, text: `${d.label}\n${seriesNames[si]}: ${fmt(d.values[si])}` })}
                    onMouseLeave={() => setTooltip(null)} style={{ cursor: 'pointer' }} />
                ))}
                {showLabels && multiData.map((d, i) => (
                  <text key={i} x={xToSvg(i, multiData.length)} y={yToSvg(d.values[si]) - 8}
                    textAnchor="middle" fontSize={labelFontSize - 1} fill={colors[si % colors.length]}>{fmt(d.values[si])}</text>
                ))}
              </g>
            );
          })}
          {renderLegend()}
        </g>
      );
    }

    // Combo (bars + line)
    if (chartType === 'combo' && yIndices.length >= 2) {
      const barSeries = 0;
      const lineSeries = yIndices.slice(1);
      return (
        <g>
          {axes}
          {multiData.map((d, i) => {
            const x = xToSvg(i, multiData.length) - barW / 2;
            const v = d.values[barSeries];
            const y = yToSvg(Math.max(v, 0));
            const h = Math.abs(yToSvg(0) - y);
            return (
              <rect key={i} x={x} y={y} width={barW} height={Math.max(h, 1)} fill={colors[0]} rx={2} opacity={barOpacity}
                onMouseEnter={e => setTooltip({ x: e.clientX, y: e.clientY, text: `${d.label}\n${seriesNames[barSeries]}: ${fmt(v)}` })}
                onMouseLeave={() => setTooltip(null)} style={{ cursor: 'pointer' }} />
            );
          })}
          {lineSeries.map((_, lsi) => {
            const si = lsi + 1;
            const pts = multiData.map((d, i) => `${xToSvg(i, multiData.length)},${yToSvg(d.values[si])}`).join(' ');
            return (
              <g key={si}>
                <polyline points={pts} fill="none" stroke={colors[si % colors.length]} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
                {multiData.map((d, i) => (
                  <circle key={i} cx={xToSvg(i, multiData.length)} cy={yToSvg(d.values[si])} r={3.5}
                    fill={colors[si % colors.length]} stroke="#0f1117" strokeWidth={1.5}
                    onMouseEnter={e => setTooltip({ x: e.clientX, y: e.clientY, text: `${d.label}\n${seriesNames[si]}: ${fmt(d.values[si])}` })}
                    onMouseLeave={() => setTooltip(null)} style={{ cursor: 'pointer' }} />
                ))}
              </g>
            );
          })}
          {renderLegend()}
        </g>
      );
    }

    // Pie / Donut
    if (chartType === 'pie' || chartType === 'donut') {
      const total = multiData.reduce((s, d) => s + Math.abs(d.values[0]), 0) || 1;
      const cx = W / 2 - (showLegend === 'right' ? 40 : 0), cy = H / 2, r = Math.min(PW, PH) / 2 - 10;
      const inner = chartType === 'donut' ? r * 0.52 : 0;
      let angle = -Math.PI / 2;
      return (
        <g>
          {multiData.map((d, i) => {
            const v = Math.abs(d.values[0]);
            const slice = (v / total) * 2 * Math.PI;
            const mid = angle + slice / 2;
            const path = arcPath(cx, cy, r, angle, angle + slice, inner);
            const labelR = r * 0.72 + (inner > 0 ? inner * 0.3 : 0);
            const lx = cx + labelR * Math.cos(mid);
            const ly = cy + labelR * Math.sin(mid);
            const pct = ((v / total) * 100).toFixed(1);
            angle += slice;
            return (
              <g key={i}>
                <path d={path} fill={colors[i % colors.length]} opacity={barOpacity} stroke="#0f1117" strokeWidth={1.5}
                  onMouseEnter={e => setTooltip({ x: e.clientX, y: e.clientY, text: `${d.label}\n${fmt(d.values[0])} (${pct}%)` })}
                  onMouseLeave={() => setTooltip(null)} style={{ cursor: 'pointer' }} />
                {slice > 0.25 && showLabels && (
                  <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" fontSize={labelFontSize} fill="#fff" fontWeight={600}>{pct}%</text>
                )}
              </g>
            );
          })}
          {chartType === 'donut' && (
            <>
              <circle cx={cx} cy={cy} r={inner - 2} fill="#0f1117" />
              <text x={cx} y={cy - 8} textAnchor="middle" fontSize={11} fill="#9ca3af">Total</text>
              <text x={cx} y={cy + 10} textAnchor="middle" fontSize={14} fill="#e4e4e7" fontWeight={700}>{fmt(total)}</text>
            </>
          )}
          {showLegend !== 'none' && multiData.slice(0, 12).map((d, i) => (
            <g key={i} transform={showLegend === 'right'
              ? `translate(${cx + r + 24}, ${MT + i * 18})`
              : `translate(${ML + i * 80}, ${MT + PH + 20})`}>
              <rect width={10} height={10} fill={colors[i % colors.length]} rx={2} />
              <text x={14} y={9} fontSize={labelFontSize - 1} fill="#9ca3af">{d.label.length > 18 ? d.label.slice(0, 18) + '...' : d.label}</text>
            </g>
          ))}
        </g>
      );
    }

    // Scatter
    if (chartType === 'scatter') {
      const numIdx = headers.reduce((acc: number[], _, i) => { if (rows.length > 0 && typeof rows[0][i] === 'number') acc.push(i); return acc; }, []);
      const sxIdx = numIdx[0] ?? 0, syIdx = numIdx[1] ?? 1;
      const sData = rows.map(r => ({ x: Number(r[sxIdx]) || 0, y: Number(r[syIdx]) || 0, label: String(r[0] ?? '') }));
      const sxVals = sData.map(d => d.x), syVals = sData.map(d => d.y);
      const sxMin = Math.min(...sxVals), sxMax = Math.max(...sxVals);
      const syMin2 = Math.min(...syVals), syMax2 = Math.max(...syVals);
      const sxRange = sxMax - sxMin || 1, syRange2 = syMax2 - syMin2 || 1;
      const sx = (v: number) => ML + ((v - sxMin) / sxRange) * PW;
      const sy = (v: number) => MT + PH - ((v - syMin2) / syRange2) * PH;
      return (
        <g>
          <line x1={ML} y1={MT} x2={ML} y2={MT + PH} stroke={axisColor} strokeWidth={1} />
          <line x1={ML} y1={MT + PH} x2={ML + PW} y2={MT + PH} stroke={axisColor} strokeWidth={1} />
          {showGrid && [0.25, 0.5, 0.75, 1].map((f, i) => (
            <g key={i}>
              <line x1={ML + PW * f} y1={MT} x2={ML + PW * f} y2={MT + PH} stroke={gridColor} strokeWidth={1} strokeDasharray="3,3" />
              <line x1={ML} y1={MT + PH * (1 - f)} x2={ML + PW} y2={MT + PH * (1 - f)} stroke={gridColor} strokeWidth={1} strokeDasharray="3,3" />
            </g>
          ))}
          <text x={ML + PW / 2} y={MT + PH + 30} textAnchor="middle" fontSize={labelFontSize + 1} fill={labelColor}>{xAxisLabel || headers[sxIdx]}</text>
          <text x={14} y={MT + PH / 2} textAnchor="middle" fontSize={labelFontSize + 1} fill={labelColor}
            transform={`rotate(-90,14,${MT + PH / 2})`}>{yAxisLabel || headers[syIdx]}</text>
          {sData.map((d, i) => (
            <circle key={i} cx={sx(d.x)} cy={sy(d.y)} r={5} fill={colors[i % colors.length]} opacity={0.8} stroke="#0f1117" strokeWidth={1}
              onMouseEnter={e => setTooltip({ x: e.clientX, y: e.clientY, text: `${d.label}\n${headers[sxIdx]}: ${fmt(d.x)}\n${headers[syIdx]}: ${fmt(d.y)}` })}
              onMouseLeave={() => setTooltip(null)} style={{ cursor: 'pointer' }} />
          ))}
        </g>
      );
    }

    // Waterfall
    if (chartType === 'waterfall') {
      let cum = 0;
      return (
        <g>
          {axes}
          {multiData.map((d, i) => {
            const v = d.values[0];
            const y0 = yToSvg(cum);
            cum += v;
            const y1 = yToSvg(cum);
            const top = Math.min(y0, y1), h = Math.abs(y1 - y0);
            const isPos = v >= 0;
            return (
              <g key={i}>
                <rect x={xToSvg(i, multiData.length) - barW / 2} y={top} width={barW} height={Math.max(h, 1)}
                  fill={isPos ? colors[0] : '#ef4444'} rx={2} opacity={barOpacity}
                  onMouseEnter={e => setTooltip({ x: e.clientX, y: e.clientY, text: `${d.label}\n${v >= 0 ? '+' : ''}${fmt(v)}\nRunning: ${fmt(cum)}` })}
                  onMouseLeave={() => setTooltip(null)} style={{ cursor: 'pointer' }} />
                {i < multiData.length - 1 && (
                  <line x1={xToSvg(i, multiData.length) + barW / 2} y1={y1}
                    x2={xToSvg(i + 1, multiData.length) - barW / 2} y2={y1}
                    stroke="rgba(255,255,255,0.15)" strokeWidth={1} strokeDasharray="3,2" />
                )}
                {showLabels && <text x={xToSvg(i, multiData.length)} y={top - 4} textAnchor="middle" fontSize={labelFontSize - 1} fill={isPos ? colors[0] : '#ef4444'}>{fmt(v)}</text>}
              </g>
            );
          })}
          {renderLegend()}
        </g>
      );
    }

    // Fallback for combo with < 2 series
    if (chartType === 'combo') {
      return <text x={W / 2} y={H / 2} textAnchor="middle" fill="#64748b" fontSize={12}>Combo chart needs 2+ Y fields selected</text>;
    }
    return null;
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal chart-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 980 }}>
        <div className="modal-header">
          <h2>Chart Builder</h2>
          <button className="modal-close" onClick={() => {
            // Save chart config before closing
            if (onChartChange && table) {
              onChartChange(table.id, {
                type: chartType,
                xField,
                yFields,
                palette: PALETTES[palette].name,
                showGrid,
                showLabels,
                showLegend,
                chartTitle,
                xAxisLabel,
                yAxisLabel,
                labelFontSize,
                titleFontSize,
                barOpacity,
              });
            }
            onClose();
          }}>x</button>
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

            {chartType !== 'scatter' && (
              <>
                <div className="form-group">
                  <label>X Axis / Labels</label>
                  <select value={effectiveX} onChange={e => setXField(e.target.value)}>
                    {headers.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Y Axis / Values {yIndices.length > 1 && `(${yIndices.length})`}</label>
                  <div style={{ maxHeight: 100, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 4, padding: 4 }}>
                    {numCols.map(h => (
                      <label key={h} className="checkbox-label" style={{ fontSize: 11, padding: '2px 4px' }}>
                        <input type="checkbox" checked={effectiveY.includes(h)} onChange={() => toggleYField(h)} />
                        {h.length > 25 ? h.slice(0, 25) + '...' : h}
                      </label>
                    ))}
                  </div>
                </div>
              </>
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
              <input type="text" value={chartTitle} onChange={e => setChartTitle(e.target.value)} placeholder="Optional title" />
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
            </div>

            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <button className="btn-secondary" style={{ flex: 1, fontSize: 11 }} onClick={() => handleDownload('svg')}>SVG</button>
              <button className="btn-secondary" style={{ flex: 1, fontSize: 11 }} onClick={() => handleDownload('png')}>PNG</button>
            </div>
          </div>

          {/* Chart canvas */}
          <div className="chart-canvas-wrap" style={{ flex: 1 }}>
            {chartTitle && <div className="chart-title-display" style={{ fontSize: titleFontSize }}>{chartTitle}</div>}
            <svg ref={svgRef} width={W} height={H} viewBox={`0 0 ${W} ${H}`}
              style={{ background: '#0f1117', borderRadius: 8, display: 'block', maxWidth: '100%' }}>
              {renderChart()}
            </svg>
            {multiData.length > 0 && (
              <div className="chart-meta">
                {multiData.length} data points · {effectiveY.length} series · {effectiveX} vs {effectiveY.join(', ')}
              </div>
            )}
          </div>
        </div>

        {tooltip && (
          <div className="chart-tooltip" style={{ left: tooltip.x + 12, top: tooltip.y - 8 }}>
            {tooltip.text.split('\n').map((line, i) => <div key={i}>{line}</div>)}
          </div>
        )}
      </div>
    </div>
  );
}
