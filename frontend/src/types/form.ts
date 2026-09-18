// Core form schema types — shared between builder and renderer

export type FieldType =
  | 'text' | 'number' | 'decimal' | 'single_choice' | 'multiple_choice'
  | 'date' | 'time' | 'gps' | 'photo' | 'audio' | 'barcode'
  | 'calculated' | 'repeat_group' | 'note' | 'rating' | 'signature'

export interface SkipCondition {
  _key?: string  // stable React key — not sent to backend
  field: string
  operator: 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains' | 'is_empty' | 'is_not_empty'
    // age_gte / age_lt: field must be a date (DOB); value is "Y|M|D" (years|months|days),
    // compared as exact age from that date to today.
    | 'age_gte' | 'age_lt'
  value?: string | number  // optional — not needed for is_empty / is_not_empty
}

/** A group of conditions joined by AND/OR, possibly containing nested sub-groups. */
export interface ConditionGroup {
  _key?: string  // stable React key — not sent to backend
  logic: 'AND' | 'OR'
  conditions: (SkipCondition | ConditionGroup)[]
}

/** Helper type-guard */
export function isConditionGroup(c: SkipCondition | ConditionGroup): c is ConditionGroup {
  return 'logic' in c && 'conditions' in c && !('field' in c)
}

export interface SkipLogic {
  logic: 'AND' | 'OR'
  conditions: (SkipCondition | ConditionGroup)[]
  action: 'show' | 'skip'
}

export interface ValidationRule {
  type: 'required' | 'min' | 'max' | 'regex' | 'cross_field'
  value?: string | number
  message?: string
}

export interface FieldOption {
  value: string
  label: string
  /** Cascading attributes (e.g. block/gp) that a later field's choiceFilter matches on. */
  [attr: string]: string | undefined
}

export interface FormField {
  id: string
  type: FieldType
  name: string           // variable name — used in export (snake_case)
  label: string          // display label
  hint?: string
  required?: boolean
  is_identifier?: boolean      // part of the composite "respondent identifier" key used for duplicate detection
  is_dob_for_screening?: boolean   // date field: respondent's DOB, used to auto-flag under-18 submissions
  is_guardian_consent?: boolean    // this field's answer is the guardian's consent (a truthy answer = consent given)
  options?: FieldOption[]      // for single_choice / multiple_choice
  min?: number                 // number / decimal / rating
  max?: number
  autoNow?: boolean            // date/time: prefill with today's date / current time on open
  /** Cascading select: show only options whose {attr} equals the answer of {field}. */
  choiceFilter?: { attr: string; field: string }[]
  formula?: string             // calculated field expression
  fields?: FormField[]         // repeat_group children
  skipLogic?: SkipLogic
  validations?: ValidationRule[]
  languages?: Record<string, { label: string; hint?: string; options?: FieldOption[] }>
  /** Multi-language flat keys: label_hi, label_kn, hint_te, etc. */
  [key: `label_${string}`]: string | undefined
  [key: `hint_${string}`]: string | undefined
}

export interface FormSection {
  id: string
  title: string
  fields: FormField[]
  subsections?: FormSection[]
  skipLogic?: SkipLogic   // if set, entire section is shown/skipped based on this condition
}

// DPDP consent notice, shown before the first question. `version` is
// server-assigned (see forms.py _reconcile_consent_notice_version) — never
// set it from the client. Per-language overrides live in `languages` using
// the same nested-map convention as field label/hint translations
// (see i18n/LanguageContext.getLocalizedLabel); English fields are the
// fallback when a language has no override.
export interface ConsentNotice {
  version?: number
  org_name?: string
  items_text?: string        // newline-separated list of data items collected
  purpose?: string
  retention?: string
  sharing?: string
  withdrawal?: string
  grievance_contact?: string
  board_contact?: string
  audio_url?: string
  ask_followup?: boolean     // show an opt-in "may we contact you again" purpose, even though no field type implies it
  languages?: Record<string, Partial<Omit<ConsentNotice, 'version' | 'languages'>>>
}

export interface FormSchema {
  title: string
  sections: FormSection[]
  version: number
  settings?: {
    purpose?: string   // legacy simple consent banner text — still supported as a fallback
    consent_notice?: ConsentNotice
    randomization?: {
      enabled?: boolean
      arms?: string[]
    }
    geofence?: {
      enabled?: boolean
      lat?: number
      lng?: number
      radius_meters?: number
    }
    [key: string]: unknown
  }
}
