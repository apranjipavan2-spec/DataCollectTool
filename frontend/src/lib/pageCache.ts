const cache = new Map<string, { data: unknown; ts: number }>()
const TTL = 5 * 60 * 1000

export function getCached<T>(key: string): T | null {
  const entry = cache.get(key)
  if (entry && Date.now() - entry.ts < TTL) return entry.data as T
  return null
}

export function setCached(key: string, data: unknown) {
  cache.set(key, { data, ts: Date.now() })
}

export function invalidateCache(pattern?: string) {
  if (!pattern) { cache.clear(); return }
  for (const key of cache.keys()) {
    if (key.includes(pattern)) cache.delete(key)
  }
}
