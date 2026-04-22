import type { ParsedSchema, ParseWarning } from './MigrationPage'

interface Props {
  title: string
  schema: ParsedSchema
  warnings: string[]
  sectionCount: number
  fieldCount: number
  onSave: () => void
  onBack: () => void
  saving: boolean
}

const TYPE_ICON: Record<string, string> = {
  text: '📝', number: '🔢', decimal: '🔣', date: '📅', time: '⏰',
  single_choice: '🔘', multiple_choice: '☑️', gps: '📍', photo: '📷',
  audio: '🎙️', barcode: '📊', calculated: '⚡', note: '💬',
  repeat_group: '🔁', rating: '⭐',
}

export default function FormPreview({ title, schema, warnings, sectionCount, fieldCount, onSave, onBack, saving }: Props) {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-xl font-bold text-catalan-text">{title}</h3>
          <p className="text-sm text-catalan-textMuted mt-1">
            {sectionCount} section{sectionCount !== 1 ? 's' : ''} · {fieldCount} field{fieldCount !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex gap-3">
          <button onClick={onBack} className="px-4 py-2 rounded-lg border border-catalan-border text-catalan-textMuted hover:border-catalan-primary hover:text-catalan-primary transition-colors text-sm font-medium">
            ← Back
          </button>
          <button
            onClick={onSave}
            disabled={saving}
            className="px-5 py-2 rounded-lg bg-catalan-primary text-white font-semibold text-sm hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {saving ? 'Saving…' : '💾 Save as Draft Form'}
          </button>
        </div>
      </div>

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <p className="text-amber-800 font-semibold text-sm mb-2">⚠️ {warnings.length} warning{warnings.length !== 1 ? 's' : ''} — review before saving</p>
          <ul className="space-y-1">
            {warnings.map((w, i) => (
              <li key={i} className="text-amber-700 text-xs">• {w}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Sections & Fields */}
      <div className="space-y-4">
        {schema.sections.map((section, si) => (
          <div key={si} className="border border-catalan-border rounded-xl overflow-hidden">
            <div className="bg-catalan-surface px-4 py-3 border-b border-catalan-border">
              <span className="font-semibold text-catalan-text text-sm">{section.title}</span>
              <span className="ml-2 text-xs text-catalan-textMuted">({section.fields.length} fields)</span>
            </div>
            <div className="divide-y divide-catalan-border">
              {section.fields.map((field, fi) => (
                <div key={fi} className="px-4 py-2.5 flex items-center gap-3">
                  <span className="text-base flex-shrink-0">{TYPE_ICON[field.type] || '📋'}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-catalan-text truncate">{field.label}</p>
                    <p className="text-xs text-catalan-textMuted font-mono">{field.name} · {field.type}</p>
                  </div>
                  {field.required && (
                    <span className="text-xs bg-red-100 text-red-600 rounded px-1.5 py-0.5 flex-shrink-0">required</span>
                  )}
                  {field.skipLogic && (
                    <span className="text-xs bg-blue-100 text-blue-600 rounded px-1.5 py-0.5 flex-shrink-0">skip logic</span>
                  )}
                  {field.skipLogicRaw && (
                    <span className="text-xs bg-amber-100 text-amber-600 rounded px-1.5 py-0.5 flex-shrink-0">⚠️ raw logic</span>
                  )}
                  {field.type === 'repeat_group' && field.fields && (
                    <span className="text-xs bg-purple-100 text-purple-600 rounded px-1.5 py-0.5 flex-shrink-0">{field.fields.length} sub-fields</span>
                  )}
                </div>
              ))}
              {section.fields.length === 0 && (
                <p className="px-4 py-3 text-xs text-catalan-textMuted italic">No fields in this section</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
