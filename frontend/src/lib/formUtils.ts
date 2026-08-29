import { v4 as uuidv4 } from 'uuid'
import { Parser, type Value } from 'expr-eval'
import type { FormField, FormSection, FormSchema, SkipCondition, SkipLogic, FieldType, ConditionGroup } from '@/types/form'
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

function toNumber(x: unknown): number {
  const n = Number(x)
  return isNaN(n) ? 0 : n
}

/**
 * Build a formula parser with the helper functions available to authors:
 * if(), sum(), round(), abs(), max(), min(), concat(), len(), contains(), num(), text().
 * `if`, `max`, `min` are expr-eval built-ins with matching semantics; `round`/`abs` are
 * expr-eval unary ops by default (arity 1) so they're removed before being redefined
 * to accept the arities this formula language uses.
 */
function makeFormulaParser(): Parser {
  const parser = new Parser()
  delete parser.unaryOps.round
  delete parser.unaryOps.abs
  parser.functions.sum      = (...a: unknown[]) => a.reduce((acc: number, x) => acc + toNumber(x), 0)
  parser.functions.round    = (n: unknown, d: unknown) => Number(toNumber(n).toFixed(toNumber(d ?? 0)))
  parser.functions.abs      = (n: unknown) => Math.abs(toNumber(n))
  parser.functions.concat   = (...a: unknown[]) => a.map(x => String(x ?? '')).join('')
  parser.functions.len      = (s: unknown) => String(s ?? '').length
  parser.functions.contains = (hay: unknown, needle: unknown) =>
    String(hay ?? '').toLowerCase().includes(String(needle ?? '').toLowerCase())
  parser.functions.num  = (s: unknown) => toNumber(s)
  parser.functions.text = (n: unknown) => String(n ?? '')
  return parser
}

/**
 * Evaluate a formula string against field values.
 * Supports: arithmetic, string comparisons, if(cond, then, else),
 * sum(), round(), abs(), max(), min().
 * Returns a string or number (or null on error).
 *
 * Parsed and evaluated with expr-eval (no `eval`/`new Function`) — formulas are
 * author-controlled but run in every enumerator's browser at data-collection time,
 * so this must never be able to reach arbitrary JS (DOM, fetch, localStorage, etc).
 */
export function evalFormula(formula: string, values: Record<string, unknown>): string | number | null {
  try {
    const parser = makeFormulaParser()
    const expr = parser.parse(formula)
    const scope: Record<string, Value> = {}
    for (const key of expr.variables()) {
      const v = values[key]
      scope[key] = typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v)) ? Number(v) : String(v ?? '')
    }
    const result = expr.evaluate(scope)
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
