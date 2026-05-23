import React, { useState, useMemo, forwardRef } from 'react';
import {
  ChartType, LegendPos, PALETTES, paletteColorsByName,
  ticksArr, fmt, arcPath, toNumber, classifyColumns,
} from './chartUtils';
import { TableResult } from '../types';

export interface ChartCanvasConfig {
  type: ChartType;
  xField: string;
  yFields: string[];
  paletteName?: string;
  showGrid?: boolean;
  showLabels?: boolean;
  showLegend?: LegendPos;
  xAxisLabel?: string;
  yAxisLabel?: string;
  labelFontSize?: number;
  barOpacity?: number;
  // Tick label rotation (degrees). Defaults to 'auto' (-35 when >8 categories).
  xLabelRotation?: number | 'auto';
  yLabelRotation?: number;  // for tick values on Y axis (default 0)
  // When the cell display is "value (pct%)", render value on line 1 and percent on line 2.
  valueLabelSplit?: boolean;
}

interface Props {
  result: TableResult | null;
  config: ChartCanvasConfig;
  width?: number;
  height?: number;
  interactive?: boolean; // show tooltips on hover
  className?: string;
  style?: React.CSSProperties;
}

interface Tooltip { x: number; y: number; text: string }

export const ChartCanvas = forwardRef<SVGSVGElement, Props>(function ChartCanvas(
  { result, config, width = 700, height = 340, interactive = true, className, style },
  svgRef,
) {
  const W = width, H = height;
  // MB is recomputed below once we know whether x-tick labels are rotated.
  const ML = 78, MR = 24, MT = 28;
  let MB = 60;
  let PH = H - MT - MB;
  const PW = W - ML - MR;

  const [tooltip, setTooltip] = useState<Tooltip | null>(null);
  const showTip = (e: React.MouseEvent, text: string) => {
    if (interactive) setTooltip({ x: e.clientX, y: e.clientY, text });
  };
  const hideTip = () => { if (interactive) setTooltip(null); };

  const headers = result?.headers || [];
  const rows = useMemo(
    () => (result?.rows || []).filter(r => String(r[0]) !== 'Grand Total'),
    [result],
  );

  const { textCols, numCols } = useMemo(() => classifyColumns(headers, rows), [headers, rows]);

  const chartType = config.type;
  const effectiveX = config.xField || textCols[0] || headers[0] || '';
  const yFieldsResolved = config.yFields && config.yFields.length ? config.yFields : (numCols[0] ? [numCols[0]] : (headers[1] ? [headers[1]] : []));
  const xIdx = headers.indexOf(effectiveX);
  const yIndices = yFieldsResolved.map(f => headers.indexOf(f)).filter(i => i >= 0);

  const colors = paletteColorsByName(config.paletteName);
  const showGrid = config.showGrid !== false;
  const showLabels = !!config.showLabels;
  const showLegend: LegendPos = config.showLegend || 'right';
  const labelFontSize = config.labelFontSize || 10;
  const barOpacity = config.barOpacity ?? 0.9;
  const xAxisLabel = config.xAxisLabel || '';
  const yAxisLabel = config.yAxisLabel || '';
  const xRotRaw = config.xLabelRotation;
  const xRot = (xRotRaw === undefined || xRotRaw === 'auto')
    ? null  // auto-decide later (depends on category count)
    : Number(xRotRaw);
  const yTickRot = typeof config.yLabelRotation === 'number' ? config.yLabelRotation : 0;

  const multiData = useMemo(() => {
    if (xIdx < 0 || yIndices.length === 0) return [] as { label: string; values: number[]; displays: string[] }[];
    return rows.map(r => ({
      label: String(r[xIdx] ?? ''),
      values: yIndices.map(yi => {
        const v = toNumber(r[yi]);
        return isFinite(v) ? v : 0;
      }),
      // Original formatted cell strings from the table (e.g. "23 (45.2%)"),
      // used for value labels + tooltips so the chart mirrors the table.
      displays: yIndices.map(yi => {
        const raw = r[yi];
        if (raw === null || raw === undefined) return '';
        return String(raw);
      }),
    }));
  }, [rows, xIdx, yIndices]);

  const valueLabelSplit = !!config.valueLabelSplit;
  // Use raw cell string when it carries formatting (%, parens, comma) the
  // bare fmt(v) would drop. Otherwise prefer the compact fmt rendering.
  // If valueLabelSplit is set and the cell looks like "123 (45.6%)", split
  // it onto two lines so the value/percent stack vertically above the bar.
  const dispLabel = (display: string | undefined, v: number): string => {
    if (!display) return fmt(v);
    const hasFormat = /[%()\/a-zA-Z]/.test(display);
    if (!hasFormat) return fmt(v);
    if (valueLabelSplit) {
      const m = display.match(/^([^()]+?)\s*(\(.+\))\s*$/);
      if (m) return `${m[1].trim()}\n${m[2].trim()}`;
    }
    return display;
  };

  // Render a label that may contain newlines (table cells like "7\n(88%)"
  // mirror through as multi-line tspans). y is the BOTTOM baseline so the
  // block sits above the bar's y-offset.
  const renderLabel = (
    x: number, y: number, text: string,
    opts: { anchor?: 'start' | 'middle' | 'end'; size: number; fill: string; weight?: number | string; transform?: string } = { size: 10, fill: '#fff' },
  ) => {
    const lines = String(text || '').split(/\r?\n+/);
    const anchor = opts.anchor || 'middle';
    if (lines.length === 1) {
      return <text x={x} y={y} textAnchor={anchor} fontSize={opts.size} fill={opts.fill}
        fontWeight={opts.weight as any} transform={opts.transform}>{text}</text>;
    }
    const lineH = opts.size + 1;
    const liftFirst = -(lines.length - 1) * lineH;
    return (
      <text x={x} y={y} textAnchor={anchor} fontSize={opts.size} fill={opts.fill}
        fontWeight={opts.weight as any} transform={opts.transform}>
        {lines.map((ln, i) => (
          <tspan key={i} x={x} dy={i === 0 ? liftFirst : lineH}>{ln}</tspan>
        ))}
      </text>
    );
  };

  // Auto-rotation decision needs to happen BEFORE we pin MB so bottom margin
  // can grow to fit rotated x-tick labels + the axis caption.
  const effectiveXRot = xRot !== null ? xRot : (multiData.length > 8 ? -35 : 0);
  const xIsRotated = effectiveXRot !== 0;
  const xRotMag = Math.abs(effectiveXRot);
  // How far down rotated labels visually sweep from the tick line.
  const labelSweep = xIsRotated ? (xRotMag >= 60 ? 90 : 70) : 18;
  const hasXCaption = !!xAxisLabel && chartType !== 'bar_h';
  const captionGap = hasXCaption ? 22 : 0;
  MB = 14 + labelSweep + captionGap;
  PH = H - MT - MB;
  // Where the x-axis caption sits (below the rotated label sweep).
  const xLabelExtraOffset = labelSweep + 8;

  const allValues = multiData.flatMap(d => d.values);
  const maxVal = allValues.length ? Math.max(...allValues) : 1;
  const minVal = Math.min(0, allValues.length ? Math.min(...allValues) : 0);

  const stackMax = (chartType === 'stacked' || chartType === 'waterfall')
    ? Math.max(...multiData.map(d => d.values.reduce((s, v) => s + Math.max(v, 0), 0)), 1)
    : maxVal;
  const effectiveMax = chartType === 'stacked' ? stackMax : maxVal;

  const yTicks = ticksArr(minVal, effectiveMax);
  // Pad the top tick if it sits below the actual max — otherwise bars overshoot
  // the chart area (e.g., max=99 with step=20 produces ticks [0..80]).
  const topTick0 = yTicks.length ? Math.max(...yTicks) : 1;
  if (topTick0 < effectiveMax && yTicks.length >= 2) {
    const step = yTicks[1] - yTicks[0];
    let nextTop = topTick0 + step;
    while (nextTop < effectiveMax) nextTop += step;
    yTicks.push(parseFloat(nextTop.toFixed(10)));
  }
  const yMax = Math.max(...yTicks);
  const yMin = Math.min(...yTicks);
  const yRange = yMax - yMin || 1;

  const yToSvg = (v: number) => MT + PH - ((v - yMin) / yRange) * PH;
  const xToSvg = (i: number, n: number) => ML + (i + 0.5) * (PW / n);

  const seriesNames = yFieldsResolved.map(f => headers[headers.indexOf(f)] || f);
  const barW = multiData.length > 0 ? Math.max(4, Math.min(48, (PW / multiData.length) * 0.72)) : 20;
  const groupBarW = yIndices.length > 0 ? barW / yIndices.length : barW;

  const axisColor = '#374151';
  const gridColor = 'rgba(255,255,255,0.05)';
  const labelColor = '#9ca3af';

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
    if (!result) {
      return <text x={W / 2} y={H / 2} textAnchor="middle" fill="#64748b" fontSize={13}>No table results — add Values to this table first</text>;
    }
    if (!multiData.length) {
      const hint = yIndices.length === 0 ? 'No numeric columns detected — check Y axis selection' : 'No data to plot';
      return <text x={W / 2} y={H / 2} textAnchor="middle" fill="#64748b" fontSize={13}>{hint}</text>;
    }

    const usesAxes = ['bar', 'bar_h', 'stacked', 'grouped', 'line', 'area', 'combo', 'waterfall'].includes(chartType);
    const axes = usesAxes && (
      <g>
        <line x1={ML} y1={MT} x2={ML} y2={MT + PH} stroke={axisColor} strokeWidth={1} />
        <line x1={ML} y1={MT + PH} x2={ML + PW} y2={MT + PH} stroke={axisColor} strokeWidth={1} />
        {yTicks.map((t, i) => {
          const y = yToSvg(t);
          return (
            <g key={i}>
              {showGrid && <line x1={ML} y1={y} x2={ML + PW} y2={y} stroke={gridColor} strokeWidth={1} strokeDasharray="3,3" />}
              <text x={ML - 6} y={y + 4} textAnchor="end" fontSize={labelFontSize} fill={labelColor}
                transform={yTickRot ? `rotate(${yTickRot},${ML - 6},${y + 4})` : undefined}>
                {fmt(t)}
              </text>
            </g>
          );
        })}
        {chartType !== 'bar_h' && (() => {
          // When labels are rotated, give them room and anchor at the end so the text grows up-left from the tick.
          const tickY = MT + PH + 14;
          return multiData.map((d, i) => {
            const x = xToSvg(i, multiData.length);
            const maxLen = xIsRotated ? 22 : 12;
            const shown = d.label.length > maxLen ? d.label.slice(0, maxLen) + '…' : d.label;
            return (
              <text key={i} x={x} y={tickY}
                textAnchor={xIsRotated ? (effectiveXRot < 0 ? 'end' : 'start') : 'middle'}
                fontSize={labelFontSize} fill={labelColor}
                transform={xIsRotated ? `rotate(${effectiveXRot},${x},${tickY})` : undefined}>
                <title>{d.label}</title>
                {shown}
              </text>
            );
          });
        })()}
        {hasXCaption && (
          <text x={ML + PW / 2} y={MT + PH + xLabelExtraOffset + 4} textAnchor="middle"
            fontSize={labelFontSize + 1} fill="#e4e4e7" fontWeight={500}>
            {xAxisLabel}
          </text>
        )}
        {(yAxisLabel || yFieldsResolved[0]) && (
          <text x={14} y={MT + PH / 2} textAnchor="middle" fontSize={labelFontSize + 1} fill="#e4e4e7" fontWeight={500}
            transform={`rotate(-90,14,${MT + PH / 2})`}>
            {yAxisLabel || yFieldsResolved[0]}
          </text>
        )}
      </g>
    );

    if (chartType === 'bar') {
      return (
        <g>{axes}
          {multiData.map((d, i) => {
            const x = xToSvg(i, multiData.length) - barW / 2;
            const v = d.values[0];
            const y = yToSvg(Math.max(v, 0));
            const h = Math.abs(yToSvg(Math.min(v, 0)) - yToSvg(Math.max(v, 0)));
            return (
              <g key={i}>
                <rect x={x} y={y} width={barW} height={Math.max(h, 1)} fill={colors[i % colors.length]} rx={2} opacity={barOpacity}
                  onMouseEnter={e => showTip(e, `${d.label}\n${dispLabel(d.displays[0], v)}`)}
                  onMouseLeave={hideTip} style={{ cursor: interactive ? 'pointer' : 'default' }} />
                {showLabels && renderLabel(x + barW / 2, y - 4, dispLabel(d.displays[0], v), { size: labelFontSize - 1, fill: colors[i % colors.length] })}
              </g>
            );
          })}
          {renderLegend()}
        </g>
      );
    }

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
                  onMouseEnter={e => showTip(e, `${d.label}\n${dispLabel(d.displays[0], v)}`)}
                  onMouseLeave={hideTip} style={{ cursor: interactive ? 'pointer' : 'default' }} />
                {showLabels && renderLabel(Math.max(xScale(0), xScale(v)) + 4, y + rowH / 2 + 4, dispLabel(d.displays[0], v), { anchor: 'start', size: labelFontSize - 1, fill: colors[i % colors.length] })}
              </g>
            );
          })}
          {renderLegend()}
        </g>
      );
    }

    if (chartType === 'stacked') {
      return (
        <g>{axes}
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
                      onMouseEnter={e => showTip(e, `${d.label}\n${seriesNames[si]}: ${dispLabel(d.displays[si], v)}`)}
                      onMouseLeave={hideTip} style={{ cursor: interactive ? 'pointer' : 'default' }} />
                  );
                })}
                {showLabels && renderLabel(x + barW / 2, cumY - 4, fmt(d.values.reduce((s, v) => s + v, 0)), { size: labelFontSize - 1, fill: '#e4e4e7' })}
              </g>
            );
          })}
          {renderLegend()}
        </g>
      );
    }

    if (chartType === 'grouped') {
      return (
        <g>{axes}
          {multiData.map((d, i) => {
            const baseX = xToSvg(i, multiData.length) - barW / 2;
            return (
              <g key={i}>
                {d.values.map((v, si) => {
                  const x = baseX + si * groupBarW;
                  const y = yToSvg(Math.max(v, 0));
                  const h = Math.abs(yToSvg(0) - y);
                  return (
                    <g key={si}>
                      <rect x={x} y={y} width={Math.max(groupBarW - 1, 2)} height={Math.max(h, 1)}
                        fill={colors[si % colors.length]} rx={1} opacity={barOpacity}
                        onMouseEnter={e => showTip(e, `${d.label}\n${seriesNames[si]}: ${dispLabel(d.displays[si], v)}`)}
                        onMouseLeave={hideTip} style={{ cursor: interactive ? 'pointer' : 'default' }} />
                      {showLabels && renderLabel(x + groupBarW / 2, y - 3, dispLabel(d.displays[si], v), { size: labelFontSize - 2, fill: colors[si % colors.length] })}
                    </g>
                  );
                })}
              </g>
            );
          })}
          {renderLegend()}
        </g>
      );
    }

    if (chartType === 'line' || chartType === 'area') {
      return (
        <g>{axes}
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
                    fill={colors[si % colors.length]} stroke="var(--bg-card)" strokeWidth={1.5}
                    onMouseEnter={e => showTip(e, `${d.label}\n${seriesNames[si]}: ${dispLabel(d.displays[si], d.values[si])}`)}
                    onMouseLeave={hideTip} style={{ cursor: interactive ? 'pointer' : 'default' }} />
                ))}
                {showLabels && multiData.map((d, i) => (
                  <React.Fragment key={i}>
                    {renderLabel(xToSvg(i, multiData.length), yToSvg(d.values[si]) - 8, dispLabel(d.displays[si], d.values[si]), { size: labelFontSize - 1, fill: colors[si % colors.length] })}
                  </React.Fragment>
                ))}
              </g>
            );
          })}
          {renderLegend()}
        </g>
      );
    }

    if (chartType === 'combo' && yIndices.length >= 2) {
      const barSeries = 0;
      const lineSeries = yIndices.slice(1);
      return (
        <g>{axes}
          {multiData.map((d, i) => {
            const x = xToSvg(i, multiData.length) - barW / 2;
            const v = d.values[barSeries];
            const y = yToSvg(Math.max(v, 0));
            const h = Math.abs(yToSvg(0) - y);
            return (
              <rect key={i} x={x} y={y} width={barW} height={Math.max(h, 1)} fill={colors[0]} rx={2} opacity={barOpacity}
                onMouseEnter={e => showTip(e, `${d.label}\n${seriesNames[barSeries]}: ${dispLabel(d.displays[barSeries], v)}`)}
                onMouseLeave={hideTip} style={{ cursor: interactive ? 'pointer' : 'default' }} />
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
                    fill={colors[si % colors.length]} stroke="var(--bg-card)" strokeWidth={1.5}
                    onMouseEnter={e => showTip(e, `${d.label}\n${seriesNames[si]}: ${dispLabel(d.displays[si], d.values[si])}`)}
                    onMouseLeave={hideTip} style={{ cursor: interactive ? 'pointer' : 'default' }} />
                ))}
              </g>
            );
          })}
          {renderLegend()}
        </g>
      );
    }

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
                <path d={path} fill={colors[i % colors.length]} opacity={barOpacity} stroke="var(--bg-card)" strokeWidth={1.5}
                  onMouseEnter={e => showTip(e, `${d.label}\n${dispLabel(d.displays[0], d.values[0])} (${pct}%)`)}
                  onMouseLeave={hideTip} style={{ cursor: interactive ? 'pointer' : 'default' }} />
                {slice > 0.25 && showLabels && (() => {
                  // Use the table's own formatted cell where it differs from the
                  // bare numeric — otherwise just show the percent share.
                  const raw = d.displays[0] || '';
                  const showRaw = /[%()\/a-zA-Z]/.test(raw) && raw !== `${pct}%`;
                  return (
                    <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" fontSize={labelFontSize} fill="#fff" fontWeight={600}>
                      {showRaw ? raw : `${pct}%`}
                    </text>
                  );
                })()}
              </g>
            );
          })}
          {chartType === 'donut' && (
            <>
              <circle cx={cx} cy={cy} r={inner - 2} fill="var(--bg-card)" />
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

    if (chartType === 'scatter') {
      const sxIdx = numCols[0] ? headers.indexOf(numCols[0]) : 0;
      const syIdx = numCols[1] ? headers.indexOf(numCols[1]) : Math.min(1, headers.length - 1);
      const sData = rows.map(r => ({ x: toNumber(r[sxIdx]) || 0, y: toNumber(r[syIdx]) || 0, label: String(r[0] ?? '') }));
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
            <circle key={i} cx={sx(d.x)} cy={sy(d.y)} r={5} fill={colors[i % colors.length]} opacity={0.8} stroke="var(--bg-card)" strokeWidth={1}
              onMouseEnter={e => showTip(e, `${d.label}\n${headers[sxIdx]}: ${fmt(d.x)}\n${headers[syIdx]}: ${fmt(d.y)}`)}
              onMouseLeave={hideTip} style={{ cursor: interactive ? 'pointer' : 'default' }} />
          ))}
        </g>
      );
    }

    if (chartType === 'waterfall') {
      let cum = 0;
      return (
        <g>{axes}
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
                  onMouseEnter={e => showTip(e, `${d.label}\n${v >= 0 ? '+' : ''}${dispLabel(d.displays[0], v)}\nRunning: ${fmt(cum)}`)}
                  onMouseLeave={hideTip} style={{ cursor: interactive ? 'pointer' : 'default' }} />
                {i < multiData.length - 1 && (
                  <line x1={xToSvg(i, multiData.length) + barW / 2} y1={y1}
                    x2={xToSvg(i + 1, multiData.length) - barW / 2} y2={y1}
                    stroke="rgba(255,255,255,0.15)" strokeWidth={1} strokeDasharray="3,2" />
                )}
                {showLabels && renderLabel(xToSvg(i, multiData.length), top - 4, dispLabel(d.displays[0], v), { size: labelFontSize - 1, fill: isPos ? colors[0] : '#ef4444' })}
              </g>
            );
          })}
          {renderLegend()}
        </g>
      );
    }

    if (chartType === 'combo') {
      return <text x={W / 2} y={H / 2} textAnchor="middle" fill="#64748b" fontSize={12}>Combo chart needs 2+ Y fields selected</text>;
    }

    if (chartType === 'heatmap' || chartType === 'correlation') {
      if (rows.length === 0 || headers.length < 2) {
        return <text x={W / 2} y={H / 2} textAnchor="middle" fill="#64748b" fontSize={12}>Heatmap needs at least one row-label column and one numeric column</text>;
      }
      const colHeaders = headers.slice(1);
      const cellMatrix: number[][] = rows.map(r => colHeaders.map((_, ci) => toNumber(r[ci + 1])).map(v => Number.isFinite(v) ? v : NaN));
      const flat = cellMatrix.flat().filter(v => Number.isFinite(v));
      if (flat.length === 0) {
        return <text x={W / 2} y={H / 2} textAnchor="middle" fill="#64748b" fontSize={12}>No numeric cells to plot</text>;
      }
      const isCorr = chartType === 'correlation';
      const vMin = isCorr ? -1 : Math.min(...flat);
      const vMax = isCorr ?  1 : Math.max(...flat);
      const valToColor = (v: number) => {
        if (!Number.isFinite(v)) return '#1f2937';
        if (isCorr) {
          const t = Math.max(-1, Math.min(1, v));
          if (t >= 0) {
            const k = t;
            const r = Math.round(15 + (34 - 15) * (1 - k));
            const g = Math.round(23 + (197 - 23) * k);
            const b = Math.round(42 + (94 - 42) * (1 - k));
            return `rgb(${r},${g},${b})`;
          } else {
            const k = -t;
            const r = Math.round(15 + (239 - 15) * k);
            const g = Math.round(23 + (68 - 23) * (1 - k));
            const b = Math.round(42 + (68 - 42) * (1 - k));
            return `rgb(${r},${g},${b})`;
          }
        } else {
          const t = (v - vMin) / Math.max(vMax - vMin, 1e-9);
          const k = Math.max(0, Math.min(1, t));
          const r = Math.round(15 + (59 - 15) * k);
          const g = Math.round(23 + (130 - 23) * k);
          const b = Math.round(42 + (246 - 42) * k);
          return `rgb(${r},${g},${b})`;
        }
      };
      const nRows = rows.length, nCols = colHeaders.length;
      const cellW = PW / nCols, cellH = PH / nRows;
      const fontPx = Math.max(7, Math.min(labelFontSize, Math.floor(Math.min(cellW, cellH) / 3)));
      return (
        <g>
          {colHeaders.map((h, ci) => (
            <text key={'ch' + ci} x={ML + ci * cellW + cellW / 2} y={MT - 6}
              textAnchor="middle" fill="#9ca3af" fontSize={labelFontSize}
              transform={cellW < 60 ? `rotate(-30, ${ML + ci * cellW + cellW / 2}, ${MT - 6})` : undefined}>
              {String(h).length > 16 ? String(h).slice(0, 16) + '…' : String(h)}
            </text>
          ))}
          {rows.map((r, ri) => (
            <text key={'rl' + ri} x={ML - 6} y={MT + ri * cellH + cellH / 2 + 4}
              textAnchor="end" fill="#9ca3af" fontSize={labelFontSize}>
              {String(r[0] ?? '').length > 18 ? String(r[0] ?? '').slice(0, 18) + '…' : String(r[0] ?? '')}
            </text>
          ))}
          {cellMatrix.map((rowVals, ri) =>
            rowVals.map((v, ci) => (
              <g key={`c${ri}-${ci}`}>
                <rect x={ML + ci * cellW} y={MT + ri * cellH} width={cellW - 1} height={cellH - 1}
                  fill={valToColor(v)} stroke="var(--bg-card)" strokeWidth={1}
                  onMouseEnter={e => showTip(e, `${colHeaders[ci]} × ${rows[ri][0]}\nValue: ${Number.isFinite(v) ? v.toFixed(2) : 'n/a'}`)}
                  onMouseLeave={hideTip} />
                {showLabels && Number.isFinite(v) && (
                  <text x={ML + ci * cellW + cellW / 2} y={MT + ri * cellH + cellH / 2 + fontPx / 2 - 1}
                    textAnchor="middle" fill={Math.abs(v) > (isCorr ? 0.5 : (vMin + vMax) / 2) ? '#fff' : '#111'}
                    fontSize={fontPx} fontWeight={600}>
                    {isCorr ? v.toFixed(2) : (Number.isInteger(v) ? String(v) : v.toFixed(2))}
                  </text>
                )}
              </g>
            ))
          )}
          {(() => {
            const barX = ML + PW + 8, barY = MT, cbW = 12, cbH = PH;
            const stops = 24;
            return (
              <g>
                {Array.from({ length: stops }).map((_, i) => {
                  const t = i / (stops - 1);
                  const v = isCorr ? (1 - 2 * t) : (vMax - (vMax - vMin) * t);
                  return <rect key={'cb' + i} x={barX} y={barY + (cbH / stops) * i} width={cbW} height={cbH / stops + 0.5} fill={valToColor(v)} />;
                })}
                <text x={barX + cbW + 4} y={barY + 8} fill="#9ca3af" fontSize={labelFontSize - 1}>{isCorr ? '1.0' : fmt(vMax)}</text>
                <text x={barX + cbW + 4} y={barY + cbH} fill="#9ca3af" fontSize={labelFontSize - 1}>{isCorr ? '-1.0' : fmt(vMin)}</text>
                {isCorr && <text x={barX + cbW + 4} y={barY + cbH / 2 + 3} fill="#9ca3af" fontSize={labelFontSize - 1}>0</text>}
              </g>
            );
          })()}
        </g>
      );
    }

    return null;
  };

  return (
    <div className={className} style={{ position: 'relative', ...style }}>
      <svg ref={svgRef} width={W} height={H} viewBox={`0 0 ${W} ${H}`}
        style={{ background: 'transparent', borderRadius: 8, display: 'block', maxWidth: '100%' }}>
        {renderChart()}
      </svg>
      {tooltip && interactive && (
        <div className="chart-tooltip" style={{
          position: 'fixed', left: tooltip.x + 12, top: tooltip.y - 8,
          background: '#1e293b', border: '1px solid #334155',
          padding: '6px 10px', fontSize: 11, color: '#e2e8f0', borderRadius: 4,
          pointerEvents: 'none', zIndex: 5000, whiteSpace: 'pre-line',
        }}>
          {tooltip.text}
        </div>
      )}
    </div>
  );
});

// Export for charts that need the same defaults reused (e.g. in PALETTES grid)
export { PALETTES } from './chartUtils';
