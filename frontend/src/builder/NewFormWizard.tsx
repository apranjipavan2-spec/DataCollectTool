import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { v4 as uuidv4 } from 'uuid'
import api from '@/lib/api'
import { useToast } from '@/lib/ToastContext'
import { Button } from '@/components/ui'

interface Program { id: string; name: string; scheme_name: string }
interface ParticipantType { id: string; name: string }

interface Props {
  onClose: () => void
}

export default function NewFormWizard({ onClose }: Props) {
  const navigate = useNavigate()
  const toast = useToast()

  const [title, setTitle] = useState('')
  const [linkProgram, setLinkProgram] = useState(false)

  const [programs, setPrograms] = useState<Program[]>([])
  const [loadingProgs, setLoadingProgs] = useState(false)
  const [selectedProgId, setSelectedProgId] = useState('')
  const [newProgName, setNewProgName] = useState('')
  const [schemeName, setSchemeName] = useState('')

  const [participantTypes, setParticipantTypes] = useState<ParticipantType[]>([])
  const [selectedTypeId, setSelectedTypeId] = useState('')
  const [newTypeName, setNewTypeName] = useState('')

  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!linkProgram) return
    setLoadingProgs(true)
    api.get('/programs/').then(r => setPrograms(r.data)).finally(() => setLoadingProgs(false))
  }, [linkProgram])

  useEffect(() => {
    setParticipantTypes([])
    setSelectedTypeId('')
    setNewTypeName('')
    if (!selectedProgId || selectedProgId === '__new__') return
    api.get(`/programs/${selectedProgId}`).then(r => setParticipantTypes(r.data.participant_types || []))
  }, [selectedProgId])

  async function handleSubmit() {
    if (!title.trim()) return
    setSubmitting(true)
    try {
      let progId = (selectedProgId && selectedProgId !== '__new__') ? selectedProgId : ''

      // Create new program if needed
      if (linkProgram && selectedProgId === '__new__' && newProgName.trim()) {
        const r = await api.post('/programs/', { name: newProgName.trim(), scheme_name: schemeName.trim() })
        progId = r.data.id
      }

      // Create form with initial schema
      const schema = { title: title.trim(), sections: [{ id: uuidv4(), title: 'Section 1', fields: [] }], version: 1 }
      const formRes = await api.post('/forms/', { title: title.trim(), json_schema: schema })
      const formId: string = formRes.data.id

      // Link to program questionnaire
      if (progId) {
        let typeId = (selectedTypeId && selectedTypeId !== '__new__') ? selectedTypeId : ''
        if (selectedTypeId === '__new__' && newTypeName.trim()) {
          const tr = await api.post(`/programs/${progId}/participant-types`, { name: newTypeName.trim() })
          typeId = tr.data.id
        }
        await api.post(`/programs/${progId}/questionnaires`, {
          name: title.trim(),
          form_id: formId,
          participant_type_id: typeId || null,
          total_target: 0,
        })
      }

      navigate(`/builder?id=${formId}`)
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Failed to create form')
      setSubmitting(false)
    }
  }

  const isNewProg = selectedProgId === '__new__'
  const isNewType = selectedTypeId === '__new__'
  const canSubmit = title.trim() && !submitting &&
    (!linkProgram || (isNewProg ? newProgName.trim() : true))

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-catalan-surface rounded-xl shadow-2xl w-full max-w-lg" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="px-6 py-5 border-b border-catalan-border flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-catalan-text">Create New Form</h2>
            <p className="text-sm text-catalan-textMuted mt-0.5">Build your form and optionally link it to a research program</p>
          </div>
          <button onClick={onClose} className="text-catalan-textMuted hover:text-catalan-text transition-colors text-xl leading-none mt-0.5">✕</button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-5">

          {/* Form title */}
          <div>
            <label className="text-sm font-medium text-catalan-text">Form Title <span className="text-catalan-error">*</span></label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && canSubmit) handleSubmit() }}
              placeholder="e.g. Beneficiary Survey Q1 2026"
              autoFocus
              className="mt-1.5 w-full border border-catalan-border rounded-lg px-3 py-2 text-sm bg-catalan-bg text-catalan-text placeholder-catalan-textMuted focus:ring-2 focus:ring-catalan-primary outline-none"
            />
          </div>

          {/* Program link toggle */}
          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={linkProgram}
              onChange={e => { setLinkProgram(e.target.checked); if (!e.target.checked) { setSelectedProgId(''); setNewProgName(''); setSchemeName('') } }}
              className="w-4 h-4 rounded accent-catalan-primary"
            />
            <span className="text-sm text-catalan-text font-medium">Link to a research program / scheme</span>
          </label>

          {linkProgram && (
            <div className="space-y-4 pl-4 border-l-2 border-catalan-primary/40 rounded-sm">

              {/* Scheme */}
              <div>
                <label className="text-xs font-semibold text-catalan-textMuted uppercase tracking-wide">Government Scheme Name</label>
                <input
                  type="text"
                  value={schemeName}
                  onChange={e => setSchemeName(e.target.value)}
                  placeholder="e.g. PMGSY, MGNREGS, POSHAN"
                  className="mt-1.5 w-full border border-catalan-border rounded-lg px-3 py-2 text-sm bg-catalan-bg text-catalan-text placeholder-catalan-textMuted focus:ring-2 focus:ring-catalan-primary outline-none"
                />
              </div>

              {/* Program */}
              <div>
                <label className="text-xs font-semibold text-catalan-textMuted uppercase tracking-wide">Program</label>
                {loadingProgs ? (
                  <p className="text-xs text-catalan-textMuted mt-1.5 italic">Loading programs…</p>
                ) : (
                  <select
                    value={selectedProgId}
                    onChange={e => setSelectedProgId(e.target.value)}
                    className="mt-1.5 w-full border border-catalan-border rounded-lg px-3 py-2 text-sm bg-catalan-bg text-catalan-text focus:ring-2 focus:ring-catalan-primary outline-none"
                  >
                    <option value="">— Select existing program —</option>
                    {programs.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.scheme_name ? `${p.scheme_name} › ` : ''}{p.name}
                      </option>
                    ))}
                    <option value="__new__">+ Create new program</option>
                  </select>
                )}
                {isNewProg && (
                  <input
                    type="text"
                    value={newProgName}
                    onChange={e => setNewProgName(e.target.value)}
                    placeholder="New program name"
                    className="mt-2 w-full border border-catalan-border rounded-lg px-3 py-2 text-sm bg-catalan-bg text-catalan-text placeholder-catalan-textMuted focus:ring-2 focus:ring-catalan-primary outline-none"
                  />
                )}
              </div>

              {/* Participant type — shown when a program is selected or being created */}
              {(selectedProgId) && (
                <div>
                  <label className="text-xs font-semibold text-catalan-textMuted uppercase tracking-wide">Participant Type</label>
                  {!isNewProg && participantTypes.length > 0 ? (
                    <select
                      value={selectedTypeId}
                      onChange={e => setSelectedTypeId(e.target.value)}
                      className="mt-1.5 w-full border border-catalan-border rounded-lg px-3 py-2 text-sm bg-catalan-bg text-catalan-text focus:ring-2 focus:ring-catalan-primary outline-none"
                    >
                      <option value="">— None / Not applicable —</option>
                      {participantTypes.map(t => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                      <option value="__new__">+ Add new type</option>
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={newTypeName}
                      onChange={e => setNewTypeName(e.target.value)}
                      placeholder="e.g. Beneficiary, Non-Beneficiary (optional)"
                      className="mt-1.5 w-full border border-catalan-border rounded-lg px-3 py-2 text-sm bg-catalan-bg text-catalan-text placeholder-catalan-textMuted focus:ring-2 focus:ring-catalan-primary outline-none"
                    />
                  )}
                  {isNewType && (
                    <input
                      type="text"
                      value={newTypeName}
                      onChange={e => setNewTypeName(e.target.value)}
                      placeholder="e.g. Beneficiary, Non-Beneficiary"
                      className="mt-2 w-full border border-catalan-border rounded-lg px-3 py-2 text-sm bg-catalan-bg text-catalan-text placeholder-catalan-textMuted focus:ring-2 focus:ring-catalan-primary outline-none"
                    />
                  )}
                </div>
              )}

            </div>
          )}

          {/* Info note */}
          {linkProgram && (
            <p className="text-xs text-catalan-textMuted leading-relaxed">
              The form will be linked as a questionnaire under the selected program — its data will appear automatically in the Progress Tracker.
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-catalan-border flex items-center justify-between">
          <p className="text-xs text-catalan-textMuted">You can always link to a program later from the Programs page.</p>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting}>Cancel</Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleSubmit}
              disabled={!canSubmit}
            >
              {submitting ? 'Creating…' : 'Create & Build →'}
            </Button>
          </div>
        </div>

      </div>
    </div>
  )
}
