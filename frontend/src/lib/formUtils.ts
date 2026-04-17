import { v4 as uuidv4 } from 'uuid'
import type { FormField, FormSection, FormSchema, SkipCondition, FieldType, ConditionGroup } from '@/types/form'
import { isConditionGroup } from '@/types/form'

export function newField(type: FieldType): FormField {
  const base: FormField = {
    id: uuidv4(),
    type,
    name: `field_${Math.random().toString(36).slice(2, 7)}`,
    label: '',
    required: false,
  }
  if (type === 'single_choice' || type === 'multiple_choice') {
    base.options = [{ value: 'option_1', label: 'Option 1' }]
  }
  if (type === 'rating') { base.min = 1; base.max = 5 }
  if (type === 'repeat_group') { base.fields = [] }
  return base
}

export function newSection(): FormSection {
  return { id: uuidv4(), title: 'New Section', fields: [] }
}

export function newSchema(title = 'Untitled Form'): FormSchema {
  return { title, sections: [newSection()], version: 1 }
}

/** Core skip-logic evaluator — returns true if the item SHOULD be shown. */
function evalSkipLogic(skipLogic: SkipLogic | undefined, values: Record<string, unknown>): boolean {
  if (!skipLogic) return true
  const { logic, conditions, action } = skipLogic
  const match = evaluateGroup({ logic, conditions }, values)
  return action === 'show' ? match : !match
}

/** Evaluate skip logic — returns true if the field SHOULD be shown. */
export function shouldShow(field: FormField, values: Record<string, unknown>): boolean {
  return evalSkipLogic(field.skipLogic, values)
}

/** Evaluate section-level skip logic — returns true if the section SHOULD be shown. */
export function shouldShowSection(section: FormSection, values: Record<string, unknown>): boolean {
  return evalSkipLogic(section.skipLogic, values)
}

/** Recursively evaluate a condition group (AND/OR of conditions and nested groups). */
function evaluateGroup(group: ConditionGroup, values: Record<string, unknown>): boolean {
  const results = group.conditions.map(c =>
    isConditionGroup(c) ? evaluateGroup(c, values) : evaluateCondition(c, values)
  )
  return group.logic === 'AND' ? results.every(Boolean) : results.some(Boolean)
}

function evaluateCondition(c: SkipCondition, values: Record<string, unknown>): boolean {
  const val = values[c.field]
  const cmp = c.value
  switch (c.operator) {
    case 'eq':           return val == cmp
    case 'neq':          return val != cmp
    case 'gt':           return Number(val) > Number(cmp)
    case 'lt':           return Number(val) < Number(cmp)
    case 'gte':          return Number(val) >= Number(cmp)
    case 'lte':          return Number(val) <= Number(cmp)
    case 'contains':     return String(val ?? '').includes(String(cmp))
    case 'is_empty':     return val === undefined || val === null || val === ''
    case 'is_not_empty': return val !== undefined && val !== null && val !== ''
    default:             return true
  }
}

/**
 * Evaluate a formula string against field values.
 * Supports: arithmetic, string comparisons, if(cond, then, else),
 * sum(), round(), abs(), max(), min().
 * Returns a string or number (or null on error).
 */
export function evalFormula(formula: string, values: Record<string, unknown>): string | number | null {
  try {
    // Build scope: field values + built-in helpers
    const scope: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(values)) {
      // Keep strings as strings; coerce empty/null to 0 for numeric ops
      scope[k] = v ?? ''
    }
    // Helper functions available in formulas
    scope['if']    = (cond: unknown, t: unknown, f: unknown) => cond ? t : f
    scope['sum']   = (...a: unknown[]) => a.reduce((acc: number, x) => acc + Number(x), 0)
    scope['round'] = (n: unknown, d = 0) => Number(Number(n).toFixed(Number(d)))
    scope['abs']   = (n: unknown) => Math.abs(Number(n))
    scope['max']   = (...a: unknown[]) => Math.max(...a.map(Number))
    scope['min']   = (...a: unknown[]) => Math.min(...a.map(Number))
    scope['concat']   = (...a: unknown[]) => a.join('')
    scope['len']      = (s: unknown) => String(s ?? '').length
    scope['contains'] = (hay: unknown, needle: unknown) =>
      String(hay ?? '').toLowerCase().includes(String(needle ?? '').toLowerCase())
    scope['num']   = (s: unknown) => Number(s)
    scope['text']  = (n: unknown) => String(n ?? '')

    const keys = Object.keys(scope)
    const vals = keys.map(k => scope[k])
    // eslint-disable-next-line no-new-func
    const result = new Function(...keys, `"use strict"; return (${formula})`)(...vals)
    if (result === null || result === undefined) return null
    // Trim trailing decimals for clean display
    if (typeof result === 'number' && !isNaN(result)) {
      return parseFloat(result.toFixed(6))
    }
    return result as string | number
  } catch {
    return null
  }
}

/** Recursively map a section by id (handles subsections). */
export function mapSectionById(
  sections: FormSection[],
  sectionId: string,
  updater: (sec: FormSection) => FormSection,
): FormSection[] {
  return sections.map(sec => {
    if (sec.id === sectionId) return updater(sec)
    if (sec.subsections?.length) return { ...sec, subsections: mapSectionById(sec.subsections, sectionId, updater) }
    return sec
  })
}

/** Return all fields in document order, traversing subsections depth-first. */
export function getAllFieldsInOrder(sections: FormSection[]): FormField[] {
  const result: FormField[] = []
  const traverse = (secs: FormSection[]) => {
    for (const sec of secs) {
      result.push(...sec.fields)
      if (sec.subsections?.length) traverse(sec.subsections)
    }
  }
  traverse(sections)
  return result
}

/** Deep update a field inside sections by id */
export function updateFieldInSchema(
  schema: FormSchema,
  sectionId: string,
  fieldId: string,
  patch: Partial<FormField>,
): FormSchema {
  return {
    ...schema,
    sections: mapSectionById(schema.sections, sectionId, sec => ({
      ...sec,
      fields: sec.fields.map(f => f.id !== fieldId ? f : { ...f, ...patch }),
    })),
  }
}
