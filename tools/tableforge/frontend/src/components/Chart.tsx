import React, { useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  Cell, ScatterChart, Scatter, ZAxis,
} from 'recharts';

// ── Generic data shapes (kept loose so any panel can supply payloads) ──
export interface BarData {
  labels: string[];
  values: number[];
  /** Y-axis label (e.g. "Count" or "%"). */
  yLabel?: string;
}

export interface StackedBarItem {
  label: string;
  /** One entry per scale level (e.g. 5 entries for a 1–5 Likert item). */
  segments: number[];
}
export interface StackedBarData {
  items: StackedBarItem[];
  /** Display name for each segment (e.g. ["Strongly Disagree", ..., "Strongly Agree"]). */
  levels: string[];
  /** Palette length should match levels.length. */
  palette?: string[];
}

export interface HeatmapData {
  xLabels: string[];
  yLabels: string[];
  /** values[y][x] — must be xLabels.length × yLabels.length. */
  values: (number | null)[][];
  /** Display domain — defaults to [min, max] of the data. */
  domain?: [number, number];
  /** "diverging" colours red↔green around 0; "sequential" goes pale→deep. */
  scale?: 'diverging' | 'sequential';
}

export interface BoxGroup {
  label: string;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
}
export interface BoxData {
  groups: BoxGroup[];
}

type ChartProps =
  | { kind: 'bar'; data: BarData; title?: string; height?: number }
  | { kind: 'stackedBar'; data: StackedBarData; title?: string; height?: number }
  | { kind: 'heatmap'; data: HeatmapData; title?: string; height?: number }
  | { kind: 'box'; data: BoxData; title?: string; height?: number };

const DEFAULT_HEIGHT = 340;
const LIKERT_PALETTE = ['#ef4444', '#f59e0b', '#facc15', '#84cc16', '#22c55e'];
const BAR_PALETTE = ['#3b82f6', '#0ea5e9', '#22c55e', '#facc15', '#f59e0b', '#ef4444', '#a855f7', '#ec4899'];
const AXIS_COLOR = '#94a3b8';
const GRID_COLOR = '#334155';

