/**
 * StorageAdapter — abstract interface over all local storage backends.
 *
 * Two implementations:
 *   OpfsAdapter  — OPFS + wa-sqlite (Chrome/Android, primary)
 *   IndexedDbAdapter — Dexie.js / IndexedDB (Safari/iOS, fallback)
 *
 * All storage operations in the app go through this interface.
 * Swapping backends (e.g. Capacitor native SQLite) = one file change.
 */

export interface SubmissionRecord {
  id: string
  formId: string
  formVersion: number
  data: Record<string, unknown>
  gpsOpen?: { lat: number; lng: number; accuracy: number }
  gpsSubmit?: { lat: number; lng: number; accuracy: number }
  status: 'draft' | 'outbox' | 'synced'
  createdAt: string   // ISO string, set on device
  updatedAt: string
}

export interface StorageInfo {
  usedBytes: number
  quotaBytes: number
  percentUsed: number
}

export interface FormCache {
  id: string
  title: string
  version: number
  status: string
  schema: string        // JSON stringified FormSchema
  cachedAt: string      // ISO string
}

/** Tracks a photo/audio file pending upload to the server. */
export interface MediaQueueItem {
  id: string             // unique ID for this queue entry
  submissionId: string   // links to SubmissionRecord.id
  fieldName: string      // which form field produced this media
  fileType: 'photo' | 'audio'
  dataUri: string        // base64 data URI (compressed)
  status: 'pending' | 'uploading' | 'uploaded' | 'failed'
  createdAt: string
}

export interface StorageAdapter {
  /** Initialize the storage engine (run once on app start). */
  init(): Promise<void>

  /** Persist storage from eviction (Chrome only — no-op on Safari). */
  requestPersistence(): Promise<boolean>

  /** Save or update a submission draft/record. */
  saveSubmission(record: SubmissionRecord): Promise<void>

  /** Load a single submission by id. */
  getSubmission(id: string): Promise<SubmissionRecord | null>

  /** List all submissions for a form, optionally filtered by status. */
  listSubmissions(formId: string, status?: SubmissionRecord['status']): Promise<SubmissionRecord[]>

  /** Delete a submission after confirmed server sync. */
  deleteSubmission(id: string): Promise<void>

  /** Return all submissions in 'outbox' status (pending sync). */
  getOutbox(): Promise<SubmissionRecord[]>

  /** Mark a submission as synced. */
  markSynced(id: string): Promise<void>

  /** Check storage usage. Show warning if < 200MB free. */
  getStorageInfo(): Promise<StorageInfo>

  /** Cache a form's schema locally for offline use. */
  saveFormCache(form: FormCache): Promise<void>

  /** Get a cached form by id. */
  getFormCache(id: string): Promise<FormCache | null>

  /** List all cached forms (used when offline). */
  listFormCache(): Promise<FormCache[]>

  /** Remove a form from the local cache. */
  deleteFormCache(id: string): Promise<void>

  // ── Media queue (photo/audio pending upload) ──────────────────────────

  /** Enqueue a media file for upload. */
  saveMediaItem(item: MediaQueueItem): Promise<void>

  /** Get all pending/failed media items ready for upload. */
  getMediaQueue(): Promise<MediaQueueItem[]>

  /** Update media item status (e.g. pending → uploaded). */
  updateMediaStatus(id: string, status: MediaQueueItem['status']): Promise<void>

  /** Delete uploaded media items to free local storage. */
  deleteMediaItem(id: string): Promise<void>

  /** Count pending media uploads. */
  getMediaQueueCount(): Promise<number>

  /** Store local→server submission ID mapping (for media uploads after text sync). */
  saveIdMapping(localId: string, serverId: string): Promise<void>

  /** Look up the server ID for a locally-created submission. */
  getServerId(localId: string): Promise<string | null>
}

/**
 * Detect which backend to use based on browser engine.
 * Chrome/Chromium → OPFS (wa-sqlite)
 * Safari/WebKit   → IndexedDB (Dexie.js)
 */
export function detectBackend(): 'opfs' | 'indexeddb' {
  // OPFS requires navigator.storage.getDirectory (Chrome 86+, not Safari <17.4)
  const hasOpfs = typeof navigator.storage?.getDirectory === 'function'
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent)
  if (!hasOpfs || isSafari) return 'indexeddb'
  return 'opfs'
}
