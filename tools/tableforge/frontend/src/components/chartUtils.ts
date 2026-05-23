// Shared chart rendering helpers used by both the full ChartBuilder modal
// and the InlineChartPreview that renders charts under each table.

export type ChartType =
  | 'bar' | 'bar_h' | 'stacked' | 'grouped'
  | 'line' | 'area' | 'pie' | 'donut' | 'scatter'
  | 'waterfall' | 'combo' | 'heatmap' | 'correlation';

export type LegendPos = 'right' | 'bottom' | 'top' | 'none';

export const CHART_TYPES: { value: ChartType; label: string; icon: string }[] = [
  { value: 'bar',         label: 'Bar',          icon: '▐▐▐' },
  { value: 'bar_h',       label: 'Horizontal',   icon: '≡' },
  { value: 'stacked',     label: 'Stacked',      icon: '▊' },
  { value: 'grouped',     label: 'Grouped',      icon: '▐▌' },
  { value: 'line',        label: 'Line',         icon: '∿' },
  { value: 'area',        label: 'Area',         icon: '◟◝' },
  { value: 'combo',       label: 'Combo',        icon: '▐∿' },
  { value: 'pie',         label: 'Pie',          icon: '◔' },
  { value: 'donut',       label: 'Donut',        icon: '⊙' },
  { value: 'scatter',     label: 'Scatter',      icon: '∴' },
  { value: 'waterfall',   label: 'Waterfall',    icon: '⤵' },
  { value: 'heatmap',     label: 'Heatmap',      icon: '⊞' },
  { value: 'correlation', label: 'Correlation',  icon: '◉' },
];

export const PALETTES: { name: string; colors: string[] }[] = [
  { name: 'Blueprint', colors: ['#3b82f6','#60a5fa','#93c5fd','#1d4ed8','#2563eb','#6366f1','#8b5cf6'] },
  { name: 'Emerald',   colors: ['#10b981','#34d399','#6ee7b7','#059669','#047857','#065f46','#0d9488'] },
  { name: 'Sunset',    colors: ['#f97316','#fb923c','#fdba74','#ef4444','#f59e0b','#eab308','#84cc16'] },
  { name: 'Lavender',  colors: ['#8b5cf6','#a78bfa','#c4b5fd','#7c3aed','#6d28d9','#ec4899','#f472b6'] },
  { name: 'Mono',      colors: ['#e2e8f0','#cbd5e1','#94a3b8','#64748b','#475569','#334155','#1e293b'] },
  { name: 'Corporate', colors: ['#1e3a5f','#4a90d9','#7ab3ef','#2c5f2d','#97bc62','#d4a017','#c75b12'] },
  // — new vibrant / categorical palettes ——————————————————————————————
  { name: 'Vibrant',   colors: ['#ef4444','#f59e0b','#10b981','#3b82f6','#8b5cf6','#ec4899','#06b6d4'] },
  { name: 'Categorical', colors: ['#4e79a7','#f28e2c','#e15759','#76b7b2','#59a14f','#edc949','#af7aa1','#ff9da7','#9c755f','#bab0ab'] },
  { name: 'Pastel',    colors: ['#fbb4ae','#b3cde3','#ccebc5','#decbe4','#fed9a6','#ffffcc','#e5d8bd','#fddaec'] },
  { name: 'Viridis',   colors: ['#440154','#482878','#3e4989','#31688e','#26828e','#1f9e89','#35b779','#6ece58','#b5de2b','#fde725'] },
  { name: 'Ocean',     colors: ['#0c4a6e','#0369a1','#0284c7','#0ea5e9','#38bdf8','#7dd3fc','#bae6fd','#06b6d4','#22d3ee','#67e8f9'] },
  { name: 'Forest',    colors: ['#14532d','#166534','#15803d','#16a34a','#22c55e','#4ade80','#86efac','#65a30d','#84cc16','#a3e635'] },
  { name: 'Warm',      colors: ['#7c2d12','#9a3412','#c2410c','#ea580c','#f97316','#fb923c','#fdba74','#fed7aa','#f59e0b','#fbbf24'] },
  { name: 'Berry',     colors: ['#831843','#9d174d','#be185d','#db2777','#ec4899','#f472b6','#f9a8d4','#7c3aed','#a855f7','#c084fc'] },
];

export function paletteColorsByName(name: string | undefined, fallback = PALETTES[0]): string[] {
  if (!name) return fallback.colors;
  return (PALETTES.find(p => p.name === name) || fallback).colors;
}

