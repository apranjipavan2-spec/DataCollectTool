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
  // ─── Style customisation (all optional with sensible defaults) ───────────
  fontFamily?: string;            // applied to root SVG so all text inherits
  axisColor?: string;             // axis lines
  gridColor?: string;             // grid lines
  tickColor?: string;             // tick text + legend text
  axisLabelColor?: string;        // x/y caption text
  dataLabelColor?: string;        // value labels above bars (overrides series color)
  singleColor?: string;           // when set, all bars/slices use this single color
  seriesColors?: Record<number, string>;  // per-index colour override
  // ─── Behavioural / advanced rendering options ─────────────────────────────
  referenceLines?: Array<{ value: number; label?: string; color?: string; axis?: 'y' | 'x'; dash?: boolean }>;
  categorySort?: 'none' | 'asc' | 'desc';   // sort categories by first Y value
  topN?: number;                            // keep only N categories (0/undef = all)
  topNOther?: boolean;                      // roll the rest into a single "Other" bucket
  stacked100?: boolean;                     // normalise stacked bars to 100%
  labelPosition?: 'inside' | 'outside';     // data-label position (bar charts)
  trendline?: boolean;                      // linear regression overlay for scatter
  patternFills?: boolean;                   // B&W hatch fills instead of solid colors
  conditionalColor?: { threshold: number; below: string; above: string }; // colour-by-value
  lightMode?: boolean;                      // light theme preview (white bg, dark text)
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

// Wrap long axis/legend labels onto multiple lines (word-aware, hard-break
// if a single token exceeds the line budget). Keeps full text — never elides.
function wrapText(text: string, maxChars: number, maxLines = 4): string[] {
  const s = String(text ?? '');
  if (s.length <= maxChars) return [s];
  const tokens = s.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of tokens) {
    if (!cur) { cur = w; continue; }
    if ((cur + ' ' + w).length <= maxChars) cur += ' ' + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  const out: string[] = [];
  for (const ln of lines) {
    if (ln.length <= maxChars) { out.push(ln); continue; }
    for (let i = 0; i < ln.length; i += maxChars) out.push(ln.slice(i, i + maxChars));
  }
  return out.length > maxLines ? [...out.slice(0, maxLines - 1), out.slice(maxLines - 1).join(' ')] : out;
}

