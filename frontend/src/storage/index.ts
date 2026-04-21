import { detectBackend } from './StorageAdapter'
import { OpfsAdapter } from './OpfsAdapter'
import { IndexedDbAdapter } from './IndexedDbAdapter'
import type { StorageAdapter } from './StorageAdapter'

let _adapter: StorageAdapter | null = null

export async function getStorage(): Promise<StorageAdapter> {
  if (_adapter) return _adapter

  const backend = detectBackend()
  _adapter = backend === 'opfs' ? new OpfsAdapter() : new IndexedDbAdapter()
  await _adapter.init()
  await _adapter.requestPersistence()

  // Warn if free space < 200MB
  const info = await _adapter.getStorageInfo()
  const freeMB = (info.quotaBytes - info.usedBytes) / 1024 / 1024
  if (freeMB < 200) {
    console.warn(`[FieldGovern] Low storage: only ${freeMB.toFixed(0)}MB free. Sync immediately.`)
  }

  return _adapter
}

export type { StorageAdapter, SubmissionRecord, StorageInfo } from './StorageAdapter'
