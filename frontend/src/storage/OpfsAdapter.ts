/**
 * OpfsAdapter — OPFS + wa-sqlite implementation.
 * Primary storage for Android Chrome and desktop browsers.
 *
 * Spawns a DedicatedWorker that owns the SQLite connection (required because
 * FileSystemSyncAccessHandle is only available inside Workers). All queries
 * are proxied via a lightweight async RPC: { id, sql, params? } → { id, results?, error? }.
 */

import type { StorageAdapter, SubmissionRecord, StorageInfo, FormCache, MediaQueueItem } from './StorageAdapter'

interface SQLiteResultSet {
  columns: string[]
  rows: unknown[][]
}

interface WorkerResponse {
  id: number
  results?: SQLiteResultSet[]
  error?: string
}

export class OpfsAdapter implements StorageAdapter {
  private worker!: Worker
  private pending = new Map<number, { resolve: (r: SQLiteResultSet[]) => void; reject: (e: Error) => void }>()
  private nextId = 0

  async init(): Promise<void> {
    this.worker = new Worker(
      new URL('./sqlite.worker.ts', import.meta.url),
      { type: 'module' },
    )

    this.worker.addEventListener('message', (e: MessageEvent<WorkerResponse>) => {
      const { id, results, error } = e.data
      const p = this.pending.get(id)
      if (!p) return
      this.pending.delete(id)
      error ? p.reject(new Error(error)) : p.resolve(results ?? [])
    })

    this.worker.addEventListener('error', (e) => {
      console.error('[OpfsAdapter] Worker error', e.message)
    })

    // Warm-up: blocks until the Worker has finished its own init (schema creation)
    await this._query('SELECT 1')
    console.log('[OpfsAdapter] init — wa-sqlite/OPFS')
  }

