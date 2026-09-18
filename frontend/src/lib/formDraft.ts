/**
 * formDraft.ts — localStorage helpers for FormBuilder auto-save drafts.
 *
 * Key: `fp_form_draft_{formId}` (or `fp_form_draft_new` while the form has no
 * server id yet) — namespaced per form so editing/autosaving one form never
 * clobbers another form's recovery draft on the same browser.
 *
 * `fp_form_draft_active` tracks the most recently touched draft key, for the
 * rare caller (session-timeout handling) that needs to "touch whatever the
 * user was last editing" without knowing which specific form that was.
 *
 * Drafts are per-browser-session. They are cleared on successful server save
 * and offered for restore when the builder opens without an ?id= param.
 */

import type { FormSchema } from '@/types/form'

/** Pre-namespacing key — kept only so in-flight drafts survive the upgrade. */
const DRAFT_KEY_LEGACY = 'fp_form_draft'
const ACTIVE_KEY = 'fp_form_draft_active'

export interface FormDraft {
  schema: FormSchema
  formId: string | null
  savedAt: string   // ISO timestamp
}

function draftKey(formId: string | null): string {
  return formId ? `fp_form_draft_${formId}` : 'fp_form_draft_new'
}

export function saveFormDraft(schema: FormSchema, formId: string | null): void {
  try {
    const key = draftKey(formId)
    const draft: FormDraft = { schema, formId, savedAt: new Date().toISOString() }
    localStorage.setItem(key, JSON.stringify(draft))
    localStorage.setItem(ACTIVE_KEY, key)
  } catch {
    // localStorage full or unavailable — silent fail
  }
}

/**
 * Load a draft. Pass the form's id (or `null` for a not-yet-saved form) when
 * the caller knows which form it's editing — callers that know their form
 * should always pass this explicitly so they never see another form's draft.
 * Omit the argument only for "whatever was last being edited" callers.
 */
export function loadFormDraft(formId?: string | null): FormDraft | null {
  try {
    if (formId !== undefined) {
      const raw = localStorage.getItem(draftKey(formId))
      if (raw) return JSON.parse(raw) as FormDraft
      if (formId === null) {
        // One-time migration from the pre-namespacing single-key scheme.
        const legacy = localStorage.getItem(DRAFT_KEY_LEGACY)
        if (legacy) {
          localStorage.removeItem(DRAFT_KEY_LEGACY)
          return JSON.parse(legacy) as FormDraft
        }
      }
      return null
    }
    const activeKey = localStorage.getItem(ACTIVE_KEY)
    const raw = activeKey ? localStorage.getItem(activeKey) : localStorage.getItem(DRAFT_KEY_LEGACY)
    return raw ? (JSON.parse(raw) as FormDraft) : null
  } catch {
    return null
  }
}

export function clearFormDraft(formId: string | null): void {
  try {
    const key = draftKey(formId)
    localStorage.removeItem(key)
    if (localStorage.getItem(ACTIVE_KEY) === key) localStorage.removeItem(ACTIVE_KEY)
  } catch {
    // localStorage full or unavailable — silent fail
  }
}

/** Human-readable age of a draft, e.g. "3 minutes ago", "just now" */
export function draftAgeLabel(savedAt: string): string {
  const diffMs  = Date.now() - new Date(savedAt).getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1)  return 'just now'
  if (diffMin < 60) return `${diffMin} minute${diffMin !== 1 ? 's' : ''} ago`
  const diffHr  = Math.floor(diffMin / 60)
  return `${diffHr} hour${diffHr !== 1 ? 's' : ''} ago`
}
