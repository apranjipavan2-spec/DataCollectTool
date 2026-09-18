/// <reference types="vite/client" />

// Background Sync API — not yet in TypeScript stdlib
interface SyncEvent extends ExtendableEvent {
  readonly tag: string
  readonly lastChance: boolean
}

interface ServiceWorkerRegistrationSync {
  register(tag: string): Promise<void>
  getTags(): Promise<string[]>
}

interface ServiceWorkerRegistration {
  readonly sync: ServiceWorkerRegistrationSync
}

// Vite ?url suffix — returns the asset URL as a string
declare module '*.wasm?url' {
  const url: string
  export default url
}

// wa-sqlite example modules (no bundled .d.ts)
declare module 'wa-sqlite/dist/wa-sqlite.mjs' {
  const factory: (opts?: { locateFile?: (path: string) => string }) => Promise<object>
  export default factory
}

declare module 'wa-sqlite/src/examples/AccessHandlePoolVFS.js' {
  export class AccessHandlePoolVFS {
    isReady: Promise<void>
    constructor(directoryPath: string)
  }
}

declare module 'wa-sqlite/src/examples/tag.js' {
  import type { SQLiteAPI } from 'wa-sqlite'
  type TagResult = Array<{ columns: string[]; rows: unknown[][] }>
  type TagFn = (sql: string | TemplateStringsArray, ...values: unknown[]) => Promise<TagResult>
  export function createTag(sqlite3: SQLiteAPI, db: number): TagFn
}

