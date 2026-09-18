// Shared between AutoAnalyzePanel's promote-time "combine into one table" and
// App.tsx's reload-time replay (rerunStatTables) — both need to turn a group
// of same-`kind` battery results into one table identically, or the numbers
// a user sees right after combining could drift from what they see after a
// reload/refresh recomputes the same recipe.

export interface BatteryResultLike {
  outcome?: string | null;
  label?: string;
  kind: string;
  params?: Record<string, any>;
  table?: { headers: string[]; rows: any[][] };
  interpretation?: string;
}

export interface BatteryConfig {
  kind: string;
  correction: string;
  specs: Array<{ outcome: string | null; params: Record<string, any>; label: string }>;
  datasetId?: string;
  computedAt?: string;
}

/** Union same-`kind` results into one table: a "Variable" column identifying
 * which outcome each row came from, prepended to that result's own headers
 * (guaranteed identical across a `kind` group — see EXECUTORS in
 * auto_analyze.py, one executor function per kind). */
export function combineResults(results: BatteryResultLike[]): { headers: string[]; rows: any[][]; interpretation: string } {
  const base = results.find(r => r.table?.headers?.length)?.table?.headers || [];
  const headers = ['Variable', ...base];
  const rows = results.flatMap(r =>
    (r.table?.rows || []).map(row => [r.outcome || r.label || '', ...row])
  );
  const interpretation = results
    .map(r => `${r.outcome || r.label || ''}: ${r.interpretation || ''}`)
    .join('\n\n');
  return { headers, rows, interpretation };
}

/** The exact specs needed to replay this group later via /api/analyze/rerun-specs. */
export function buildBatteryRecipe(kind: string, correction: string, results: BatteryResultLike[]): Omit<BatteryConfig, 'datasetId' | 'computedAt'> {
  return {
    kind,
    correction,
    specs: results.map(r => ({ outcome: r.outcome ?? null, params: r.params || {}, label: r.label || '' })),
  };
}
