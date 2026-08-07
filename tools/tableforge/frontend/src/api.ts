// import.meta.env.BASE_URL is '/' in dev, '/analyzer/' in production build
export const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, '') + '/api';

// ── Authenticated identity ────────────────────────────────────────────────────
// Identity flows ONLY through the verified FG token. We never send (or trust) a
// user_id / user_role from the URL or localStorage — those were spoofable and
// leaked the super-admin's projects across users on a shared browser.
let _fgToken: string | null = null;
let _fgBaseUrl: string | null = null;

const FG_TOKEN_KEY = 'tf_fg_token';
const FG_BASE_KEY = 'tf_fg_base';

// Capture the token from the launch URL at module load — before <App> strips the
// query string — so the first request already carries it. Persist it to
// sessionStorage so a page refresh / internal navigation keeps the session
// instead of silently dropping auth (which previously left the tool open).
(function initFgAuth() {
  try {
    const p = new URLSearchParams(window.location.search);
    const t = p.get('token');
    if (t) {
      _fgToken = t;
      _fgBaseUrl = p.get('fg_url');
      try {
        sessionStorage.setItem(FG_TOKEN_KEY, t);
        if (_fgBaseUrl) sessionStorage.setItem(FG_BASE_KEY, _fgBaseUrl);
      } catch { /* storage disabled */ }
      // Strip the token (and other handoff params) from the address bar at the
      // earliest possible moment — before React mounts — so the JWT doesn't sit
      // in the URL / browser history. The URL collapses to e.g. "/analyzer/".
      try {
        window.history.replaceState(null, '', window.location.pathname);
      } catch { /* no-op */ }
    } else {
      _fgToken = sessionStorage.getItem(FG_TOKEN_KEY);
      _fgBaseUrl = sessionStorage.getItem(FG_BASE_KEY);
    }
  } catch { /* no-op */ }
})();

export function setFgAuth(token: string | null, baseUrl: string | null) {
  _fgToken = token || null;
  _fgBaseUrl = baseUrl || null;
  try {
    if (token) sessionStorage.setItem(FG_TOKEN_KEY, token);
    else sessionStorage.removeItem(FG_TOKEN_KEY);
    if (baseUrl) sessionStorage.setItem(FG_BASE_KEY, baseUrl);
    else sessionStorage.removeItem(FG_BASE_KEY);
  } catch { /* storage disabled */ }
}

// ── Client-side auth gate helpers ─────────────────────────────────────────────
// The backend re-verifies the token on every request (the real boundary); these
// helpers only decide whether to render the tool or a "please log in" screen.
export function hasValidToken(): boolean {
  if (!_fgToken) return false;
  try {
    const payload = JSON.parse(atob(_fgToken.split('.')[1] || ''));
    if (payload && payload.exp && Date.now() / 1000 >= payload.exp) return false;
  } catch { return false; }
  return true;
}

export function clearFgAuth() { setFgAuth(null, null); }

// Where to send an unauthenticated visitor to log in — the main FieldGovern app.
export function getFgLoginUrl(): string {
  const base = (_fgBaseUrl || (typeof window !== 'undefined' ? window.location.origin : '')).replace(/\/$/, '');
  return `${base}/login`;
}

// ── Silent token refresh ────────────────────────────────────────────────────
// The token handed off at launch is a snapshot — it expires after 2h
// (JWT_EXPIRE_MINUTES) with no way for this tool to renew it on its own. But the
// tool is served same-origin with the main FieldGovern app, so the main app's
// refresh token (in localStorage, 30-day validity) is directly readable here.
// Without this, every autosave/save silently 401s for the rest of a multi-hour
// or multi-day session.
const FP_TOKEN_KEY = 'fp_token';
const FP_REFRESH_KEY = 'fp_refresh_token';
const FP_USER_KEY = 'fp_user';

let _isRefreshing = false;
let _refreshQueue: ((token: string | null) => void)[] = [];

