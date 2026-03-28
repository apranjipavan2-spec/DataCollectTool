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

/** Evaluate skip logic — returns true if the field SHOULD be shown. */
export function shouldShow(field: FormField, values: Record<string, unknown>): boolean {
  if (!field.skipLogic) return true
  const { logic, conditions, action } = field.skipLogic
  const match = evaluateGroup({ logic, conditions }, values)
  return action === 'show' ? match : !match
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

/** Evaluate a simple arithmetic formula string: "farm_income + wage_income" */
export function evalFormula(formula: string, values: Record<string, unknown>): number | null {
  try {
    // Replace variable names with their numeric values
    const expr = formula.replace(/[a-zA-Z_][a-zA-Z0-9_]*/g, (v) => String(Number(values[v] ?? 0)))
    // eslint-disable-next-line no-new-func
    return Function(`"use strict"; return (${expr})`)() as number
  } catch {
    return null
  }
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
    sections: schema.sections.map(sec =>
      sec.id !== sectionId ? sec : {
        ...sec,
        fields: sec.fields.map(f => f.id !== fieldId ? f : { ...f, ...patch }),
      }
    ),
  }
}
