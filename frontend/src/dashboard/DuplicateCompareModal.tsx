import { useState, useEffect, useMemo } from 'react'
import api, { apiErrorMessage } from '@/lib/api'
import { useToast } from '@/lib/ToastContext'
import { resolveAnswer } from '@/collect/responseRecord'
import { useFormFieldMap } from '@/lib/useFormFieldMap'
import { Modal, Button } from '@/components/ui'
import type { FormField } from '@/types/form'
import type { DuplicateGroup } from './Dashboard.modern'

interface FullSub {
  id: string
  serial_no: number | null
  enumerator_name: string
  status: string
  server_received_at: string
  form_version?: number
  data_json: Record<string, unknown>
}

function displayValue(field: FormField | undefined, val: unknown): string {
  if (val === null || val === undefined || val === '') return '—'
  if (field?.options && (field.type === 'single_choice' || field.type === 'multiple_choice')) {
    return resolveAnswer(field, val)
  }
  if (Array.isArray(val)) return val.join(', ')
  if (typeof val === 'object') return JSON.stringify(val)
  return String(val)
}

export function DuplicateCompareModal({
  group, onClose, onResolved,
}: {
  group: DuplicateGroup
  onClose: () => void
  onResolved: () => void
}) {
  const toast = useToast()
  const [subs, setSubs] = useState<FullSub[] | null>(null)
  const [loading, setLoading] = useState(group.tier !== 'exact')
  const [keepId, setKeepId] = useState(group.recommended_keep_id)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (group.tier === 'exact') return
    api.get('/submissions/', { params: { ids: group.submission_ids.join(','), slim: false, page_size: group.submission_ids.length } })
      .then(r => setSubs(r.data.items))
      .catch(() => toast.error('Could not load submissions for comparison'))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.submission_ids.join(',')])

  const firstVersion = subs?.[0]?.form_version ?? ''
  const fieldMap = useFormFieldMap(group.form_id, firstVersion)

  const resolve = async (finalKeepId: string) => {
    setBusy(true)
    try {
      await api.post('/submissions/duplicates/resolve', {
        keep_id: finalKeepId,
        duplicate_ids: group.submission_ids.filter(id => id !== finalKeepId),
      })
      toast.success(`Kept 1, marked ${group.submission_ids.length - 1} as duplicate`)
      onResolved()
      onClose()
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Failed to resolve duplicates'))
    } finally {
      setBusy(false)
    }
  }

  const dismiss = async () => {
    setBusy(true)
    try {
      await api.post('/submissions/duplicates/dismiss', { submission_ids: group.submission_ids })
      toast.success('Dismissed — these will no longer be flagged together')
      onResolved()
      onClose()
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Failed to dismiss'))
    } finally {
      setBusy(false)
    }
  }

  // ── Tier "exact": every answer is identical — nothing to compare ──────────
  if (group.tier === 'exact') {
    const recommended = group.submissions.find(s => s.id === group.recommended_keep_id)
    return (
      <Modal isOpen onClose={onClose} title="Exact Duplicates" size="md"
        footer={<>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy} onClick={() => resolve(group.recommended_keep_id)}>
            {busy ? 'Resolving…' : `Auto-resolve — keep #${recommended?.serial_no ?? ''}`}
          </Button>
        </>}>
        <p className="text-sm text-catalan-text mb-3">
          {group.count} submissions from <strong>{group.enumerator_name}</strong> on {group.form_title} ({group.day})
          have 100% identical answers.
        </p>
        <div className="bg-catalan-surface2 border border-catalan-border rounded-lg p-3 text-sm">
          Recommended: keep <strong>#{recommended?.serial_no}</strong> — submitted first
          ({recommended?.server_received_at ? new Date(recommended.server_received_at).toLocaleString() : 'unknown'}).
          The other {group.count - 1} will be marked as duplicate (reversible via Restore).
        </div>
      </Modal>
    )
  }

  // ── Tier "possible": answers differ — full side-by-side compare ───────────
  const rows = useMemo(() => {
    if (!subs) return []
    const seen = new Set<string>()
    const keys: string[] = []
    for (const name of Object.keys(fieldMap)) { keys.push(name); seen.add(name) }
    for (const s of subs) {
      for (const k of Object.keys(s.data_json || {})) {
        if (!k.startsWith('_') && !seen.has(k)) { keys.push(k); seen.add(k) }
      }
    }
    return keys
  }, [subs, fieldMap])

  const recommended = group.submissions.find(s => s.id === group.recommended_keep_id)
  const submissionById = (id: string) => group.submissions.find(s => s.id === id)

  return (
    <Modal isOpen onClose={onClose}
      title={group.tier === 'identifier_match' ? 'Same Respondent? — Identifier Match' : 'Compare & Resolve Duplicates'}
      size="lg"
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="secondary" disabled={busy} onClick={dismiss}>Not duplicates — dismiss</Button>
        <Button variant="primary" disabled={busy || !keepId} onClick={() => resolve(keepId)}>
          {busy ? 'Resolving…' : `Confirm — mark ${group.count - 1} as duplicate`}
        </Button>
      </>}>
      {group.matched_fields && (
        <p className="text-xs text-catalan-textMuted mb-2">
          Matched on: <strong>{group.matched_fields.join(', ')}</strong> — every other answer below may differ.
        </p>
      )}
      <div className="bg-catalan-surface2 border border-catalan-border rounded-lg p-3 text-sm mb-3 flex items-center justify-between gap-3">
        <span>
          Recommended: keep <strong>#{recommended?.serial_no}</strong>
          {recommended?.has_violations === false && recommended?.backcheck_completed
            ? ' — backchecked, no QC violations.'
            : ' — most complete answers, longest interview.'}
        </span>
        <Button variant="ghost" onClick={() => setKeepId(group.recommended_keep_id)}>Use recommendation</Button>
      </div>

      {loading ? (
        <p className="text-sm text-catalan-textMuted text-center py-6">Loading submissions…</p>
      ) : !subs || subs.length < 2 ? (
        <p className="text-sm text-catalan-textMuted text-center py-6">Could not load these submissions.</p>
      ) : (
        <div className="overflow-x-auto border border-catalan-border rounded-lg">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-catalan-surface2">
                <th className="text-left px-3 py-2 sticky left-0 bg-catalan-surface2 min-w-[160px]">Question</th>
                {subs.map(s => {
                  const qc = submissionById(s.id)
                  return (
                    <th key={s.id} className="text-left px-3 py-2 min-w-[180px] align-top">
                      <label className="flex items-start gap-2 cursor-pointer font-normal">
                        <input type="radio" name="keep" checked={keepId === s.id}
                          onChange={() => setKeepId(s.id)} className="mt-1" />
                        <span>
                          <div className="font-semibold text-catalan-text">#{s.serial_no ?? s.id.slice(0, 8)}</div>
                          <div className="text-xs text-catalan-textMuted">{s.enumerator_name}</div>
                          <div className="text-xs text-catalan-textMuted">
                            {s.server_received_at ? new Date(s.server_received_at).toLocaleString() : ''}
                          </div>
                          <div className="flex gap-1 mt-0.5">
                            {qc?.has_violations && <span className="text-xs text-catalan-error bg-catalan-error/10 px-1 rounded">⚠ Violations</span>}
                            {qc?.backcheck_completed && <span className="text-xs text-catalan-success bg-catalan-success/10 px-1 rounded">✓ Backchecked</span>}
                          </div>
                          {s.id === group.recommended_keep_id && (
                            <span className="text-xs text-catalan-primary font-medium">★ Recommended</span>
                          )}
                        </span>
                      </label>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map(key => {
                const field = fieldMap[key]
                const values = subs.map(s => displayValue(field, s.data_json?.[key]))
                const differs = new Set(values).size > 1
                return (
                  <tr key={key} className={`border-t border-catalan-border ${differs ? 'bg-catalan-warning/10' : ''}`}>
                    <td className="px-3 py-2 sticky left-0 bg-catalan-surface text-xs text-catalan-textMuted">
                      {field?.label ?? key}
                    </td>
                    {values.map((v, i) => (
                      <td key={subs[i].id} className={`px-3 py-2 ${differs ? 'font-medium text-catalan-text' : 'text-catalan-textMuted'}`}>
                        {v}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  )
}
