import type { FieldType } from '@/types/form'

interface Props {
  onSelect: (type: FieldType) => void
  onClose: () => void
}

const FIELD_TYPES: { type: FieldType; label: string; icon: string }[] = [
  { type: 'text',            label: 'Text',            icon: '𝐓' },
  { type: 'number',          label: 'Number',          icon: '#' },
  { type: 'decimal',         label: 'Decimal',         icon: '0.1' },
  { type: 'single_choice',   label: 'Single Choice',   icon: '◉' },
  { type: 'multiple_choice', label: 'Multiple Choice', icon: '☑' },
  { type: 'date',            label: 'Date',            icon: '📅' },
  { type: 'time',            label: 'Time',            icon: '⏰' },
  { type: 'gps',             label: 'GPS Capture',     icon: '📍' },
  { type: 'photo',           label: 'Photo',           icon: '📷' },
  { type: 'audio',           label: 'Audio',           icon: '🎙' },
  { type: 'barcode',         label: 'Barcode / QR',    icon: '▦' },
  { type: 'calculated',      label: 'Calculated',      icon: '∑' },
  { type: 'repeat_group',    label: 'Repeat Group',    icon: '⟳' },
  { type: 'note',            label: 'Note',            icon: 'ℹ' },
  { type: 'rating',          label: 'Rating Scale',    icon: '★' },
]

export default function FieldTypeMenu({ onSelect, onClose }: Props) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50,
    }} onClick={onClose}>
      <div style={{
        background: '#1e1e2e', border: '1px solid #3a3a5c', borderRadius: 12,
        padding: 24, width: 420, maxHeight: '80vh', overflowY: 'auto',
      }} onClick={e => e.stopPropagation()}>
        <h3 style={{ color: '#cdd6f4', margin: '0 0 16px', fontSize: 15 }}>Add Question</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {FIELD_TYPES.map(ft => (
            <button key={ft.type} onClick={() => { onSelect(ft.type); onClose() }} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              background: '#2a2a3e', border: '1px solid #3a3a5c', borderRadius: 8,
              color: '#cdd6f4', padding: '10px 14px', cursor: 'pointer', fontSize: 13,
              textAlign: 'left',
            }}>
              <span style={{ fontSize: 16, width: 22, textAlign: 'center' }}>{ft.icon}</span>
              {ft.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
