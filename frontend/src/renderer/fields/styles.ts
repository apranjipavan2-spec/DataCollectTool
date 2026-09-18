// ── Tailwind class strings replacing inline CSSProperties ──────────────────
// All field components import these and use className= instead of style=

/** Field question label */
export const labelCls =
  'block text-base font-medium text-catalan-text mb-1.5 leading-snug'

/** Required asterisk */
export const requiredCls = 'text-catalan-error ml-0.5'

/** Help / hint text */
export const hintCls =
  'text-sm text-catalan-textMuted mb-2.5 leading-relaxed'

/** Standard text / number / date input */
export const inputCls =
  'w-full bg-catalan-hover border border-catalan-border text-catalan-text rounded-xl px-4 py-3.5 text-base outline-none focus:border-catalan-primary transition-colors [color-scheme:dark]'

/** Number input — larger centred text */
export const numberInputCls =
  'w-full bg-catalan-hover border border-catalan-border text-catalan-text rounded-xl px-4 py-3.5 text-2xl text-center outline-none focus:border-catalan-primary transition-colors'

/** Single / multiple choice option button */
export const optionBtnCls = (selected: boolean) =>
  `flex items-center gap-3 w-full rounded-xl px-4 py-3.5 cursor-pointer text-base text-left mb-2 transition-colors border ${
    selected
      ? 'bg-catalan-primary/10 border-catalan-primary text-catalan-primary'
      : 'bg-catalan-hover border-catalan-border text-catalan-text'
  }`

/** Generic media-capture button (photo / audio / GPS) */
export const captureButtonCls =
  'w-full bg-catalan-hover border border-catalan-border text-catalan-text rounded-xl p-4 cursor-pointer text-base flex flex-col items-center gap-1.5 transition-colors hover:border-catalan-primary/60 disabled:opacity-50 disabled:cursor-wait'

/** Destructive / recording state button */
export const recordingButtonCls =
  'w-full bg-catalan-error/10 border border-catalan-error text-catalan-error rounded-xl p-4 cursor-pointer text-base flex flex-col items-center gap-1.5 transition-colors'

/** Error message below a field */
export const fieldErrorCls = 'text-catalan-error text-sm mt-1.5'

/** Success / confirmation message */
export const fieldSuccessCls = 'text-catalan-success text-sm mt-1.5 text-center'

/** Muted helper text below a field */
export const fieldHintCls = 'text-catalan-textMuted text-xs mt-1.5 text-center'

// ── Legacy exports (keep to avoid build errors during migration) ─────────────
// These are plain JS objects so old callers won't crash, but new code should
// use the *Cls strings above.
import type React from 'react'
export const label: React.CSSProperties = {
  color: '#cdd6f4', fontSize: 16, fontWeight: 500, display: 'block', marginBottom: 6, lineHeight: 1.4,
}
export const hint: React.CSSProperties = {
  color: '#6c7086', fontSize: 13, marginBottom: 10, lineHeight: 1.5,
}
export const inp: React.CSSProperties = {
  width: '100%', background: '#2a2a3e', border: '1px solid #3a3a5c',
  color: '#cdd6f4', borderRadius: 10, padding: '14px', fontSize: 16,
  boxSizing: 'border-box', outline: 'none',
}
export const optionBtn = (selected: boolean): React.CSSProperties => ({
  display: 'flex', alignItems: 'center', gap: 12,
  width: '100%', background: selected ? '#1e3a5f' : '#2a2a3e',
  border: `1px solid ${selected ? '#89b4fa' : '#3a3a5c'}`,
  color: selected ? '#89b4fa' : '#cdd6f4',
  borderRadius: 10, padding: '14px 16px', cursor: 'pointer',
  fontSize: 15, textAlign: 'left', marginBottom: 8,
  transition: 'border-color 0.15s, background 0.15s',
})
