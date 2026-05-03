// import.meta.env.BASE_URL is '/' in dev, '/analyzer/' in production build
export const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, '') + '/api';

export function getUserHeaders(): Record<string, string> {
  const params = new URLSearchParams(window.location.search);
  const headers: Record<string, string> = {};
  const userId = params.get('user_id') || localStorage.getItem('tf_user_id') || '';
  const userRole = params.get('user_role') || localStorage.getItem('tf_user_role') || '';
  if (userId) { headers['X-User-Id'] = userId; localStorage.setItem('tf_user_id', userId); }
  if (userRole) { headers['X-User-Role'] = userRole; localStorage.setItem('tf_user_role', userRole); }
  return headers;
}

async function parseError(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const json = JSON.parse(text);
    return json.detail || json.message || text;
  } catch {
    return text || `HTTP ${res.status}`;
  }
}

export async function uploadFile(file: File, onProgress?: (pct: number) => void) {
  const formData = new FormData();
  formData.append('file', file);
  return new Promise<any>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}/upload`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); }
        catch { reject(new Error('Invalid response')); }
      } else {
        try {
          const err = JSON.parse(xhr.responseText);
          reject(new Error(err.detail || err.message || `HTTP ${xhr.status}`));
        } catch { reject(new Error(xhr.responseText || `HTTP ${xhr.status}`)); }
      }
    };
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.send(formData);
  });
}

export async function tabulate(config: {
  dataset_id: string;
  rows: string[];
  columns: string[];
  values: { field: string; agg: string; label?: string }[];
  filters: Record<string, string[]>;
  grand_total: boolean;
  grand_total_rows?: boolean;
  grand_total_columns?: boolean;
  subtotals: boolean;
  missing_data: string;
  sort_by?: string;
  sort_order?: string;
  multi_sort?: { field: string; order: 'asc' | 'desc' }[];
  date_groupings?: Record<string, string>;
  blank_suppress?: boolean;
}) {
  const res = await fetch(`${API_BASE}/tabulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function getColumnValues(datasetId: string, columnName: string) {
  // Use a query parameter so column names containing "/" don't break URL path routing.
  const res = await fetch(
    `${API_BASE}/dataset/${datasetId}/column-values?column=${encodeURIComponent(columnName)}`
  );
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function createMetric(datasetId: string, metric: any) {
  const res = await fetch(`${API_BASE}/metrics/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataset_id: datasetId, ...metric }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function changeColumnType(datasetId: string, column: string, newType: string) {
  const res = await fetch(`${API_BASE}/dataset/column_type`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataset_id: datasetId, column, new_type: newType }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function listMetrics(datasetId: string) {
  const res = await fetch(`${API_BASE}/metrics/${datasetId}`);
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function deleteMetric(datasetId: string, metricName: string) {
  const res = await fetch(`${API_BASE}/metrics/${datasetId}/${encodeURIComponent(metricName)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function createBin(datasetId: string, bin: any) {
  const res = await fetch(`${API_BASE}/bins/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataset_id: datasetId, ...bin }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function listBins(datasetId: string) {
  const res = await fetch(`${API_BASE}/bins/${datasetId}`);
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function deleteBin(datasetId: string, binName: string) {
  const res = await fetch(`${API_BASE}/bins/${datasetId}/${encodeURIComponent(binName)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function getDataQuality(datasetId: string) {
  const res = await fetch(`${API_BASE}/dataset/${datasetId}/quality`);
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function exportTables(config: {
  dataset_id: string;
  tables: { name: string; headers: string[]; rows: any[][]; title?: string; subtitle?: string }[];
  format: string;
  filename: string;
}) {
  const res = await fetch(`${API_BASE}/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function logAuditEvent(datasetId: string, action: string, details: string) {
  fetch(`${API_BASE}/audit/log`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataset_id: datasetId, action, details }),
  }).catch(() => {});
}

export async function saveProject(name: string, config: any) {
  const res = await fetch(`${API_BASE}/project/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getUserHeaders() },
    body: JSON.stringify({ name, config }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function listProjects() {
  const res = await fetch(`${API_BASE}/projects`, { headers: getUserHeaders() });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function rollbackProject(path: string, versionIndex: number) {
  const res = await fetch(`${API_BASE}/project/rollback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getUserHeaders() },
    body: JSON.stringify({ path, version_index: versionIndex }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

// ── FieldGovern API helpers ───────────────────────────────────────────────────

export async function fgListPrograms(fgUrl: string, token: string) {
  const res = await fetch(`${API_BASE}/fg/programs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fg_base_url: fgUrl, token }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<{ id: string; name: string; scheme_name: string }[]>;
}

export async function fgListQuestionnaires(fgUrl: string, token: string, programId: string) {
  const res = await fetch(`${API_BASE}/fg/questionnaires`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fg_base_url: fgUrl, token, program_id: programId }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<{ questionnaire_id: string; name: string; form_title: string }[]>;
}

export async function fgSaveProject(fgUrl: string, token: string, name: string, programId: string | null, data: any) {
  const res = await fetch(`${API_BASE}/fg/user-projects/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fg_base_url: fgUrl, token, tool: 'analyzer', name, program_id: programId, data }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function fgListUserProjects(fgUrl: string, token: string, tool = 'analyzer') {
  const res = await fetch(`${API_BASE}/fg/user-projects/list`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fg_base_url: fgUrl, token, tool }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<{ id: string; name: string; program_id: string | null; data: any; updated_at: string }[]>;
}

export interface FgProgressEvent {
  step: string;
  message: string;
  percent: number;
  result?: any;
}

export async function importFromFg(
  fgUrl: string, token: string, programId: string, questionnaireId?: string,
  onProgress?: (ev: FgProgressEvent) => void,
) {
  const body: any = { fg_base_url: fgUrl, program_id: programId, token };
  if (questionnaireId) body.questionnaire_id = questionnaireId;
  const res = await fetch(`${API_BASE}/import-from-fg`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await parseError(res));

  const reader = res.body?.getReader();
  if (!reader) throw new Error('No response stream');

  const decoder = new TextDecoder();
  let buffer = '';
  let finalResult: any = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try {
        const ev: FgProgressEvent = JSON.parse(line.slice(6));
        onProgress?.(ev);
        if (ev.step === 'error') throw new Error(ev.message);
        if (ev.step === 'done' && ev.result) finalResult = ev.result;
      } catch (e: any) {
        if (e.message && e.message !== 'Unexpected end of JSON input') throw e;
      }
    }
  }

  if (!finalResult) throw new Error('Import completed without result');
  return finalResult;
}

// Module A: Sheet Selection
export async function loadSheet(datasetId: string, sheetName: string) {
  const res = await fetch(`${API_BASE}/upload/sheet`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataset_id: datasetId, sheet_name: sheetName }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

// Module A: Column Rename / Exclude / Header Row
export async function modifyDataset(config: {
  dataset_id: string;
  renames?: Record<string, string>;
  exclude_columns?: string[];
  exclude_rows?: number[];
  header_row?: number | null;
}) {
  const res = await fetch(`${API_BASE}/dataset/modify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

// Module A: Multi-Sheet Union
export async function unionSheets(datasetId: string, sheetNames: string[]) {
  const res = await fetch(`${API_BASE}/upload/union`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataset_id: datasetId, sheet_names: sheetNames }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

// Module A: Data Refresh
export async function refreshDataset(datasetId: string) {
  const res = await fetch(`${API_BASE}/dataset/${datasetId}/refresh`, { method: 'POST' });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

// Export download (binary)
export async function downloadExport(config: {
  dataset_id: string;
  tables: { name: string; headers: string[]; rows: any[][]; title?: string; subtitle?: string }[];
  format: string;
  filename: string;
}) {
  const res = await fetch(`${API_BASE}/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res;
}
