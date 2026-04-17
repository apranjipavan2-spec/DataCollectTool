// Core form schema types — shared between builder and renderer

export type FieldType =
  | 'text' | 'number' | 'decimal' | 'single_choice' | 'multiple_choice'
  | 'date' | 'time' | 'gps' | 'photo' | 'audio' | 'barcode'
  | 'calculated' | 'repeat_group' | 'note' | 'rating'

export interface SkipCondition {
  field: string
  operator: 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains' | 'is_empty' | 'is_not_empty'
  value?: string | number  // optional — not needed for is_empty / is_not_empty
}

/** A group of conditions joined by AND/OR, possibly containing nested sub-groups. */
export interface ConditionGroup {
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
}

export interface FormField {
  id: string
  type: FieldType
  name: string           // variable name — used in export (snake_case)
  label: string          // display label
  hint?: string
  required?: boolean
  options?: FieldOption[]      // for single_choice / multiple_choice
  min?: number                 // number / decimal / rating
  max?: number
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

export interface FormSchema {
  title: string
  sections: FormSection[]
  version: number
}
