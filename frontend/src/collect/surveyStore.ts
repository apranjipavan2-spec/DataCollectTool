/**
 * surveyStore — local-first persistence for the PUBLIC survey link.
 *
 * A public respondent has no login and no enumerator storage, yet their answers
 * are just as precious. This keeps every answer on-device so nothing is lost to
 * a dropped request or an accidental reload:
 *
 *   - draft:      the in-progress answers, autosaved on every change, keyed by
 *                 token. Restored when the same link is reopened.
 *   - submission: a completed response, queued the instant Submit is pressed,
 *                 then uploaded. Deleted ONLY after the server confirms (2xx).
 *                 On any failure it stays queued and is retried (mount / online
 *                 event / interval) until it lands.
 *
 * Separate Dexie DB from the enumerator store (`fieldgovern`) — different origin
 * of data, different upload endpoint, no schema coupling.
 */

import Dexie, { type Table } from 'dexie'
import axios from 'axios'
import { v4 as uuidv4 } from 'uuid'

export interface PendingSurvey {
  id: string                              // `draft:${token}` for drafts, uuid for submissions
  token: string
  kind: 'draft' | 'submission'
  values: Record<string, unknown>
  updatedAt: string
  attempts: number
}

class SurveyDB extends Dexie {
  pending!: Table<PendingSurvey>
  constructor() {
    super('fieldgovern-survey')
    this.version(1).stores({ pending: 'id, token, kind' })
  }
}

const db = new SurveyDB()

const draftId = (token: string) => `draft:${token}`

/** Ask the browser to keep this data from being evicted under storage pressure. */
export async function requestPersistence(): Promise<void> {
  try { await navigator.storage?.persist?.() } catch { /* non-fatal */ }
}

// ── Draft (in-progress answers) ───────────────────────────────────────────

export async function saveDraft(token: string, values: Record<string, unknown>): Promise<void> {
  await db.pending.put({
    id: draftId(token), token, kind: 'draft', values,
    updatedAt: new Date().toISOString(), attempts: 0,
  })
}

export async function loadDraft(token: string): Promise<Record<string, unknown> | null> {
  const rec = await db.pending.get(draftId(token))
  return rec?.kind === 'draft' ? rec.values : null
}

export async function clearDraft(token: string): Promise<void> {
  await db.pending.delete(draftId(token))
}

// ── Submissions (completed, pending upload) ────────────────────────────────

/** Persist a completed response locally. Returns its local id. Throws only if
 *  storage itself is unavailable (caller must then keep the data in memory). */
export async function enqueueSubmission(token: string, values: Record<string, unknown>): Promise<string> {
  const id = uuidv4()
  await db.pending.put({
    id, token, kind: 'submission', values,
    updatedAt: new Date().toISOString(), attempts: 0,
  })
  return id
}

export async function pendingCount(token: string): Promise<number> {
  return db.pending.where('token').equals(token).and(r => r.kind === 'submission').count()
}

/**
 * Try to upload every queued submission for this token.
 * Deletes each only on a confirmed 2xx. Stops early on 429 (rate-limited) so we
 * back off. Any other failure leaves the record queued for the next flush.
 * Returns the number still pending afterwards.
 */
export async function flush(token: string): Promise<number> {
  const items = await db.pending.where('token').equals(token).and(r => r.kind === 'submission').toArray()
  for (const item of items) {
    try {
      // local_id = the record id, so a retry OR a recovered backup file for the
      // same response is deduped server-side (never double-counted). 12s timeout
      // so a stalled/slow network is treated as "not uploaded" and the caller can
      // fall back to the encrypted device backup.
      await axios.post(`/api/v1/survey/${token}/submit`,
        { data_json: item.values, local_id: item.id },
        { timeout: 12000 })
      await db.pending.delete(item.id)                 // confirmed — safe to drop
    } catch (err: any) {
      await db.pending.update(item.id, { attempts: item.attempts + 1 })
      if (err?.response?.status === 429) break         // rate-limited: back off, keep the rest
      // network / 5xx / 4xx — keep queued, retry later. Never delete unconfirmed data.
    }
  }
  return pendingCount(token)
}