export const ChartCanvas = forwardRef<SVGSVGElement, Props>(function ChartCanvas(
  { result, config, width = 700, height = 340, interactive = true, className, style },
  svgRef,
) {
  const W = width, H = height;
  // All four margins are recomputed adaptively below once we know the actual
  // label widths, legend slot, and rotation. These initial values are just
  // safe defaults so any code that reads them before the recompute still works.
  let ML = 56, MR = 24;
  let MT = 28;
  let MB = 60;
  let PH = H - MT - MB;
  let PW = W - ML - MR;

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

  const categorySort = config.categorySort || 'none';
  const topN = typeof config.topN === 'number' && config.topN > 0 ? Math.floor(config.topN) : 0;
  const topNOther = !!config.topNOther;
  const stacked100 = !!config.stacked100;

  const multiData = useMemo(() => {
    if (xIdx < 0 || yIndices.length === 0) return [] as { label: string; values: number[]; displays: string[] }[];
    let arr = rows.map(r => ({
      label: String(r[xIdx] ?? ''),
      values: yIndices.map(yi => {
        const v = toNumber(r[yi]);
        return isFinite(v) ? v : 0;
      }),
      displays: yIndices.map(yi => {
        const raw = r[yi];
        if (raw === null || raw === undefined) return '';
        return String(raw);
      }),
    }));
    if (categorySort !== 'none') {
      arr = arr.slice().sort((a, b) => {
        const av = a.values[0] || 0, bv = b.values[0] || 0;
        return categorySort === 'asc' ? av - bv : bv - av;
      });
    }
    if (topN > 0 && arr.length > topN) {
      const kept = arr.slice(0, topN);
      const rest = arr.slice(topN);
      if (topNOther && rest.length) {
        const combined = yIndices.map((_, si) => rest.reduce((s, d) => s + (d.values[si] || 0), 0));
        kept.push({ label: 'Other', values: combined, displays: combined.map(v => fmt(v)) });
      }
      arr = kept;
    }
    return arr;
  }, [rows, xIdx, yIndices, categorySort, topN, topNOther]);

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

  // Compute series names + data extents up front so adaptive margins know
  // legend width and tick-label width before plot area is finalized.
  const seriesNames = yFieldsResolved.map(f => headers[headers.indexOf(f)] || f);

  const allValues = multiData.flatMap(d => d.values);
  const maxVal = allValues.length ? Math.max(...allValues) : 1;
  const minVal = Math.min(0, allValues.length ? Math.min(...allValues) : 0);

  const stackMax = (chartType === 'stacked' || chartType === 'waterfall')
    ? Math.max(...multiData.map(d => d.values.reduce((s, v) => s + Math.max(v, 0), 0)), 1)
    : maxVal;
  const effectiveMax = chartType === 'stacked'
    ? (stacked100 ? 100 : stackMax)
    : maxVal;

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

  // ─── Adaptive margins ────────────────────────────────────────────────
  // Each margin grows just enough to fit the labels/legend that live in it.
  // This is what stops the right legend and rotated x-labels from being
  // clipped at the SVG edge.
  const charPx = labelFontSize * 0.6; // approximate sans-serif glyph width

  // Right/Left margin: reserve room for the legend when it sits on the side.
  const sideLegendPx = (showLegend === 'right' || showLegend === 'left') && seriesNames.length > 1
    ? Math.ceil(14 + seriesNames.reduce((m, n) => Math.max(m, Math.min(15, n.length)), 0) * (labelFontSize - 1) * 0.62 + 18)
    : 0;
  if (showLegend === 'right' && seriesNames.length > 1) {
    MR = Math.max(MR, sideLegendPx);
  }
  // 'left' legend extends ML below — handled after ML is computed.

  // Top margin: outside value labels sit ABOVE the tallest bar, so reserve room
  // for them (two lines when value & % are split) — otherwise they clip the top.
  const labelPosEarly = config.labelPosition === 'inside' ? 'inside' : 'outside';
  if (showLabels && labelPosEarly === 'outside' && chartType !== 'pie' && chartType !== 'donut') {
    const lines = valueLabelSplit ? 2 : 1;
    MT = Math.max(MT, 16 + labelFontSize * lines + 6);
  }

  // X-axis rotation: auto-rotate only when horizontal labels would not fit the
  // per-category slot (prevents the overlapping x-values the user reported).
  const provInnerW = Math.max(40, W - ML - MR);
  const xSlotW = multiData.length > 0 ? provInnerW / multiData.length : provInnerW;
  const longestXChars = multiData.reduce((m, d) => Math.max(m, String(d.label).length), 0);
  const horizXFits = longestXChars * charPx <= xSlotW - 4;
  const effectiveXRot = xRot !== null ? xRot : (chartType === 'bar_h' ? 0 : (horizXFits ? 0 : -45));
  const xIsRotated = effectiveXRot !== 0;
  const xRotMag = Math.abs(effectiveXRot);
  const xWrapCols = xIsRotated ? 24 : Math.max(8, Math.floor(xSlotW / charPx));
  const maxXWrapLines = chartType === 'bar_h'
    ? 1
    : multiData.reduce((m, d) => Math.max(m, wrapText(String(d.label), xWrapCols).length), 1);
  const maxXChars = chartType === 'bar_h'
    ? 0  // bar_h labels live in the LEFT gutter, not bottom
    : Math.min(xWrapCols, multiData.reduce((m, d) => Math.max(m, String(d.label).length), 0));
  const xLabelTextPx = maxXChars * charPx;
  const rotRad = (Math.PI / 180) * xRotMag;
  const xLineHpx = labelFontSize * 1.15;
  const extraXLineH = (maxXWrapLines - 1) * xLineHpx;
  const labelSweep = xIsRotated
    ? Math.ceil(xLabelTextPx * Math.sin(rotRad) + 14 + extraXLineH * Math.cos(rotRad))
    : Math.ceil(labelFontSize + 10 + extraXLineH);
  // X-axis caption: wrap to the plot width and reserve height for every line so
  // a long axis title stays inside the white background instead of overflowing.
  const hasXCaption = !!xAxisLabel && chartType !== 'bar_h';
  const xCapBudget = Math.max(12, Math.floor(provInnerW / charPx));
  const xCapLines = hasXCaption ? wrapText(xAxisLabel, xCapBudget, 3) : [];
  const xCapLineH = (labelFontSize + 1) * 1.2;
  const captionGap = hasXCaption ? Math.ceil(xCapLines.length * xCapLineH + 12) : 0;
  MB = 14 + labelSweep + captionGap;
  // Where the x-axis caption sits (below the rotated label sweep).
  const xLabelExtraOffset = labelSweep + 14;

  // Left margin: room for the widest Y tick label + (rotated) Y-axis caption.
  // For bar_h the left gutter holds CATEGORY labels (truncated to 14 chars).
  const yTickLabelMaxChars = Math.max(...yTicks.map(t => fmt(t).length), 2);
  const yTickPx = yTickLabelMaxChars * charPx;
  // Y-axis caption: wrap to the plot height (text is rotated) and reserve width
  // per line so a long caption fits inside the left gutter, not off the canvas.
  const yCapText = yAxisLabel || yFieldsResolved[0] || '';
  const hasYCaption = chartType !== 'bar_h' && !!yCapText;
  const yCapBudget = Math.max(10, Math.floor((H - MT - MB) / charPx));
  const yCapLines = hasYCaption ? wrapText(yCapText, yCapBudget, 2) : [];
  const yCapLineH = (labelFontSize + 1) * 1.2;
  const yCaptionSlot = hasYCaption ? Math.ceil(yCapLines.length * yCapLineH + 8) : 0;
  if (chartType === 'bar_h') {
    const maxCatChars = Math.min(18, multiData.reduce((m, d) => Math.max(m, String(d.label).length), 0));
    ML = Math.max(64, Math.ceil(maxCatChars * charPx + 16));
  } else {
    ML = Math.max(48, Math.ceil(yTickPx + yCaptionSlot + 16));
  }
  // If legend is on the left, push axis content right to make room for it.
  if (showLegend === 'left' && seriesNames.length > 1) {
    ML += sideLegendPx;
  }
  // Pin Y-axis caption inside the left gutter, just left of the tick text.
  const yLabelX = chartType === 'bar_h' ? 12 : Math.max(10, ML - Math.ceil(yTickPx) - 12);

  // All margins finalised — derive plot area.
  PW = W - ML - MR;
  PH = H - MT - MB;

  const yToSvg = (v: number) => MT + PH - ((v - yMin) / yRange) * PH;
  const xToSvg = (i: number, n: number) => ML + (i + 0.5) * (PW / n);

  const barW = multiData.length > 0 ? Math.max(4, Math.min(48, (PW / multiData.length) * 0.72)) : 20;
  const groupBarW = yIndices.length > 0 ? barW / yIndices.length : barW;

  const lightMode = !!config.lightMode;
  const axisColor = config.axisColor || (lightMode ? '#6b7280' : '#374151');
  const gridColor = config.gridColor || (lightMode ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.05)');
  const labelColor = config.tickColor || (lightMode ? '#374151' : '#9ca3af');
  const captionColor = config.axisLabelColor || (lightMode ? '#1f2937' : '#e4e4e7');
  const fontFamily = config.fontFamily || '"Times New Roman", Times, serif';
  const singleColor = config.singleColor;
  const seriesColors = config.seriesColors || {};
  const colorFor = (i: number): string => {
    if (seriesColors[i]) return seriesColors[i];
    if (singleColor) return singleColor;
    return colors[i % colors.length];
  };
  const dataLabelColor = config.dataLabelColor;
  const labelFill = (seriesIdx: number): string => dataLabelColor || colorFor(seriesIdx);

  // Conditional color: when a per-bar value crosses the threshold, swap color.
  const condCol = config.conditionalColor;
  const colorForBar = (seriesIdx: number, value: number): string => {
    if (condCol && isFinite(value)) {
      return value < condCol.threshold ? condCol.below : condCol.above;
    }
    return colorFor(seriesIdx);
  };

  // Single-series bar charts use ONE colour for every bar by default (rather
  // than cycling the palette per category). A per-category override or the
  // singleColor/conditional settings still win. catIdx is the bar's category.
  const singleSeriesBars = yIndices.length <= 1;
  const barFill = (catIdx: number, value: number): string => {
    if (seriesColors[catIdx]) return seriesColors[catIdx];
    if (condCol && isFinite(value)) return value < condCol.threshold ? condCol.below : condCol.above;
    if (singleColor) return singleColor;
    return colors[0];
  };

  // Pattern fills: produce SVG <pattern> defs so each series gets a B&W hatch.
  const patternFills = !!config.patternFills;
  const PATTERN_KINDS = ['diagonalL', 'diagonalR', 'horizontal', 'vertical', 'cross', 'dots', 'zigzag'];
  const patternId = (i: number) => `tf-pat-${PATTERN_KINDS[i % PATTERN_KINDS.length]}-${i}`;
  const fillRefFor = (i: number, value?: number): string => {
    if (patternFills) return `url(#${patternId(i)})`;
    return value !== undefined ? colorForBar(i, value) : colorFor(i);
  };

  const labelPos: 'inside' | 'outside' = config.labelPosition === 'inside' ? 'inside' : 'outside';
  const refLines = Array.isArray(config.referenceLines) ? config.referenceLines : [];

  const renderLegend = () => {
    if (showLegend === 'none' || seriesNames.length <= 1) return null;
    if (showLegend === 'right') {
      return seriesNames.map((name, i) => {
        const lines = wrapText(name, 20, 3);
        const lineH = (labelFontSize - 1) * 1.15;
        return (
          <g key={i} transform={`translate(${ML + PW + 8}, ${MT + i * (18 + (lines.length - 1) * lineH)})`}>
            <rect width={10} height={10} fill={colorFor(i)} rx={2} />
            <text x={14} y={9} fontSize={labelFontSize - 1} fill={labelColor}>
              <title>{name}</title>
              {lines.map((ln, li) => (
                <tspan key={li} x={14} dy={li === 0 ? 0 : lineH}>{ln}</tspan>
              ))}
            </text>
          </g>
        );
      });
    }
    if (showLegend === 'bottom') {
      let cx = ML;
      return seriesNames.map((name, i) => {
        const x = cx; cx += name.length * 6 + 24;
        return (
          <g key={i} transform={`translate(${x}, ${MT + PH + 38})`}>
            <rect width={8} height={8} fill={colorFor(i)} rx={2} />
            <text x={12} y={8} fontSize={labelFontSize - 1} fill={labelColor}>{name}</text>
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
            <rect width={8} height={8} fill={colorFor(i)} rx={2} />
            <text x={12} y={8} fontSize={labelFontSize - 1} fill={labelColor}>{name}</text>
          </g>
        );
      });
    }
    if (showLegend === 'left') {
      return seriesNames.map((name, i) => {
        const lines = wrapText(name, 20, 3);
        const lineH = (labelFontSize - 1) * 1.15;
        return (
          <g key={i} transform={`translate(${8}, ${MT + i * (18 + (lines.length - 1) * lineH)})`}>
            <rect width={10} height={10} fill={colorFor(i)} rx={2} />
            <text x={14} y={9} fontSize={labelFontSize - 1} fill={labelColor}>
              <title>{name}</title>
              {lines.map((ln, li) => (
                <tspan key={li} x={14} dy={li === 0 ? 0 : lineH}>{ln}</tspan>
              ))}
            </text>
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
          const wrapCols = xIsRotated ? 24 : 12;
          const lineH = labelFontSize * 1.15;
          return multiData.map((d, i) => {
            const x = xToSvg(i, multiData.length);
            const lines = wrapText(d.label, wrapCols);
            const anchor = xIsRotated ? (effectiveXRot < 0 ? 'end' : 'start') : 'middle';
            return (
              <text key={i} x={x} y={tickY}
                textAnchor={anchor}
                fontSize={labelFontSize} fill={labelColor}
                transform={xIsRotated ? `rotate(${effectiveXRot},${x},${tickY})` : undefined}>
                <title>{d.label}</title>
                {lines.map((ln, li) => (
                  <tspan key={li} x={x} dy={li === 0 ? 0 : lineH}>{ln}</tspan>
                ))}
              </text>
            );
          });
        })()}
        {hasXCaption && (() => {
          const cx = ML + PW / 2;
          const baseY = MT + PH + xLabelExtraOffset + 4;
          return (
            <text x={cx} y={baseY} textAnchor="middle"
              fontSize={labelFontSize + 1} fill={captionColor} fontWeight={500}>
              {xCapLines.map((ln, li) => (
                <tspan key={li} x={cx} dy={li === 0 ? 0 : xCapLineH}>{ln}</tspan>
              ))}
            </text>
          );
        })()}
        {hasYCaption && (() => {
          const cy = MT + PH / 2;
          // For the rotated caption, stack wrapped lines about the centre.
          const startDy = -((yCapLines.length - 1) * yCapLineH) / 2;
          return (
            <text x={yLabelX} y={cy} textAnchor="middle" fontSize={labelFontSize + 1} fill={captionColor} fontWeight={500}
              transform={`rotate(-90,${yLabelX},${cy})`}>
              {yCapLines.map((ln, li) => (
                <tspan key={li} x={yLabelX} dy={li === 0 ? startDy : yCapLineH}>{ln}</tspan>
              ))}
            </text>
          );
        })()}
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
            const fill = patternFills ? `url(#${patternId(i)})` : (singleSeriesBars ? barFill(i, v) : fillRefFor(i, v));
            const lblY = labelPos === 'inside' ? y + Math.min(h - 4, labelFontSize + 2) : y - 4;
            const lblFill = labelPos === 'inside' ? (dataLabelColor || '#ffffff') : (dataLabelColor || (singleSeriesBars ? barFill(i, v) : labelFill(i)));
            return (
              <g key={i}>
                <rect x={x} y={y} width={barW} height={Math.max(h, 1)} fill={fill} rx={2} opacity={barOpacity}
                  onMouseEnter={e => showTip(e, `${d.label}\n${dispLabel(d.displays[0], v)}`)}
                  onMouseLeave={hideTip} style={{ cursor: interactive ? 'pointer' : 'default' }} />
                {showLabels && renderLabel(x + barW / 2, lblY, dispLabel(d.displays[0], v), { size: labelFontSize - 1, fill: lblFill })}
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
                {(() => {
                  const lines = wrapText(d.label, 18);
                  const lineH = labelFontSize * 1.15;
                  const cy = y + rowH / 2 + 4 - ((lines.length - 1) * lineH) / 2;
                  return (
                    <text x={ML - 6} y={cy} textAnchor="end" fontSize={labelFontSize} fill={labelColor}>
                      {lines.map((ln, li) => (
                        <tspan key={li} x={ML - 6} dy={li === 0 ? 0 : lineH}>{ln}</tspan>
                      ))}
                    </text>
                  );
                })()}
                <rect x={xScale(0)} y={y} width={Math.abs(xScale(v) - xScale(0))} height={rowH}
                  fill={patternFills ? `url(#${patternId(i)})` : barFill(i, v)} rx={2} opacity={barOpacity}
                  onMouseEnter={e => showTip(e, `${d.label}\n${dispLabel(d.displays[0], v)}`)}
                  onMouseLeave={hideTip} style={{ cursor: interactive ? 'pointer' : 'default' }} />
                {showLabels && (() => {
                  const inside = labelPos === 'inside';
                  const lx = inside ? Math.max(xScale(0), xScale(v)) - 4 : Math.max(xScale(0), xScale(v)) + 4;
                  const anchor = inside ? 'end' : 'start';
                  const lf = inside ? (dataLabelColor || '#ffffff') : (dataLabelColor || barFill(i, v));
                  return renderLabel(lx, y + rowH / 2 + 4, dispLabel(d.displays[0], v), { anchor, size: labelFontSize - 1, fill: lf });
                })()}
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
            const total = d.values.reduce((s, v) => s + Math.max(v, 0), 0) || 1;
            const scaleVal = (v: number): number => stacked100 ? (v / total) * 100 : v;
            let cumY = yToSvg(0);
            return (
              <g key={i}>
                {d.values.map((v, si) => {
                  const sv = scaleVal(v);
                  const h = Math.abs(yToSvg(0) - yToSvg(sv));
                  const y = cumY - h;
                  cumY = y;
                  const tipExtra = stacked100 ? ` (${((v / total) * 100).toFixed(1)}%)` : '';
                  return (
                    <rect key={si} x={x} y={y} width={barW} height={Math.max(h, 0.5)} fill={fillRefFor(si, v)}
                      rx={si === d.values.length - 1 ? 2 : 0} opacity={barOpacity}
                      onMouseEnter={e => showTip(e, `${d.label}\n${seriesNames[si]}: ${dispLabel(d.displays[si], v)}${tipExtra}`)}
                      onMouseLeave={hideTip} style={{ cursor: interactive ? 'pointer' : 'default' }} />
                  );
                })}
                {showLabels && renderLabel(x + barW / 2, cumY - 4,
                  stacked100 ? '100%' : fmt(d.values.reduce((s, v) => s + v, 0)),
                  { size: labelFontSize - 1, fill: dataLabelColor || captionColor })}
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
                  const lblY = labelPos === 'inside' ? y + Math.min(h - 2, labelFontSize) : y - 3;
                  const lblFill = labelPos === 'inside' ? (dataLabelColor || '#ffffff') : labelFill(si);
                  return (
                    <g key={si}>
                      <rect x={x} y={y} width={Math.max(groupBarW - 1, 2)} height={Math.max(h, 1)}
                        fill={fillRefFor(si, v)} rx={1} opacity={barOpacity}
                        onMouseEnter={e => showTip(e, `${d.label}\n${seriesNames[si]}: ${dispLabel(d.displays[si], v)}`)}
                        onMouseLeave={hideTip} style={{ cursor: interactive ? 'pointer' : 'default' }} />
                      {showLabels && renderLabel(x + groupBarW / 2, lblY, dispLabel(d.displays[si], v), { size: labelFontSize - 2, fill: lblFill })}
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
                {chartType === 'area' && <polygon points={`${first},${baseY} ${pts} ${last},${baseY}`} fill={colorFor(si)} opacity={0.12} />}
                <polyline points={pts} fill="none" stroke={colorFor(si)} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
                {multiData.map((d, i) => (
                  <circle key={i} cx={xToSvg(i, multiData.length)} cy={yToSvg(d.values[si])} r={3.5}
                    fill={colorFor(si)} stroke="var(--bg-card)" strokeWidth={1.5}
                    onMouseEnter={e => showTip(e, `${d.label}\n${seriesNames[si]}: ${dispLabel(d.displays[si], d.values[si])}`)}
                    onMouseLeave={hideTip} style={{ cursor: interactive ? 'pointer' : 'default' }} />
                ))}
                {showLabels && multiData.map((d, i) => (
                  <React.Fragment key={i}>
                    {renderLabel(xToSvg(i, multiData.length), yToSvg(d.values[si]) - 8, dispLabel(d.displays[si], d.values[si]), { size: labelFontSize - 1, fill: labelFill(si) })}
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
              <rect key={i} x={x} y={y} width={barW} height={Math.max(h, 1)} fill={colorFor(0)} rx={2} opacity={barOpacity}
                onMouseEnter={e => showTip(e, `${d.label}\n${seriesNames[barSeries]}: ${dispLabel(d.displays[barSeries], v)}`)}
                onMouseLeave={hideTip} style={{ cursor: interactive ? 'pointer' : 'default' }} />
            );
          })}
          {lineSeries.map((_, lsi) => {
            const si = lsi + 1;
            const pts = multiData.map((d, i) => `${xToSvg(i, multiData.length)},${yToSvg(d.values[si])}`).join(' ');
            return (
              <g key={si}>
                <polyline points={pts} fill="none" stroke={colorFor(si)} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
                {multiData.map((d, i) => (
                  <circle key={i} cx={xToSvg(i, multiData.length)} cy={yToSvg(d.values[si])} r={3.5}
                    fill={colorFor(si)} stroke="var(--bg-card)" strokeWidth={1.5}
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
      const cx = W / 2 + (showLegend === 'right' ? -40 : (showLegend === 'left' ? 40 : 0)), cy = H / 2, r = Math.min(PW, PH) / 2 - 10;
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
                <path d={path} fill={colorFor(i)} opacity={barOpacity} stroke="var(--bg-card)" strokeWidth={1.5}
                  onMouseEnter={e => showTip(e, `${d.label}\n${dispLabel(d.displays[0], d.values[0])} (${pct}%)`)}
                  onMouseLeave={hideTip} style={{ cursor: interactive ? 'pointer' : 'default' }} />
                {slice > 0.25 && showLabels && (() => {
                  // Use the table's own formatted cell where it differs from the
                  // bare numeric — otherwise just show the percent share.
                  const raw = d.displays[0] || '';
                  const showRaw = /[%()\/a-zA-Z]/.test(raw) && raw !== `${pct}%`;
                  return (
                    <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" fontSize={labelFontSize} fill={dataLabelColor || '#fff'} fontWeight={600}>
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
              <text x={cx} y={cy - 8} textAnchor="middle" fontSize={11} fill={labelColor}>Total</text>
              <text x={cx} y={cy + 10} textAnchor="middle" fontSize={14} fill={captionColor} fontWeight={700}>{fmt(total)}</text>
            </>
          )}
          {showLegend !== 'none' && multiData.slice(0, 12).map((d, i) => {
            const wrapCols = (showLegend === 'top' || showLegend === 'bottom') ? 14 : 22;
            const lines = wrapText(d.label, wrapCols, 3);
            const lineH = (labelFontSize - 1) * 1.15;
            const rowH = Math.max(18, 14 + (lines.length - 1) * lineH);
            const transform = showLegend === 'right'
              ? `translate(${cx + r + 24}, ${MT + i * rowH})`
              : showLegend === 'left'
                ? `translate(${8}, ${MT + i * rowH})`
                : showLegend === 'top'
                  ? `translate(${ML + i * 80}, ${8})`
                  : `translate(${ML + i * 80}, ${MT + PH + 20})`;
            return (
              <g key={i} transform={transform}>
                <rect width={10} height={10} fill={colorFor(i)} rx={2} />
                <text x={14} y={9} fontSize={labelFontSize - 1} fill={labelColor}>
                  <title>{d.label}</title>
                  {lines.map((ln, li) => (
                    <tspan key={li} x={14} dy={li === 0 ? 0 : lineH}>{ln}</tspan>
                  ))}
                </text>
              </g>
            );
          })}
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
          <text x={ML + PW / 2} y={MT + PH + 30} textAnchor="middle" fontSize={labelFontSize + 1} fill={captionColor}>{xAxisLabel || headers[sxIdx]}</text>
          <text x={yLabelX} y={MT + PH / 2} textAnchor="middle" fontSize={labelFontSize + 1} fill={captionColor}
            transform={`rotate(-90,${yLabelX},${MT + PH / 2})`}>{yAxisLabel || headers[syIdx]}</text>
          {sData.map((d, i) => (
            <circle key={i} cx={sx(d.x)} cy={sy(d.y)} r={5} fill={colorFor(i)} opacity={0.8} stroke="var(--bg-card)" strokeWidth={1}
              onMouseEnter={e => showTip(e, `${d.label}\n${headers[sxIdx]}: ${fmt(d.x)}\n${headers[syIdx]}: ${fmt(d.y)}`)}
              onMouseLeave={hideTip} style={{ cursor: interactive ? 'pointer' : 'default' }} />
          ))}
          {config.trendline && sData.length >= 2 && (() => {
            const n = sData.length;
            const sumX = sData.reduce((s, d) => s + d.x, 0);
            const sumY = sData.reduce((s, d) => s + d.y, 0);
            const sumXX = sData.reduce((s, d) => s + d.x * d.x, 0);
            const sumXY = sData.reduce((s, d) => s + d.x * d.y, 0);
            const denom = n * sumXX - sumX * sumX;
            if (!denom) return null;
            const m = (n * sumXY - sumX * sumY) / denom;
            const b = (sumY - m * sumX) / n;
            const meanY = sumY / n;
            const ssTot = sData.reduce((s, d) => s + (d.y - meanY) ** 2, 0) || 1;
            const ssRes = sData.reduce((s, d) => s + (d.y - (m * d.x + b)) ** 2, 0);
            const r2 = 1 - ssRes / ssTot;
            const yAt = (xv: number) => m * xv + b;
            const x1v = sxMin, x2v = sxMax;
            return (
              <g>
                <line x1={sx(x1v)} y1={sy(yAt(x1v))} x2={sx(x2v)} y2={sy(yAt(x2v))}
                  stroke={config.singleColor || '#f97316'} strokeWidth={1.8} strokeDasharray="6,4" />
                <text x={ML + PW - 4} y={MT + 12} textAnchor="end" fontSize={labelFontSize - 1}
                  fill={config.singleColor || '#f97316'} fontWeight={600}>
                  y = {m.toFixed(2)}x + {b.toFixed(2)}  R²={r2.toFixed(3)}
                </text>
              </g>
            );
          })()}
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
                  fill={isPos ? colorFor(0) : '#ef4444'} rx={2} opacity={barOpacity}
                  onMouseEnter={e => showTip(e, `${d.label}\n${v >= 0 ? '+' : ''}${dispLabel(d.displays[0], v)}\nRunning: ${fmt(cum)}`)}
                  onMouseLeave={hideTip} style={{ cursor: interactive ? 'pointer' : 'default' }} />
                {i < multiData.length - 1 && (
                  <line x1={xToSvg(i, multiData.length) + barW / 2} y1={y1}
                    x2={xToSvg(i + 1, multiData.length) - barW / 2} y2={y1}
                    stroke="rgba(255,255,255,0.15)" strokeWidth={1} strokeDasharray="3,2" />
                )}
                {showLabels && renderLabel(xToSvg(i, multiData.length), top - 4, dispLabel(d.displays[0], v), { size: labelFontSize - 1, fill: dataLabelColor || (isPos ? colorFor(0) : '#ef4444') })}
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
          {colHeaders.map((h, ci) => {
            const cx = ML + ci * cellW + cellW / 2;
            const rotated = cellW < 60;
            const wrapCols = rotated ? 22 : Math.max(6, Math.floor(cellW / 7));
            const lines = wrapText(String(h), wrapCols);
            const lineH = labelFontSize * 1.15;
            return (
              <text key={'ch' + ci} x={cx} y={MT - 6}
                textAnchor={rotated ? 'end' : 'middle'} fill={labelColor} fontSize={labelFontSize}
                transform={rotated ? `rotate(-30, ${cx}, ${MT - 6})` : undefined}>
                <title>{String(h)}</title>
                {lines.map((ln, li) => (
                  <tspan key={li} x={cx} dy={li === 0 ? 0 : lineH}>{ln}</tspan>
                ))}
              </text>
            );
          })}
          {rows.map((r, ri) => {
            const label = String(r[0] ?? '');
            const lines = wrapText(label, 18);
            const lineH = labelFontSize * 1.15;
            const cy = MT + ri * cellH + cellH / 2 + 4 - ((lines.length - 1) * lineH) / 2;
            return (
              <text key={'rl' + ri} x={ML - 6} y={cy}
                textAnchor="end" fill={labelColor} fontSize={labelFontSize}>
                <title>{label}</title>
                {lines.map((ln, li) => (
                  <tspan key={li} x={ML - 6} dy={li === 0 ? 0 : lineH}>{ln}</tspan>
                ))}
              </text>
            );
          })}
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
                <text x={barX + cbW + 4} y={barY + 8} fill={labelColor} fontSize={labelFontSize - 1}>{isCorr ? '1.0' : fmt(vMax)}</text>
                <text x={barX + cbW + 4} y={barY + cbH} fill={labelColor} fontSize={labelFontSize - 1}>{isCorr ? '-1.0' : fmt(vMin)}</text>
                {isCorr && <text x={barX + cbW + 4} y={barY + cbH / 2 + 3} fill={labelColor} fontSize={labelFontSize - 1}>0</text>}
              </g>
            );
          })()}
        </g>
      );
    }

    return null;
  };

  // Pattern definitions for B&W / hatch fills — one per series index touched.
  const patternsUsed = patternFills
    ? Array.from(new Set([
        ...Array.from({ length: Math.max(yIndices.length, multiData.length) }, (_, i) => i),
      ]))
    : [];
  const renderPatternDef = (i: number) => {
    const kind = PATTERN_KINDS[i % PATTERN_KINDS.length];
    const id = patternId(i);
    const stroke = lightMode ? '#111' : '#e5e7eb';
    const bg = lightMode ? '#fff' : 'transparent';
    if (kind === 'diagonalL') return (
      <pattern id={id} key={id} patternUnits="userSpaceOnUse" width={8} height={8}>
        <rect width={8} height={8} fill={bg} />
        <path d="M0,8 l8,-8 M-2,2 l4,-4 M6,10 l4,-4" stroke={stroke} strokeWidth={1.5} />
      </pattern>
    );
    if (kind === 'diagonalR') return (
      <pattern id={id} key={id} patternUnits="userSpaceOnUse" width={8} height={8}>
        <rect width={8} height={8} fill={bg} />
        <path d="M0,0 l8,8 M-2,6 l4,4 M6,-2 l4,4" stroke={stroke} strokeWidth={1.5} />
      </pattern>
    );
    if (kind === 'horizontal') return (
      <pattern id={id} key={id} patternUnits="userSpaceOnUse" width={6} height={6}>
        <rect width={6} height={6} fill={bg} />
        <line x1={0} y1={3} x2={6} y2={3} stroke={stroke} strokeWidth={1.5} />
      </pattern>
    );
    if (kind === 'vertical') return (
      <pattern id={id} key={id} patternUnits="userSpaceOnUse" width={6} height={6}>
        <rect width={6} height={6} fill={bg} />
        <line x1={3} y1={0} x2={3} y2={6} stroke={stroke} strokeWidth={1.5} />
      </pattern>
    );
    if (kind === 'cross') return (
      <pattern id={id} key={id} patternUnits="userSpaceOnUse" width={8} height={8}>
        <rect width={8} height={8} fill={bg} />
        <path d="M0,0 l8,8 M0,8 l8,-8" stroke={stroke} strokeWidth={1} />
      </pattern>
    );
    if (kind === 'dots') return (
      <pattern id={id} key={id} patternUnits="userSpaceOnUse" width={6} height={6}>
        <rect width={6} height={6} fill={bg} />
        <circle cx={3} cy={3} r={1.2} fill={stroke} />
      </pattern>
    );
    return (
      <pattern id={id} key={id} patternUnits="userSpaceOnUse" width={10} height={6}>
        <rect width={10} height={6} fill={bg} />
        <path d="M0,3 l2.5,-2.5 l2.5,2.5 l2.5,-2.5 l2.5,2.5" fill="none" stroke={stroke} strokeWidth={1.2} />
      </pattern>
    );
  };

  // Reference / target lines (horizontal only — drawn on plot area when y-range
  // includes the value). For waterfall/scatter still works if value lies inside.
  const renderRefLines = () => {
    if (refLines.length === 0) return null;
    return refLines.map((rl, i) => {
      if (!isFinite(rl.value)) return null;
      if ((rl.axis || 'y') !== 'y') return null;
      if (rl.value > yMax || rl.value < yMin) return null;
      const y = yToSvg(rl.value);
      const stroke = rl.color || '#f97316';
      return (
        <g key={'rl' + i}>
          <line x1={ML} y1={y} x2={ML + PW} y2={y} stroke={stroke} strokeWidth={1.5}
            strokeDasharray={rl.dash === false ? undefined : '6,4'} />
          {rl.label && (
            <text x={ML + PW - 4} y={y - 4} textAnchor="end" fontSize={labelFontSize - 1}
              fill={stroke} fontWeight={600}>{rl.label}</text>
          )}
        </g>
      );
    });
  };

  const svgBg = lightMode ? '#ffffff' : 'transparent';
  return (
    <div className={className} style={{ position: 'relative', ...style }}>
      <svg ref={svgRef} width={W} height={H} viewBox={`0 0 ${W} ${H}`}
        overflow="visible"
        style={{ background: svgBg, borderRadius: 8, display: 'block', maxWidth: '100%', overflow: 'visible', fontFamily: fontFamily || undefined }}>
        {patternsUsed.length > 0 && <defs>{patternsUsed.map(i => renderPatternDef(i))}</defs>}
        {renderChart()}
        {renderRefLines()}
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
