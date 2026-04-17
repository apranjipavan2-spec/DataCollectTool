import type { FieldType } from '@/types/form'

interface Props {
  onSelect: (type: FieldType) => void
  onClose: () => void
}

const FIELD_TYPES: { type: FieldType; label: string; icon: string; description: string }[] = [
  { type: 'text',            label: 'Text',            icon: '𝐓',  description: 'Short or long text answer' },
  { type: 'number',          label: 'Number',          icon: '#',  description: 'Integer value with optional range' },
  { type: 'decimal',         label: 'Decimal',         icon: '0.1',description: 'Float value (e.g. 3.14)' },
  { type: 'single_choice',   label: 'Single Choice',   icon: '◉',  description: 'Pick one from a list' },
  { type: 'multiple_choice', label: 'Multiple Choice', icon: '☑',  description: 'Pick many from a list' },
  { type: 'date',            label: 'Date',            icon: '📅', description: 'Calendar date picker' },
  { type: 'time',            label: 'Time',            icon: '⏰', description: 'Time of day' },
  { type: 'gps',             label: 'GPS',             icon: '📍', description: 'Capture coordinates' },
  { type: 'photo',           label: 'Photo',           icon: '📷', description: 'Camera capture or gallery' },
  { type: 'audio',           label: 'Audio',           icon: '🎙', description: 'Voice recording' },
  { type: 'barcode',         label: 'Barcode / QR',    icon: '▦',  description: 'Scan a barcode' },
  { type: 'calculated',      label: 'Calculated',      icon: '∑',  description: 'Auto-compute from other fields' },
  { type: 'repeat_group',    label: 'Repeat Group',    icon: '⟳',  description: 'Repeatable set of fields' },
  { type: 'note',            label: 'Note',            icon: 'ℹ',  description: 'Instructional text only' },
  { type: 'rating',          label: 'Rating Scale',    icon: '★',  description: '1–5 or 1–10 rating' },
]

export default function FieldTypeMenu({ onSelect, onClose }: Props) {
  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-catalan-surface border border-catalan-border rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-catalan-border flex-shrink-0">
          <h3 className="text-base font-semibold text-catalan-text">Add Question</h3>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-catalan-textMuted hover:text-catalan-text hover:bg-catalan-hover transition-colors"
          >
            ×
          </button>
        </div>

        {/* Grid */}
        <div className="overflow-y-auto p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {FIELD_TYPES.map(ft => (
              <button
                key={ft.type}
                onClick={() => { onSelect(ft.type); onClose() }}
                className="flex items-center gap-3 bg-catalan-hover border border-catalan-border rounded-lg px-3.5 py-3 text-left cursor-pointer hover:border-catalan-primary hover:bg-catalan-primary/5 transition-all group"
              >
                <span className="text-xl w-7 text-center flex-shrink-0 leading-none">{ft.icon}</span>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-catalan-text group-hover:text-catalan-primary transition-colors">
                    {ft.label}
                  </div>
                  <div className="text-xs text-catalan-textMuted truncate">{ft.description}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
