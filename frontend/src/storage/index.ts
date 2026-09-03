import { detectBackend } from './StorageAdapter'
import { OpfsAdapter } from './OpfsAdapter'
import { IndexedDbAdapter } from './IndexedDbAdapter'
import type { StorageAdapter } from './StorageAdapter'

let _adapter: StorageAdapter | null = null
let _initPromise: Promise<StorageAdapter> | null = null

async function initAdapter(): Promise<StorageAdapter> {
  const backend = detectBackend()

  if (backend === 'opfs') {
    // OPFS's write lock is exclusive per device — a duplicate tab, a stale
    // worker from a crashed prior session, or a moment of contention can
    // make init() throw. Retry once after a beat (the lock is usually
    // transient), then fall back to IndexedDB rather than leaving every
    // save broken for the rest of the session.
    for (let attempt = 1; attempt <= 2; attempt++) {
      const candidate = new OpfsAdapter()
      try {
        await candidate.init()
        return candidate
      } catch (e) {
        console.warn(`[FieldGovern] OPFS init failed (attempt ${attempt}/2)`, e)
        if (attempt < 2) await new Promise(r => setTimeout(r, 500))
      }
    }
    console.warn('[FieldGovern] OPFS unavailable this session — falling back to IndexedDB')
  }

  const fallback = new IndexedDbAdapter()
  await fallback.init()
  return fallback
}

export async function getStorage(): Promise<StorageAdapter> {
  if (_adapter) return _adapter
  if (_initPromise) return _initPromise

  _initPromise = (async () => {
    const adapter = await initAdapter()
    await adapter.requestPersistence()

    // Warn if free space < 200MB
    const info = await adapter.getStorageInfo()
    const freeMB = (info.quotaBytes - info.usedBytes) / 1024 / 1024
    if (freeMB < 200) {
      console.warn(`[FieldGovern] Low storage: only ${freeMB.toFixed(0)}MB free. Sync immediately.`)
    }

    _adapter = adapter
    return adapter
  })()

  try {
    return await _initPromise
  } finally {
    _initPromise = null
  }
}

export type { StorageAdapter, SubmissionRecord, StorageInfo } from './StorageAdapter'
