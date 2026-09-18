import { useState, useEffect } from 'react'
import api from '@/lib/api'
import { getAllFieldsInOrder } from '@/lib/formUtils'
import type { FormSchema, FormField } from '@/types/form'

/**
 * Fetch a form's schema and return name -> FormField (label + options + type),
 * used to decode raw answer codes into human-readable text.
 *
 * Prefers the historical version snapshot (matches the schema active when a
 * given submission was collected); forms imported via Excel/Word never got a
 * FormVersion row, so falls back to the current published schema.
 */
export function useFormFieldMap(formId: string, formVersion: number | string): Record<string, FormField> {
  const [fieldMap, setFieldMap] = useState<Record<string, FormField>>({})

  useEffect(() => {
    setFieldMap({})
    api.get(`/forms/${formId}/versions/${formVersion}`)
      .catch(() => api.get(`/forms/${formId}`))
      .then(r => {
        const schema: FormSchema = r.data.json_schema
        if (!schema?.sections) return
        const map: Record<string, FormField> = {}
        for (const f of getAllFieldsInOrder(schema.sections)) {
          if (f.label) map[f.name] = f
        }
        setFieldMap(map)
      })
      .catch(() => {})
  }, [formId, formVersion])

  return fieldMap
}