export function nice(v: number, up = true): number {
  if (v === 0) return 0;
  const exp = Math.pow(10, Math.floor(Math.log10(Math.abs(v))));
  const f = v / exp;
  const nf = up ? Math.ceil(f) : Math.floor(f);
  return nf * exp;
}

export function ticksArr(min: number, max: number, count = 5): number[] {
  const range = nice(max - min, true) || 1;
  const step = nice(range / count, true) || 1;
  const t: number[] = [];
  const start = Math.floor(min / step) * step;
  for (let v = start; v <= max + step * 0.01; v += step) t.push(parseFloat(v.toFixed(10)));
  return t;
}

export function fmt(n: number): string {
  if (!isFinite(n)) return '–';
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

export function arcPath(cx: number, cy: number, r: number, startAngle: number, endAngle: number, inner = 0): string {
  const s = { x: cx + r * Math.cos(startAngle), y: cy + r * Math.sin(startAngle) };
  const e = { x: cx + r * Math.cos(endAngle),   y: cy + r * Math.sin(endAngle) };
  const large = endAngle - startAngle > Math.PI ? 1 : 0;
  if (inner === 0) return `M${cx},${cy} L${s.x},${s.y} A${r},${r} 0 ${large},1 ${e.x},${e.y} Z`;
  const si = { x: cx + inner * Math.cos(startAngle), y: cy + inner * Math.sin(startAngle) };
  const ei = { x: cx + inner * Math.cos(endAngle),   y: cy + inner * Math.sin(endAngle) };
  return `M${s.x},${s.y} A${r},${r} 0 ${large},1 ${e.x},${e.y} L${ei.x},${ei.y} A${inner},${inner} 0 ${large},0 ${si.x},${si.y} Z`;
}

// Robust numeric coercion that tolerates "23 (45.2%)", "1,234", "12%", trailing units, etc.
// Returns NaN if no leading number is found.
export function toNumber(v: any): number {
  if (typeof v === 'number') return v;
  if (v == null) return NaN;
  const s = String(v).trim();
  if (!s) return NaN;
  // Strip thousand separators, leading +, then parse the leading numeric part.
  const cleaned = s.replace(/,/g, '');
  const m = cleaned.match(/^[+-]?\d*\.?\d+(?:[eE][+-]?\d+)?/);
  if (!m) return NaN;
  const n = parseFloat(m[0]);
  return isFinite(n) ? n : NaN;
}

// Classify columns into text-like vs numeric-like, using a robust numeric coercion
// over the whole column (not just row 0) so formatted strings like "23 (45.2%)"
// still get recognised as numeric.
export function classifyColumns(headers: string[], rows: any[][]): { textCols: string[]; numCols: string[] } {
  const textCols: string[] = [];
  const numCols: string[] = [];
  if (!rows.length) return { textCols, numCols };
  for (let i = 0; i < headers.length; i++) {
    const sample = rows.slice(0, Math.min(rows.length, 25)).map(r => r[i]);
    const nonNull = sample.filter(v => v !== null && v !== undefined && v !== '');
    if (!nonNull.length) {
      // Empty column — treat as text to avoid auto-selecting
      textCols.push(headers[i]);
      continue;
    }
    const parseable = nonNull.filter(v => !isNaN(toNumber(v))).length;
    if (parseable / nonNull.length >= 0.7) numCols.push(headers[i]);
    else textCols.push(headers[i]);
  }
  return { textCols, numCols };
}

export const W_DEFAULT = 700;
export const H_DEFAULT = 340;
export const ML_DEFAULT = 62;
export const MR_DEFAULT = 24;
export const MT_DEFAULT = 28;
export const MB_DEFAULT = 60;

// Build the default chart title for a table — "Fig N: <table title>".
// If the table already has an explicit table_number, swap the "Table" prefix
// for "Fig". Otherwise fall back to a plain "Fig: <title>".
export function figTitleFromTable(t: { title?: string; name?: string; table_number?: string }): string {
  const base = (t.title || t.name || '').trim();
  if (!base) return '';
  const tn = (t.table_number || '').trim();
  if (tn) {
    const numClean = tn.replace(/^Table\s+/i, '').replace(/[:.\s]+$/, '').trim();
    const bareTitle = base.replace(/^Table\s+[^:]+:\s*/i, '').trim();
    return numClean ? `Fig ${numClean}: ${bareTitle}` : `Fig: ${bareTitle}`;
  }
  return `Fig: ${base}`;
}
