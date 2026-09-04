/**
 * Build a human-readable question→answer record from a form schema + the filled
 * values. Rides inside the encrypted backup capsule so a downloaded/recovered
 * response carries FULL detail (question text + resolved answers), not just raw
 * field ids — and survives later schema changes.
 */
import type { FormSchema, FormField } from '@/types/form'

export interface QAItem { name: string; question: string; answer: string }

function resolveAnswer(field: FormField, value: unknown): string {
  if (value === null || value === undefined || value === '') return ''
  // Map choice values back to their human labels.
  if (field.options && (field.type === 'single_choice' || field.type === 'multiple_choice')) {
    const label = (v: unknown) => field.options!.find(o => o.value === String(v))?.label ?? String(v)
    return Array.isArray(value) ? value.map(label).join(', ') : label(value)
  }
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'string' && value.startsWith('data:')) return '[media file]'
  return String(value)
}

export function buildQA(schema: FormSchema, values: Record<string, unknown>): QAItem[] {
  const out: QAItem[] = []
  const walkFields = (fields: FormField[]) => {
    for (const f of fields) {
      if (f.type === 'note') continue
      if (f.fields?.length) { walkFields(f.fields); continue }  // repeat_group children
      if (Object.prototype.hasOwnProperty.call(values, f.name)) {
        out.push({ name: f.name, question: f.label || f.name, answer: resolveAnswer(f, values[f.name]) })
      }
    }
  }
  const walkSections = (secs: FormSchema['sections']) => {
    for (const s of secs) {
      walkFields(s.fields)
      if (s.subsections?.length) walkSections(s.subsections)
    }
  }
  walkSections(schema.sections)
  return out
}