  async requestPersistence(): Promise<boolean> {
    if (navigator.storage?.persist) return navigator.storage.persist()
    return false
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  private _query(sql: string, params?: unknown[]): Promise<SQLiteResultSet[]> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++
      this.pending.set(id, { resolve, reject })
      this.worker.postMessage({ id, sql, params })
    })
  }

  private _toRecord(columns: string[], row: unknown[]): SubmissionRecord {
    const c = Object.fromEntries(columns.map((k, i) => [k, row[i]]))
    return {
      id:          c['id'] as string,
      formId:      c['form_id'] as string,
      formVersion: c['form_version'] as number,
      data:        JSON.parse(c['data'] as string),
      gpsOpen:     c['gps_open']    ? JSON.parse(c['gps_open'] as string)    : undefined,
      gpsSubmit:   c['gps_submit']  ? JSON.parse(c['gps_submit'] as string)  : undefined,
      status:      c['status'] as SubmissionRecord['status'],
      createdAt:   c['created_at'] as string,
      updatedAt:   c['updated_at'] as string,
    }
  }

  private _rowsFromResult(res: SQLiteResultSet[]): SubmissionRecord[] {
    const set = res[0]
    if (!set?.rows.length) return []
    return set.rows.map(row => this._toRecord(set.columns, row))
  }

  // ── StorageAdapter implementation ───────────────────────────────────────

  async saveSubmission(record: SubmissionRecord): Promise<void> {
    await this._query(
      `INSERT OR REPLACE INTO submissions
         (id, form_id, form_version, data, gps_open, gps_submit, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.id,
        record.formId,
        record.formVersion,
        JSON.stringify(record.data),
        record.gpsOpen   ? JSON.stringify(record.gpsOpen)   : null,
        record.gpsSubmit ? JSON.stringify(record.gpsSubmit) : null,
        record.status,
        record.createdAt,
        record.updatedAt,
      ],
    )
  }

  async getSubmission(id: string): Promise<SubmissionRecord | null> {
    const res = await this._query('SELECT * FROM submissions WHERE id = ?', [id])
    const set = res[0]
    if (!set?.rows.length) return null
    return this._toRecord(set.columns, set.rows[0])
  }

  async listSubmissions(formId: string, status?: SubmissionRecord['status']): Promise<SubmissionRecord[]> {
    const res = status
      ? await this._query('SELECT * FROM submissions WHERE form_id = ? AND status = ?', [formId, status])
      : await this._query('SELECT * FROM submissions WHERE form_id = ?', [formId])
    return this._rowsFromResult(res)
  }

  async deleteSubmission(id: string): Promise<void> {
    await this._query('DELETE FROM submissions WHERE id = ?', [id])
  }

  async getOutbox(): Promise<SubmissionRecord[]> {
    const res = await this._query("SELECT * FROM submissions WHERE status = 'outbox' ORDER BY created_at ASC")
    return this._rowsFromResult(res)
  }

  async markSynced(id: string): Promise<void> {
    await this._query(
      "UPDATE submissions SET status = 'synced', updated_at = ? WHERE id = ?",
      [new Date().toISOString(), id],
    )
  }

  async saveFormCache(form: FormCache): Promise<void> {
    await this._query(
      `INSERT OR REPLACE INTO form_cache (id, title, version, status, schema, cached_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [form.id, form.title, form.version, form.status, form.schema, form.cachedAt],
    )
  }

  async getFormCache(id: string): Promise<FormCache | null> {
    const res = await this._query('SELECT * FROM form_cache WHERE id = ?', [id])
    const set = res[0]
    if (!set?.rows.length) return null
    return this._toFormCache(set.columns, set.rows[0])
  }

  async listFormCache(): Promise<FormCache[]> {
    const res = await this._query("SELECT * FROM form_cache WHERE status = 'active' ORDER BY title ASC")
    const set = res[0]
    if (!set) return []
    return set.rows.map(row => this._toFormCache(set.columns, row))
  }

  async deleteFormCache(id: string): Promise<void> {
    await this._query('DELETE FROM form_cache WHERE id = ?', [id])
  }

  private _toFormCache(columns: string[], row: unknown[]): FormCache {
    const c = Object.fromEntries(columns.map((k, i) => [k, row[i]]))
    return {
      id:       c['id'] as string,
      title:    c['title'] as string,
      version:  c['version'] as number,
      status:   c['status'] as string,
      schema:   c['schema'] as string,
      cachedAt: c['cached_at'] as string,
    }
  }

  // ── Media queue ──────────────────────────────────────────────────────

  async saveMediaItem(item: MediaQueueItem): Promise<void> {
    await this._query(
      `INSERT OR REPLACE INTO media_queue
         (id, submission_id, field_name, file_type, data_uri, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [item.id, item.submissionId, item.fieldName, item.fileType, item.dataUri, item.status, item.createdAt],
    )
  }

  async getMediaQueue(): Promise<MediaQueueItem[]> {
    const res = await this._query(
      "SELECT * FROM media_queue WHERE status IN ('pending', 'failed') ORDER BY created_at ASC",
    )
    const set = res[0]
    if (!set?.rows.length) return []
    return set.rows.map(row => this._toMediaItem(set.columns, row))
  }

  async updateMediaStatus(id: string, status: MediaQueueItem['status']): Promise<void> {
    await this._query('UPDATE media_queue SET status = ? WHERE id = ?', [status, id])
  }

  async deleteMediaItem(id: string): Promise<void> {
    await this._query('DELETE FROM media_queue WHERE id = ?', [id])
  }

  async getMediaQueueCount(): Promise<number> {
    const res = await this._query("SELECT COUNT(*) as cnt FROM media_queue WHERE status IN ('pending', 'failed')")
    const set = res[0]
    if (!set?.rows.length) return 0
    return set.rows[0][0] as number
  }

  private _toMediaItem(columns: string[], row: unknown[]): MediaQueueItem {
    const c = Object.fromEntries(columns.map((k, i) => [k, row[i]]))
    return {
      id:           c['id'] as string,
      submissionId: c['submission_id'] as string,
      fieldName:    c['field_name'] as string,
      fileType:     c['file_type'] as MediaQueueItem['fileType'],
      dataUri:      c['data_uri'] as string,
      status:       c['status'] as MediaQueueItem['status'],
      createdAt:    c['created_at'] as string,
    }
  }

  async saveIdMapping(localId: string, serverId: string): Promise<void> {
    await this._query(
      'INSERT OR REPLACE INTO id_map (local_id, server_id) VALUES (?, ?)',
      [localId, serverId],
    )
  }

  async getServerId(localId: string): Promise<string | null> {
    const res = await this._query('SELECT server_id FROM id_map WHERE local_id = ?', [localId])
    const set = res[0]
    if (!set?.rows.length) return null
    return set.rows[0][0] as string
  }

  async getStorageInfo(): Promise<StorageInfo> {
    const est = await navigator.storage.estimate()
    const used  = est.usage  ?? 0
    const quota = est.quota  ?? 1
    return {
      usedBytes:   used,
      quotaBytes:  quota,
      percentUsed: Math.round((used / quota) * 100),
    }
  }
}
