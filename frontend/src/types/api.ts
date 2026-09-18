/**
 * Shared API response shapes — keep in sync with backend Pydantic schemas.
 * Use these instead of `any` in API response handlers.
 */

// ── Auth ──────────────────────────────────────────────────────────────────────

export interface LoginResponse {
  access_token: string
  refresh_token?: string
  role: string
  name: string
  id: string
  email?: string
  phone?: string
}

// ── Forms ─────────────────────────────────────────────────────────────────────

export interface FormListItem {
  id: string
  title: string
  status: string
  version: number
  created_at: string
  updated_at?: string
  submission_count?: number
  allow_enumerator_edit?: boolean | null
}

export interface FormEditOverride {
  id: string
  title: string
  allow_enumerator_edit: boolean | null
}

// ── Submissions ───────────────────────────────────────────────────────────────

export interface SubmissionListItem {
  id: string
  local_id?: string
  form_id: string
  status: string
  submitted_at: string
  synced_at?: string
  data_json: Record<string, unknown>
  duplicate_suspect?: boolean
  flag_note?: string
  serial_number?: number
}

// ── Programs ──────────────────────────────────────────────────────────────────

export interface ProgramListItem {
  id: string
  name: string
  scheme_name: string
  status: string
  participant_type_count?: number
  questionnaire_count?: number
  allow_enumerator_edit?: boolean | null
}

export interface ProgramEditOverride {
  id: string
  name: string
  allow_enumerator_edit: boolean | null
}

export interface LocationListItem {
  id: string
  name: string
  level?: string
  parent_id?: string | null
}

// ── Tabulation ────────────────────────────────────────────────────────────────

export interface TabulationRow {
  group: string
  value: number
  pct?: number
  [subKey: string]: string | number | undefined
}

export interface TabulationResult {
  rows: TabulationRow[]
  total: number
  show_percent?: boolean
  secondary_groupby?: string
  sub_keys?: string[]
  is_cross_tab?: boolean
}

// ── AI jobs ───────────────────────────────────────────────────────────────────

export interface AiJobResponse {
  job_id: string
}

// ── Field option (for choice field columns) ───────────────────────────────────

export interface ApiFieldOption {
  value: string
  label: string
}

export interface ColumnHeader {
  id: string
  label: string
  type: string
  options: ApiFieldOption[]
}
