/**
 * formDraft.ts — localStorage helpers for FormBuilder auto-save drafts.
 *
 * Key: `fp_form_draft`
 * Value: { schema, formId, savedAt }
 *
 * Drafts are per-browser-session. They are cleared on successful server save
 * and offered for restore when the builder opens without an ?id= param.
 */

import type { FormSchema } from '@/types/form'

const DRAFT_KEY = 'fp_form_draft'

export interface FormDraft {
  schema: FormSchema
  formId: string | null
  savedAt: string   // ISO timestamp
}

export function saveFormDraft(schema: FormSchema, formId: string | null): void {
  try {
    const draft: FormDraft = { schema, formId, savedAt: new Date().toISOString() }
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
  } catch {
    // localStorage full or unavailable — silent fail
  }
}

export function loadFormDraft(): FormDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    return JSON.parse(raw) as FormDraft
  } catch {
    return null
  }
}

export function clearFormDraft(): void {
  localStorage.removeItem(DRAFT_KEY)
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
