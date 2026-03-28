/**
 * SQLite Web Worker — OPFS-backed storage for FieldPulse.
 *
 * Uses wa-sqlite (sync WASM) + AccessHandlePoolVFS which exploits
 * FileSystemSyncAccessHandle — a high-performance OPFS API that is
 * only accessible from a DedicatedWorker context.
 *
 * The main thread sends { id, sql, params? } messages and receives
 * { id, results?, error? } responses.
 */

// In a DedicatedWorker, postMessage has a simpler signature than Window.postMessage
declare function postMessage(data: unknown): void

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — no bundled type for WASM factory
import SQLiteESMFactory from 'wa-sqlite/dist/wa-sqlite.mjs'
import wasmUrl from 'wa-sqlite/dist/wa-sqlite.wasm?url'
import * as SQLite from 'wa-sqlite'
import { AccessHandlePoolVFS } from 'wa-sqlite/src/examples/AccessHandlePoolVFS.js'
import { createTag } from 'wa-sqlite/src/examples/tag.js'

type TagFn = (
  sql: string | TemplateStringsArray,
  ...values: unknown[]
) => Promise<Array<{ columns: string[]; rows: unknown[][] }>>

let tag: TagFn

async function init(): Promise<void> {
  // Pass locateFile so Emscripten finds the WASM after bundling
  const module = await (SQLiteESMFactory as (opts: object) => Promise<object>)({
    locateFile: () => wasmUrl as string,
  })

  const sqlite3 = SQLite.Factory(module as Parameters<typeof SQLite.Factory>[0])

  const vfs = new AccessHandlePoolVFS('/fieldpulse-db')
  await vfs.isReady
  sqlite3.vfs_register(vfs as unknown as SQLiteVFS, true) // register as default VFS

  const db = await sqlite3.open_v2('fieldpulse.db')
  tag = createTag(sqlite3, db) as TagFn

  // Schema — idempotent
  await tag`
    CREATE TABLE IF NOT EXISTS submissions (
      id          TEXT    PRIMARY KEY,
      form_id     TEXT    NOT NULL,
      form_version INTEGER NOT NULL DEFAULT 1,
      data        TEXT    NOT NULL,
      gps_open    TEXT,
      gps_submit  TEXT,
      status      TEXT    NOT NULL DEFAULT 'draft',
      created_at  TEXT    NOT NULL,
      updated_at  TEXT    NOT NULL
    )
  `
  await tag`CREATE INDEX IF NOT EXISTS idx_sub_form   ON submissions(form_id)`
  await tag`CREATE INDEX IF NOT EXISTS idx_sub_status ON submissions(status)`

  await tag`
    CREATE TABLE IF NOT EXISTS form_cache (
      id        TEXT PRIMARY KEY,
      title     TEXT NOT NULL,
      version   INTEGER NOT NULL DEFAULT 1,
      status    TEXT NOT NULL DEFAULT 'active',
      schema    TEXT NOT NULL,
      cached_at TEXT NOT NULL
    )
  `

  // Media queue — tracks photos/audio pending upload (separate from submission data)
  await tag`
    CREATE TABLE IF NOT EXISTS media_queue (
      id             TEXT PRIMARY KEY,
      submission_id  TEXT NOT NULL,
      field_name     TEXT NOT NULL,
      file_type      TEXT NOT NULL DEFAULT 'photo',
      data_uri       TEXT NOT NULL,
      status         TEXT NOT NULL DEFAULT 'pending',
      created_at     TEXT NOT NULL
    )
  `
  await tag`CREATE INDEX IF NOT EXISTS idx_mq_status ON media_queue(status)`
  await tag`CREATE INDEX IF NOT EXISTS idx_mq_sub    ON media_queue(submission_id)`

  // ID mapping — maps local submission UUIDs to server-assigned UUIDs
  await tag`
    CREATE TABLE IF NOT EXISTS id_map (
      local_id  TEXT PRIMARY KEY,
      server_id TEXT NOT NULL
    )
  `
}

// Begin initializing immediately so the first query waits at most for boot time
const ready = init()

addEventListener('message', async (e: MessageEvent) => {
  const { id, sql, params } = e.data as { id: number; sql: string; params?: unknown[] }
  try {
    await ready
    const results = params?.length
      ? await tag(sql, [params])   // tag(sql, [[p1, p2, ...]]) — one binding row
      : await tag(sql)             // tag(sql) — no bindings
    postMessage({ id, results })
  } catch (err) {
    postMessage({ id, error: String(err) })
  }
})
