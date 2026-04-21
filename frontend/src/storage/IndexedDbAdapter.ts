/**
 * IndexedDbAdapter — Dexie.js / IndexedDB implementation.
 * Fallback storage for Safari/iOS (OPFS sync access handles not supported).
 *
 * Safari 17+ supports IndexedDB with up to 60% of disk for installed
 * Home Screen PWAs. Sufficient for supervisor use (5-10 surveys/day).
 * No background sync — syncs on every app open instead.
 */

import Dexie, { type Table } from 'dexie'
import type { StorageAdapter, SubmissionRecord, StorageInfo, FormCache, MediaQueueItem } from './StorageAdapter'

interface IdMapping { localId: string; serverId: string }

class FieldGovernDB extends Dexie {
  submissions!: Table<SubmissionRecord>
  formCache!: Table<FormCache>
  mediaQueue!: Table<MediaQueueItem>
  idMap!: Table<IdMapping>

  constructor() {
    super('fieldgovern')
    this.version(1).stores({
      submissions: 'id, formId, status, createdAt',
    })
    this.version(2).stores({
      submissions: 'id, formId, status, createdAt',
      formCache: 'id, status',
    })
    this.version(3).stores({
      submissions: 'id, formId, status, createdAt',
      formCache: 'id, status',
      mediaQueue: 'id, submissionId, status, createdAt',
      idMap: 'localId',
    })
  }
}

const db = new FieldGovernDB()

export class IndexedDbAdapter implements StorageAdapter {
  async init(): Promise<void> {
    await db.open()
    console.log('[IndexedDbAdapter] init — Dexie.js/IndexedDB')
  }

  async requestPersistence(): Promise<boolean> {
    // iOS requires notification permission for StorageManager.persist()
    if (navigator.storage?.persist) {
      return navigator.storage.persist()
    }
    return false
  }

  async saveSubmission(record: SubmissionRecord): Promise<void> {
    await db.submissions.put(record)
  }

  async getSubmission(id: string): Promise<SubmissionRecord | null> {
    return (await db.submissions.get(id)) ?? null
  }

  async listSubmissions(formId: string, status?: SubmissionRecord['status']): Promise<SubmissionRecord[]> {
    let query = db.submissions.where('formId').equals(formId)
    if (status) {
      return query.filter(r => r.status === status).toArray()
    }
    return query.toArray()
  }

  async deleteSubmission(id: string): Promise<void> {
    await db.submissions.delete(id)
  }

  async getOutbox(): Promise<SubmissionRecord[]> {
    return db.submissions.where('status').equals('outbox').toArray()
  }

  async markSynced(id: string): Promise<void> {
    await db.submissions.update(id, { status: 'synced' })
  }

  async saveFormCache(form: FormCache): Promise<void> {
    await db.formCache.put(form)
  }

  async getFormCache(id: string): Promise<FormCache | null> {
    return (await db.formCache.get(id)) ?? null
  }

  async listFormCache(): Promise<FormCache[]> {
    return db.formCache.where('status').equals('active').sortBy('title')
  }

  async deleteFormCache(id: string): Promise<void> {
    await db.formCache.delete(id)
  }

  // ── Media queue ──────────────────────────────────────────────────────

  async saveMediaItem(item: MediaQueueItem): Promise<void> {
    await db.mediaQueue.put(item)
  }

  async getMediaQueue(): Promise<MediaQueueItem[]> {
    return db.mediaQueue
      .where('status').anyOf('pending', 'failed')
      .sortBy('createdAt')
  }

  async updateMediaStatus(id: string, status: MediaQueueItem['status']): Promise<void> {
    await db.mediaQueue.update(id, { status })
  }

  async deleteMediaItem(id: string): Promise<void> {
    await db.mediaQueue.delete(id)
  }

  async getMediaQueueCount(): Promise<number> {
    return db.mediaQueue
      .where('status').anyOf('pending', 'failed')
      .count()
  }

  async saveIdMapping(localId: string, serverId: string): Promise<void> {
    await db.idMap.put({ localId, serverId })
  }

  async getServerId(localId: string): Promise<string | null> {
    const entry = await db.idMap.get(localId)
    return entry?.serverId ?? null
  }

  async getStorageInfo(): Promise<StorageInfo> {
    const est = await navigator.storage.estimate()
    const used = est.usage ?? 0
    const quota = est.quota ?? 1
    return {
      usedBytes: used,
      quotaBytes: quota,
      percentUsed: Math.round((used / quota) * 100),
    }
  }
}