function _drainRefreshQueue(token: string | null) {
  _refreshQueue.forEach(cb => cb(token));
  _refreshQueue = [];
}

// `origFetch` must be the unpatched fetch — calling the patched window.fetch
// here would recurse into this same refresh logic on a failed refresh.
async function _refreshFgToken(origFetch: typeof window.fetch): Promise<string | null> {
  if (_isRefreshing) {
    return new Promise(resolve => { _refreshQueue.push(resolve); });
  }
  _isRefreshing = true;
  try {
    let storedRefresh: string | null = null;
    try { storedRefresh = localStorage.getItem(FP_REFRESH_KEY); } catch { /* storage disabled */ }
    if (!storedRefresh) { _drainRefreshQueue(null); return null; }

    const base = (_fgBaseUrl || (typeof window !== 'undefined' ? window.location.origin : '')).replace(/\/$/, '');
    const res = await origFetch(`${base}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: storedRefresh }),
    });
    if (!res.ok) { _drainRefreshQueue(null); return null; }
    const data = await res.json();
    if (!data.access_token) { _drainRefreshQueue(null); return null; }

    setFgAuth(data.access_token, _fgBaseUrl);
    try {
      localStorage.setItem(FP_TOKEN_KEY, data.access_token);
      if (data.refresh_token) localStorage.setItem(FP_REFRESH_KEY, data.refresh_token);
      const rawUser = localStorage.getItem(FP_USER_KEY);
      if (rawUser) {
        const user = JSON.parse(rawUser);
        localStorage.setItem(FP_USER_KEY, JSON.stringify({ ...user, access_token: data.access_token }));
      }
    } catch { /* main-app sync failed — tool still works via sessionStorage */ }

    _drainRefreshQueue(data.access_token);
    return data.access_token;
  } catch {
    _drainRefreshQueue(null);
    return null;
  } finally {
    _isRefreshing = false;
  }
}

// Inject the FG token into every same-origin /api request, and transparently
// refresh + retry once on a 401. Centralised here so individual call sites
// don't each have to remember to attach auth headers or handle expiry — a
// missed one previously meant that endpoint was reachable anonymously, and an
// unhandled 401 previously meant a save silently vanished.
if (typeof window !== 'undefined' && !(window as any).__tfFetchPatched) {
  const _origFetch = window.fetch.bind(window);

  const _fetchWithAuth = async (input: any, init: any = {}): Promise<Response> => {
    try {
      const reqUrl = typeof input === 'string' ? input : (input && input.url) || '';
      if (_fgToken && typeof reqUrl === 'string' && reqUrl.includes('/api')) {
        const h = new Headers(init.headers || (typeof input !== 'string' ? input.headers : undefined) || {});
        if (!h.has('Authorization')) h.set('Authorization', `Bearer ${_fgToken}`);
        if (_fgBaseUrl && !h.has('X-FG-Base-Url')) h.set('X-FG-Base-Url', _fgBaseUrl);
        init = { ...init, headers: h };
      }
    } catch { /* fall through to original fetch */ }

    const res = await _origFetch(input, init);

    const reqUrl = typeof input === 'string' ? input : (input && input.url) || '';
    if (res.status === 401 && typeof reqUrl === 'string' && reqUrl.includes('/api') && !init.__tfRetried) {
      const newToken = await _refreshFgToken(_origFetch);
      if (newToken) {
        const h = new Headers(init.headers || {});
        h.set('Authorization', `Bearer ${newToken}`);
        return _origFetch(input, { ...init, headers: h, __tfRetried: true });
      }
    }
    return res;
  };

  window.fetch = _fetchWithAuth as typeof window.fetch;
  (window as any).__tfFetchPatched = true;
}

// XHR uploads bypass the fetch wrapper, so attach the header explicitly.
function applyAuthToXhr(xhr: XMLHttpRequest) {
  if (_fgToken) {
    xhr.setRequestHeader('Authorization', `Bearer ${_fgToken}`);
    if (_fgBaseUrl) xhr.setRequestHeader('X-FG-Base-Url', _fgBaseUrl);
  }
}

export function getUserHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (_fgToken) {
    headers['Authorization'] = `Bearer ${_fgToken}`;
    if (_fgBaseUrl) headers['X-FG-Base-Url'] = _fgBaseUrl;
  }
  return headers;
}

// Role is read from the current token's payload for UI hints only — the backend
// independently re-verifies the token, so a tampered payload grants nothing.
function tokenRole(): string {
  if (!_fgToken) return '';
  try {
    return JSON.parse(atob(_fgToken.split('.')[1] || '')).role || '';
  } catch { return ''; }
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
    applyAuthToXhr(xhr);
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
  values: { field: string; agg: string; label?: string; suppress_below_n?: number; [key: string]: any }[];
  filters: Record<string, string[]>;
  column_type_overrides?: Record<string, string>;
  grand_total: boolean;
  grand_total_rows?: boolean;
  grand_total_columns?: boolean;
  grand_total_combined?: boolean;
  grand_total_agg?: 'auto' | 'sum' | 'average';
  subtotals: boolean;
  subtotal_pct_base?: string;
  missing_data: string;
  sort_by?: string;
  sort_order?: string;
  multi_sort?: { field: string; order: 'asc' | 'desc' }[];
  date_groupings?: Record<string, string>;
  blank_suppress?: boolean;
  hide_subgroup?: boolean;
  net_rows?: { label: string; members: string[]; position?: 'after_last_member' | 'before_first_member' | 'end' }[];
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

export async function dryRunColumnType(datasetId: string, column: string, newType: string):
  Promise<{ dry_run: true; column: string; new_type: string; total: number; non_null: number; fail_count: number; samples: string[]; failing_cells?: { row: number; value: string }[] }> {
  const res = await fetch(`${API_BASE}/dataset/column_type`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataset_id: datasetId, column, new_type: newType, dry_run: true }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function detectAnomalies(
  datasetId: string,
  method: 'zscore' | 'mad' = 'zscore',
  threshold: number = 3.0,
): Promise<{
  columns: Record<string, { indices: number[]; values: (number | null)[]; scores: (number | null)[]; count: number; total: number; method: string; threshold: number }>;
  method: string;
  threshold: number;
}> {
  const url = `${API_BASE}/dataset/${datasetId}/anomalies?method=${method}&threshold=${threshold}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function getColumnTypeHints(datasetId: string):
  Promise<{ hints: { column: string; suggested_type: 'numeric' | 'date'; success_rate: number; fail_count: number; samples: string[] }[] }> {
  const res = await fetch(`${API_BASE}/dataset/${datasetId}/type_hints`);
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

export async function renameProject(path: string, newName: string) {
  const res = await fetch(`${API_BASE}/project/rename`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getUserHeaders() },
    body: JSON.stringify({ path, new_name: newName }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function deleteProject(path: string) {
  const res = await fetch(`${API_BASE}/project/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getUserHeaders() },
    body: JSON.stringify({ path }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export function getUserRole(): string {
  return tokenRole();
}

export function isSuperAdmin(): boolean {
  return tokenRole() === 'master_admin';
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

export async function getProjectVersions(path: string):
  Promise<{ versions: { saved_at: string; tables: any[]; annotationsMap?: any }[] }> {
  const url = `${API_BASE}/project/versions?path=${encodeURIComponent(path)}`;
  const res = await fetch(url, { headers: getUserHeaders() });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function diffProjectVersions(path: string, left: number, right: number):
  Promise<{
    left: { index: number; saved_at: string };
    right: { index: number; saved_at: string };
    added: { id: string; name: string }[];
    removed: { id: string; name: string }[];
    changed: { id: string; name: string; changes: { field: string; before: any; after: any }[] }[];
    summary: { added: number; removed: number; changed: number; total_left: number; total_right: number };
  }> {
  const url = `${API_BASE}/project/diff?path=${encodeURIComponent(path)}&left=${left}&right=${right}`;
  const res = await fetch(url, { headers: getUserHeaders() });
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

export async function fgListUserProjects(fgUrl: string, token: string, tool = 'analyzer', archived = false) {
  const res = await fetch(`${API_BASE}/fg/user-projects/list`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fg_base_url: fgUrl, token, tool, archived }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<{ id: string; name: string; program_id: string | null; data: any; updated_at: string; archived_at?: string | null }[]>;
}

export async function fgArchiveProject(fgUrl: string, token: string, projectId: string) {
  const res = await fetch(`${API_BASE}/fg/user-projects/archive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fg_base_url: fgUrl, token, project_id: projectId }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function fgRestoreProject(fgUrl: string, token: string, projectId: string) {
  const res = await fetch(`${API_BASE}/fg/user-projects/restore`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fg_base_url: fgUrl, token, project_id: projectId }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
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

// ── Server File Storage ─────────────────────────────────────────────────────

export interface ServerFile {
  id: string;
  original_name: string;
  stored_name: string;
  size_bytes: number;
  size_mb: number;
  uploaded_at: string;
  ext: string;
}

export async function uploadToServer(file: File, onProgress?: (pct: number) => void) {
  const formData = new FormData();
  formData.append('file', file);
  return new Promise<{ message: string; file: ServerFile }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}/files/upload`);
    applyAuthToXhr(xhr);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); } catch { reject(new Error('Invalid response')); }
      } else {
        try { const err = JSON.parse(xhr.responseText); reject(new Error(err.detail || `HTTP ${xhr.status}`)); }
        catch { reject(new Error(xhr.responseText || `HTTP ${xhr.status}`)); }
      }
    };
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.send(formData);
  });
}

export async function listServerFiles(): Promise<{ files: ServerFile[] }> {
  const res = await fetch(`${API_BASE}/files`);
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function deleteServerFile(fileId: string) {
  const res = await fetch(`${API_BASE}/files/${fileId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function loadServerFile(fileId: string) {
  const res = await fetch(`${API_BASE}/files/${fileId}/load`, { method: 'POST' });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
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

// Module A: Multi-Sheet Union (concat / join_inner / join_outer)
export async function unionSheets(
  datasetId: string,
  sheetNames: string[],
  mode: 'concat' | 'join_inner' | 'join_outer' = 'concat',
  joinOn?: string[],
) {
  const res = await fetch(`${API_BASE}/upload/union`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataset_id: datasetId, sheet_names: sheetNames, mode, join_on: joinOn }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

// Module A: Per-sheet columns + auto-detected common columns
export async function sheetsInfo(datasetId: string, sheetNames: string[]):
  Promise<{ per_sheet: Record<string, string[]>; common_columns: string[] }> {
  const res = await fetch(`${API_BASE}/upload/sheets_info`, {
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

// ── Survey Analysis Studio: metadata layer (Phase 0) ────────────────────────
import type { ColumnRole, StudyDesign, AutoDetectResult } from './types';

export async function getColumnRoles(datasetId: string): Promise<{ roles: Record<string, ColumnRole> }> {
  const res = await fetch(`${API_BASE}/metadata/column/${datasetId}`);
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function setColumnRole(datasetId: string, column: string, role: ColumnRole) {
  const res = await fetch(`${API_BASE}/metadata/column/set`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataset_id: datasetId, column, role }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function bulkSetColumnRoles(datasetId: string, roles: Record<string, ColumnRole>) {
  const res = await fetch(`${API_BASE}/metadata/column/bulk_set`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataset_id: datasetId, roles }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function deleteColumnRole(datasetId: string, column: string) {
  const res = await fetch(`${API_BASE}/metadata/column/${datasetId}/${encodeURIComponent(column)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function saveStudyDesign(datasetId: string, design: StudyDesign) {
  const res = await fetch(`${API_BASE}/metadata/study_design/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataset_id: datasetId, design }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function getStudyDesign(datasetId: string): Promise<{ design: StudyDesign }> {
  const res = await fetch(`${API_BASE}/metadata/study_design/${datasetId}`);
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function autoDetectRoles(datasetId: string): Promise<AutoDetectResult> {
  const res = await fetch(`${API_BASE}/metadata/auto_detect_roles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataset_id: datasetId }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

// ── Phase 2 — Likert / Multi-Response / Observer ─────────────────────────────

async function postStat<T = any>(path: string, body: any): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export const likertApi = {
  summary: (b: any) => postStat('/likert/summary', b),
  composite: (b: any) => postStat('/likert/composite', b),
  compare: (b: any) => postStat('/likert/compare', b),
  factor: (b: any) => postStat('/likert/factor', b),
};

export const mrApi = {
  frequencies: (b: any) => postStat('/mr/frequencies', b),
  cooccurrence: (b: any) => postStat('/mr/cooccurrence', b),
  byGroup: (b: any) => postStat('/mr/by_group', b),
  exclusive: (b: any) => postStat('/mr/exclusive', b),
};

export const observerApi = {
  concordance: (b: any) => postStat('/observer/concordance', b),
  discrepancies: (b: any) => postStat('/observer/discrepancies', b),
};

export const sdqApi = {
  straightLining: (b: any) => postStat('/sdq/straight_lining', b),
  responseTime: (b: any) => postStat('/sdq/response_time', b),
  duplicates: (b: any) => postStat('/sdq/duplicates', b),
  missingness: (b: any) => postStat('/sdq/missingness', b),
  attentionChecks: (b: any) => postStat('/sdq/attention_checks', b),
  overview: (b: any) => postStat('/sdq/overview', b),
};

// ── Batch C/D/E — Balance, Geo, Driver, Cluster, Verbatim ────────────────────

export const balanceApi = {
  table: (b: any) => postStat('/balance/table', b),
};

export const geoApi = {
  aggregate: (b: any) => postStat('/geo/aggregate', b),
};

export const driverApi = {
  importance: (b: any) => postStat('/driver/importance', b),
};

export const clusterApi = {
  kmeans: (b: any) => postStat('/cluster/kmeans', b),
};

export const verbatimApi = {
  list: (b: any) => postStat('/verbatim/list', b),
  setCodes: (b: any) => postStat('/verbatim/codes/set', b),
  getCodes: async (datasetId: string) => {
    const res = await fetch(`${API_BASE}/verbatim/codes/${datasetId}`);
    if (!res.ok) throw new Error(await parseError(res));
    return res.json();
  },
  savePalette: (b: any) => postStat('/verbatim/palette/save', b),
  kappa: (b: any) => postStat('/verbatim/kappa', b),
};

// ── Cleaner handoff (TableForge ↔ datacleaner) ───────────────────────────────

export const cleanerApi = {
  /** Create a one-shot handoff token so the cleaner can pull + push this dataset. */
  handoff: async (datasetId: string, focusCol?: string): Promise<{ handoff_id: string; focus_col: string | null; ttl_seconds: number }> => {
    const res = await fetch(`${API_BASE}/cleaner/handoff`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataset_id: datasetId, focus_col: focusCol || null }),
    });
    if (!res.ok) throw new Error(await parseError(res));
    return res.json();
  },
  /** Polled fallback in case the cleaner's postMessage doesn't reach us (e.g. cross-origin restrictions). */
  status: async (handoffId: string) => {
    const res = await fetch(`${API_BASE}/cleaner/handoff/${handoffId}`);
    if (!res.ok) throw new Error(await parseError(res));
    return res.json() as Promise<{
      completed: boolean;
      completed_at: number | null;
      dataset_id: string;
      result: { row_count: number; columns: any[]; preview: any[] } | null;
    }>;
  },
  revoke: async (handoffId: string) => {
    await fetch(`${API_BASE}/cleaner/handoff/${handoffId}`, { method: 'DELETE' }).catch(() => {});
  },
};

/** Resolve the cleaner's base URL. Override via VITE_CLEANER_URL.
 * In production we assume the cleaner is co-deployed at /cleaner/ on the same origin.
 * In dev (Vite at :5173) we point at the cleaner's standalone port :5050.
 */
export function getCleanerBaseUrl(): string {
  const envUrl = (import.meta as any).env?.VITE_CLEANER_URL as string | undefined;
  if (envUrl) return envUrl.replace(/\/$/, '');
  if (typeof window !== 'undefined') {
    if (window.location.port === '5173') return 'http://localhost:5050';
    return `${window.location.origin}/cleaner`;
  }
  return '';
}

/** Build the cleaner URL with TF handoff params + optional column focus. */
export function buildCleanerUrl(handoffId: string, focusCol?: string): string {
  const base = getCleanerBaseUrl();
  const tfBase = API_BASE.replace(/\/api$/, '');
  const tfUrl = (typeof window !== 'undefined' ? window.location.origin : '') + tfBase;
  const params = new URLSearchParams({ tf_url: tfUrl, handoff_id: handoffId });
  if (focusCol) params.set('focus_col', focusCol);
  return `${base}/?${params.toString()}`;
}

// ── Phase 3 — Auto-Analyze battery ───────────────────────────────────────────

export interface AutoAnalyzeConfig {
  dataset_id: string;
  outcome_cols: string[];
  predictor_cols?: string[];
  correction?: 'fdr_bh' | 'bonferroni' | 'holm' | 'none';
  use_design?: boolean;
  filters?: Record<string, string[]>;
}

export async function planBattery(config: AutoAnalyzeConfig) {
  return postStat('/analyze/plan', config);
}

export interface SkippedColumn {
  outcome: string | null;
  predictor: string | null;
  reason: string;
}

export interface BatteryProgress {
  step: 'start' | 'progress' | 'done';
  idx?: number;
  total?: number;
  label?: string;
  kind?: string;
  p_raw?: number | null;
  error?: string;
  skipped?: boolean;
  /** Only present on the 'start' event — outcome/predictor pairs the planner
   * considered but found no applicable test for, and why. */
  skipped_columns?: SkippedColumn[];
  results?: any[];
  correction?: string;
  design_used?: boolean;
}

/** SSE-streamed auto-battery executor. `onEvent` fires for every event. */
export async function runAutoBattery(
  config: AutoAnalyzeConfig,
  onEvent: (e: BatteryProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${API_BASE}/analyze/auto-battery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(await parseError(res));
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n\n');
    buf = lines.pop() || '';
    for (const block of lines) {
      const line = block.trim();
      if (!line.startsWith('data:')) continue;
      try {
        const event = JSON.parse(line.slice(5).trim());
        onEvent(event);
      } catch { /* ignore parse error on partial frame */ }
    }
  }
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

// #14 Survey-aware mode — crosstab suggestions driven by auto-detected column roles.
export interface SurveySuggestion {
  title: string;
  description: string;
  rationale: string;
  kind: string;
  rows: string[];
  columns: string[];
  value_field: string;
  aggregation: string;
  show_as: string | null;
}

export async function suggestSurveyCrosstabs(datasetId: string, maxSuggestions = 20):
  Promise<{ suggestions: SurveySuggestion[]; detected: Record<string, any>; roles_count: number }> {
  const res = await fetch(`${API_BASE}/survey/suggest_crosstabs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataset_id: datasetId, max_suggestions: maxSuggestions }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}
