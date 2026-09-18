import type { FormField } from '@/types/form'

interface Props { field: FormField }

export default function NoteField({ field }: Props) {
  return (
    <div className="bg-catalan-hover border border-catalan-border rounded-xl px-4 py-3.5">
      <div className="text-catalan-primary font-medium text-base mb-1">{field.label}</div>
      {field.hint && (
        <div className="text-catalan-textMuted text-sm leading-relaxed">{field.hint}</div>
      )}
    </div>
  )
}