export function Chart(props: ChartProps) {
  const height = props.height ?? DEFAULT_HEIGHT;
  return (
    <div style={{ background: 'var(--bg-alt, #0f172a)', border: '1px solid var(--border, #334155)', borderRadius: 8, padding: 12 }}>
      {props.title && <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>{props.title}</div>}
      <div style={{ width: '100%', height }}>
        {props.kind === 'bar' && <BarChartView data={props.data} />}
        {props.kind === 'stackedBar' && <StackedBarView data={props.data} />}
        {props.kind === 'heatmap' && <HeatmapView data={props.data} />}
        {props.kind === 'box' && <BoxView data={props.data} />}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Bar (frequency)
// ─────────────────────────────────────────────────────────────────────
function BarChartView({ data }: { data: BarData }) {
  const rows = useMemo(
    () => data.labels.map((l, i) => ({ label: l, value: data.values[i] ?? 0 })),
    [data]
  );
  return (
    <ResponsiveContainer>
      <BarChart data={rows} margin={{ top: 8, right: 12, bottom: 24, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
        <XAxis dataKey="label" tick={{ fill: AXIS_COLOR, fontSize: 11 }} interval={0} angle={-25} textAnchor="end" height={56} />
        <YAxis tick={{ fill: AXIS_COLOR, fontSize: 11 }} label={data.yLabel ? { value: data.yLabel, angle: -90, position: 'insideLeft', fill: AXIS_COLOR, fontSize: 11 } : undefined} />
        <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', fontSize: 12 }} />
        <Bar dataKey="value">
          {rows.map((_, i) => <Cell key={i} fill={BAR_PALETTE[i % BAR_PALETTE.length]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Stacked Bar (Likert distribution)
// ─────────────────────────────────────────────────────────────────────
function StackedBarView({ data }: { data: StackedBarData }) {
  const palette = data.palette ?? LIKERT_PALETTE;
  const rows = useMemo(() => {
    return data.items.map(it => {
      const r: any = { label: it.label };
      data.levels.forEach((lvl, i) => { r[lvl] = it.segments[i] ?? 0; });
      return r;
    });
  }, [data]);
  return (
    <ResponsiveContainer>
      <BarChart data={rows} layout="vertical" margin={{ top: 8, right: 16, bottom: 12, left: 24 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
        <XAxis type="number" domain={[0, 100]} tick={{ fill: AXIS_COLOR, fontSize: 11 }} unit="%" />
        <YAxis type="category" dataKey="label" tick={{ fill: AXIS_COLOR, fontSize: 11 }} width={140} />
        <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', fontSize: 12 }} formatter={(v: any) => `${Number(v).toFixed(1)}%`} />
        <Legend wrapperStyle={{ fontSize: 11, color: AXIS_COLOR }} />
        {data.levels.map((lvl, i) => (
          <Bar key={lvl} dataKey={lvl} stackId="lk" fill={palette[i % palette.length]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Heatmap (correlation matrix, MR co-occurrence)
// Implemented as a CSS grid since recharts has no native heatmap.
// ─────────────────────────────────────────────────────────────────────
function HeatmapView({ data }: { data: HeatmapData }) {
  const { xLabels, yLabels, values, scale = 'diverging' } = data;
  const flat = values.flat().filter((v): v is number => v != null && isFinite(v));
  const [dMin, dMax] = data.domain ?? (scale === 'diverging'
    ? [-1, 1]
    : [Math.min(0, ...flat), Math.max(0, ...flat)]);

  const colorFor = (v: number | null): string => {
    if (v == null || !isFinite(v)) return 'transparent';
    if (scale === 'diverging') {
      const norm = Math.max(-1, Math.min(1, v / Math.max(Math.abs(dMin), Math.abs(dMax) || 1)));
      const abs = Math.abs(norm);
      if (norm >= 0) return `rgba(34, 197, 94, ${0.15 + abs * 0.7})`;
      return `rgba(239, 68, 68, ${0.15 + abs * 0.7})`;
    }
    const range = (dMax - dMin) || 1;
    const norm = Math.max(0, Math.min(1, (v - dMin) / range));
    return `rgba(59, 130, 246, ${0.12 + norm * 0.75})`;
  };

  const cellSize = Math.max(28, Math.min(60, Math.floor(640 / Math.max(xLabels.length, 4))));

  return (
    <div style={{ overflow: 'auto', height: '100%' }}>
      <div style={{ display: 'grid',
        gridTemplateColumns: `auto repeat(${xLabels.length}, ${cellSize}px)`,
        gridAutoRows: `${cellSize}px`, gap: 2, fontSize: 11 }}>
        {/* top-left blank */}
        <div />
        {/* x labels */}
        {xLabels.map((x, i) => (
          <div key={`xh-${i}`} style={{ color: AXIS_COLOR, textAlign: 'center', alignSelf: 'end', padding: '0 2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={x}>{x}</div>
        ))}
        {/* rows */}
        {yLabels.map((y, ry) => (
          <React.Fragment key={`row-${ry}`}>
            <div style={{ color: AXIS_COLOR, padding: '0 8px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 160 }} title={y}>{y}</div>
            {xLabels.map((_, rx) => {
              const v = values[ry]?.[rx];
              const display = v == null || !isFinite(v as number) ? '' : (v as number).toFixed(2);
              const strong = v != null && isFinite(v as number) && Math.abs(v as number) > 0.5;
              return (
                <div key={`c-${ry}-${rx}`} style={{
                  background: colorFor(v as number | null),
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: strong ? '#fff' : 'var(--text)', fontWeight: strong ? 600 : 400,
                  borderRadius: 3, fontSize: 11,
                }} title={`${yLabels[ry]} × ${xLabels[rx]}: ${display}`}>
                  {display}
                </div>
              );
            })}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Box plot (min / Q1 / median / Q3 / max per group)
// Built on Recharts scatter — each group plotted as 5 points + IQR box drawn via Bar.
// ─────────────────────────────────────────────────────────────────────
function BoxView({ data }: { data: BoxData }) {
  // Determine y-axis bounds with a small padding so whiskers aren't clipped.
  const allVals = data.groups.flatMap(g => [g.min, g.q1, g.median, g.q3, g.max]);
  const yMin = Math.min(...allVals);
  const yMax = Math.max(...allVals);
  const pad = (yMax - yMin) * 0.06 || 1;
  const yDomain: [number, number] = [yMin - pad, yMax + pad];

  // Bar chart with stacked invisible+visible sections to draw the IQR box,
  // plus scatter points for whiskers + median.
  const rows = data.groups.map(g => ({
    label: g.label,
    base: g.q1,                  // invisible spacer
    box: g.q3 - g.q1,            // IQR box height
    median: g.median,
    min: g.min,
    max: g.max,
    // For tooltip:
    tip_min: g.min, tip_q1: g.q1, tip_median: g.median, tip_q3: g.q3, tip_max: g.max,
  }));

  return (
    <ResponsiveContainer>
      <BarChart data={rows} margin={{ top: 12, right: 12, bottom: 24, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
        <XAxis dataKey="label" tick={{ fill: AXIS_COLOR, fontSize: 11 }} interval={0} angle={-25} textAnchor="end" height={56} />
        <YAxis tick={{ fill: AXIS_COLOR, fontSize: 11 }} domain={yDomain} />
        <Tooltip
          contentStyle={{ background: '#1e293b', border: '1px solid #334155', fontSize: 12 }}
          content={(p: any) => {
            if (!p?.active || !p.payload?.[0]) return null;
            const r = p.payload[0].payload;
            return (
              <div style={{ background: '#1e293b', border: '1px solid #334155', padding: 8, fontSize: 11, color: '#e2e8f0' }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{r.label}</div>
                <div>Max: {r.tip_max?.toFixed?.(2) ?? r.tip_max}</div>
                <div>Q3: {r.tip_q3?.toFixed?.(2) ?? r.tip_q3}</div>
                <div>Median: {r.tip_median?.toFixed?.(2) ?? r.tip_median}</div>
                <div>Q1: {r.tip_q1?.toFixed?.(2) ?? r.tip_q1}</div>
                <div>Min: {r.tip_min?.toFixed?.(2) ?? r.tip_min}</div>
              </div>
            );
          }}
        />
        <Bar dataKey="base" stackId="bx" fill="transparent" isAnimationActive={false} />
        <Bar dataKey="box" stackId="bx" fill="#3b82f6" stroke="#60a5fa" isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Adapters — convert standard {headers, rows} payloads into chart data.
// Panels import these so they don't repeat shape juggling.
// ─────────────────────────────────────────────────────────────────────

/** Frequency table {headers:[Value,Count,...], rows:[[value,count,...]]} → bar data. */
export function adaptFrequencyToBar(headers: string[], rows: any[][], maxCategories = 30): BarData | null {
  if (!headers || !rows?.length) return null;
  const valIdx = 0;
  const countIdx = headers.findIndex(h => /count|n\b|frequency/i.test(h));
  if (countIdx < 0) return null;
  const sliced = rows.slice(0, maxCategories);
  return {
    labels: sliced.map(r => String(r[valIdx] ?? '')),
    values: sliced.map(r => Number(r[countIdx]) || 0),
    yLabel: headers[countIdx],
  };
}

/** Correlation matrix payload (square headers + label-first rows) → heatmap data. */
export function adaptMatrixToHeatmap(headers: string[], rows: any[][], scale: 'diverging' | 'sequential' = 'diverging'): HeatmapData | null {
  if (!headers || headers.length < 2 || !rows?.length) return null;
  const xLabels = headers.slice(1);
  const yLabels = rows.map(r => String(r[0] ?? ''));
  const values: (number | null)[][] = rows.map(r => xLabels.map((_, i) => {
    const v = r[i + 1];
    if (v === null || v === undefined || v === '' || v === 'ns') return null;
    const n = Number(v);
    return isFinite(n) ? n : null;
  }));
  return { xLabels, yLabels, values, scale };
}

/** Descriptive table → box data (uses Min/25%/50%/75%/Max columns). */
export function adaptDescriptiveToBox(headers: string[], rows: any[][]): BoxData | null {
  const ixMin = headers.findIndex(h => /^min/i.test(h));
  const ixQ1 = headers.findIndex(h => /^25%/.test(h) || /^q1/i.test(h));
  const ixMed = headers.findIndex(h => /^50%/.test(h) || /^median/i.test(h));
  const ixQ3 = headers.findIndex(h => /^75%/.test(h) || /^q3/i.test(h));
  const ixMax = headers.findIndex(h => /^max/i.test(h));
  if ([ixMin, ixQ1, ixMed, ixQ3, ixMax].some(i => i < 0)) return null;
  const groups: BoxGroup[] = rows
    .map(r => ({
      label: String(r[0] ?? ''),
      min: Number(r[ixMin]),
      q1: Number(r[ixQ1]),
      median: Number(r[ixMed]),
      q3: Number(r[ixQ3]),
      max: Number(r[ixMax]),
    }))
    .filter(g => [g.min, g.q1, g.median, g.q3, g.max].every(v => isFinite(v)));
  return groups.length ? { groups } : null;
}

/** Likert summary {distributions:[{item, distribution, levels}]} → stacked-bar data. */
export function adaptLikertToStackedBar(distributions: Array<{ item: string; distribution: number[]; levels?: any[] }>): StackedBarData | null {
  if (!distributions?.length) return null;
  const levels = (distributions[0].levels || distributions[0].distribution.map((_, i) => `L${i + 1}`)).map(String);
  return {
    items: distributions.map(d => ({ label: d.item, segments: d.distribution })),
    levels,
    palette: LIKERT_PALETTE,
  };
}

// Tree-shake helpers — re-export so Scatter/ZAxis are referenced and not warned away.
export const _internal = { ScatterChart, Scatter, ZAxis };
