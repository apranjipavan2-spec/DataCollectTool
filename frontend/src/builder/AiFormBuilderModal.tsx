import { useState, useEffect, useRef } from 'react'
import api from '@/lib/api'

interface Props {
  onClose: () => void
  onFormGenerated: (formId: string, title: string) => void
}

const STUDY_TYPES = [
  { value: 'field_survey',     label: '📊 Field Survey / Household Survey' },
  { value: 'health_assessment',label: '🏥 Health / WASH / Nutrition Assessment' },
  { value: 'agriculture',      label: '🌾 Agricultural / Livelihood Survey' },
  { value: 'government_program', label: '🏛️ Government Program Monitoring (MGNREGA, PMAY, etc.)' },
  { value: 'rct_baseline',     label: '🔬 RCT Baseline / Endline' },
  { value: 'ngo_monitoring',   label: '🌍 NGO M&E / Impact Assessment' },
  { value: 'education',        label: '📚 Education / School Survey' },
  { value: 'custom',           label: '✏️ Custom / Other' },
]

const LOADING_MSGS = [
  'Reading your study objectives…',
  'Designing question structure and sections…',
  'Selecting appropriate field types…',
  'Building skip logic and conditional flows…',
  'Sequencing questions chronologically…',
  'Adding validation rules…',
  'Reviewing sub-questions and linked questions…',
  'Finalising form schema…',
  'Almost ready — polishing the form…',
]

export default function AiFormBuilderModal({ onClose, onFormGenerated }: Props) {
  const [step, setStep] = useState<'objectives' | 'generating' | 'done' | 'error'>('objectives')
  const [studyType, setStudyType] = useState('field_survey')
  const [objectives, setObjectives] = useState('')
  const [referenceForms, setReferenceForms] = useState<{ id: string; title: string }[]>([])
  const [selectedRefIds, setSelectedRefIds] = useState<string[]>([])
  const [loadingMsg, setLoadingMsg] = useState(LOADING_MSGS[0])
  const [msgIdx, setMsgIdx] = useState(0)
  const [generatedFormId, setGeneratedFormId] = useState('')
  const [generatedTitle, setGeneratedTitle] = useState('')
  const [error, setError] = useState('')
  const [isBackground, setIsBackground] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const msgRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    api.get('/forms/?status=active').then(({ data }) => {
      setReferenceForms((data as any[]).slice(0, 20).map((f: any) => ({ id: f.id, title: f.title })))
    }).catch(() => {})
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
      if (msgRef.current) clearInterval(msgRef.current)
    }
  }, [])

  const startLoadingMessages = () => {
    let i = 0
    msgRef.current = setInterval(() => {
      i = (i + 1) % LOADING_MSGS.length
      setMsgIdx(i)
      setLoadingMsg(LOADING_MSGS[i])
    }, 3500)
  }

  const pollStatus = (formId: string) => {
    pollRef.current = setInterval(async () => {
      try {
        const { data } = await api.get(`/forms/${formId}/generation-status`)
        if (data.status === 'done') {
          clearInterval(pollRef.current!)
          clearInterval(msgRef.current!)
          setGeneratedFormId(formId)
          setGeneratedTitle(data.title || 'Generated Form')
          setStep('done')
        } else if (data.status === 'failed') {
          clearInterval(pollRef.current!)
          clearInterval(msgRef.current!)
          setError(data.error || 'AI generation failed. Please try again.')
          setStep('error')
        }
      } catch { /* keep polling */ }
    }, 4000)
  }

  const handleGenerate = async () => {
    if (!objectives.trim()) return
    const estimatedSecs = objectives.length > 500 ? 90 : 60
    setIsBackground(estimatedSecs > 60)
    setStep('generating')
    startLoadingMessages()
    try {
      const { data } = await api.post('/ai/generate-form', {
        objectives,
        study_type: studyType,
        reference_form_ids: selectedRefIds,
      })
      if (data.status === 'pending') {
        pollStatus(data.form_id)
      } else {
        // Immediate (shouldn't happen but handle gracefully)
        setGeneratedFormId(data.form_id)
        setStep('done')
      }
    } catch (e: any) {
      clearInterval(msgRef.current!)
      setError(e.response?.data?.detail || 'Failed to start generation')
      setStep('error')
    }
  }

  const toggleRef = (id: string) => {
    setSelectedRefIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id].slice(0, 3))
  }

  const inp = 'w-full border border-catalan-border rounded-lg px-3 py-2 text-sm bg-catalan-bg text-catalan-text focus:ring-2 focus:ring-catalan-primary outline-none'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-catalan-surface border border-catalan-border rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-catalan-border">
          <div>
            <h2 className="text-lg font-bold text-catalan-text">🤖 AI Form Builder</h2>
            <p className="text-xs text-catalan-textMuted mt-0.5">Describe your study — AI will design a complete, field-ready form</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg bg-catalan-hover text-catalan-textMuted hover:text-catalan-error transition-colors flex items-center justify-center text-lg">&times;</button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">

          {/* STEP: Objectives */}
          {step === 'objectives' && (
            <div className="space-y-5">
              <div>
                <label className="text-xs font-semibold text-catalan-textMuted uppercase tracking-wide block mb-2">Study Type</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {STUDY_TYPES.map(st => (
                    <button
                      key={st.value}
                      onClick={() => setStudyType(st.value)}
                      className={`text-left text-xs px-3 py-2.5 rounded-lg border transition-all ${
                        studyType === st.value
                          ? 'border-catalan-primary bg-catalan-primary/10 text-catalan-primary font-semibold'
                          : 'border-catalan-border text-catalan-text hover:border-catalan-primary/50'
                      }`}
                    >
                      {st.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-catalan-textMuted uppercase tracking-wide block mb-1">
                  Study Objectives & Context <span className="text-catalan-error">*</span>
                </label>
                <textarea
                  className={`${inp} min-h-[160px] resize-y`}
                  placeholder={`Describe your study in detail. The more context you give, the better the form.

Examples:
• "Household survey for MGNREGA beneficiaries in Karnataka. We need to collect data on work days, wages, bank account linkage, awareness of scheme, and grievances. Include demographic section with caste, gender, landholding."
• "Baseline survey for a nutrition intervention. Track child height/weight, MUAC, dietary diversity score, WASH practices, mother's education and income. Include repeat group for children under 5."
• "Agricultural input survey in Vidarbha. Crop type, area, input costs, credit access, weather shocks, insurance uptake, distress indicators."`}
                  value={objectives}
                  onChange={e => setObjectives(e.target.value)}
                />
                <div className="flex justify-between mt-1">
                  <p className="text-xs text-catalan-textMuted">Include: target population, key variables, sub-groups, any government scheme identifiers needed</p>
                  <span className={`text-xs ${objectives.length < 100 ? 'text-catalan-warning' : 'text-catalan-textMuted'}`}>{objectives.length} chars</span>
                </div>
              </div>

              {referenceForms.length > 0 && (
                <div>
                  <label className="text-xs font-semibold text-catalan-textMuted uppercase tracking-wide block mb-1">
                    Reference from existing forms <span className="text-catalan-textMuted font-normal">(optional — helps AI match your naming conventions)</span>
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-40 overflow-y-auto">
                    {referenceForms.map(f => (
                      <button
                        key={f.id}
                        onClick={() => toggleRef(f.id)}
                        className={`text-left text-xs px-3 py-2 rounded-lg border transition-all truncate ${
                          selectedRefIds.includes(f.id)
                            ? 'border-catalan-primary bg-catalan-primary/10 text-catalan-primary font-semibold'
                            : 'border-catalan-border text-catalan-text hover:border-catalan-primary/40'
                        }`}
                      >
                        {selectedRefIds.includes(f.id) ? '✓ ' : ''}{f.title}
                      </button>
                    ))}
                  </div>
                  {selectedRefIds.length > 0 && (
                    <p className="text-xs text-catalan-primary mt-1">{selectedRefIds.length} form(s) selected as reference</p>
                  )}
                </div>
              )}

              <div className="bg-catalan-info/5 border border-catalan-info/20 rounded-xl p-4 text-xs text-catalan-textMuted space-y-1">
                <div className="font-semibold text-catalan-text mb-1">What AI will generate for you:</div>
                <div>✓ 4–8 logical sections (Consent, Demographics, Study-specific, Remarks)</div>
                <div>✓ 20–45 questions with correct field types (choice, GPS, photo, repeat groups)</div>
                <div>✓ Skip logic for conditional sections</div>
                <div>✓ Validation rules (min/max, required)</div>
                <div>✓ Enumerator hints and interviewer instructions</div>
                <div className="pt-1 text-catalan-warning">⏱ Takes 1–2 minutes. You can come back — it runs in the background.</div>
              </div>
            </div>
          )}

          {/* STEP: Generating */}
          {step === 'generating' && (
            <div className="flex flex-col items-center justify-center py-12 space-y-6 text-center">
              <div className="relative">
                <div className="w-20 h-20 rounded-full border-4 border-catalan-primary/20 border-t-catalan-primary animate-spin" />
                <div className="absolute inset-0 flex items-center justify-center text-3xl">🤖</div>
              </div>
              <div>
                <h3 className="text-lg font-bold text-catalan-text mb-2">Building your form…</h3>
                <p className="text-sm text-catalan-primary font-medium min-h-[20px] transition-all">{loadingMsg}</p>
              </div>
              <div className="flex gap-1.5">
                {LOADING_MSGS.map((_, i) => (
                  <div key={i} className={`w-2 h-2 rounded-full transition-all ${i === msgIdx ? 'bg-catalan-primary' : 'bg-catalan-border'}`} />
                ))}
              </div>
              {isBackground && (
                <div className="bg-catalan-warning/10 border border-catalan-warning/30 rounded-xl p-4 max-w-sm text-sm text-catalan-warning">
                  <strong>This is running in the background.</strong><br/>
                  You can close this window and come back in 1–2 minutes. The form will be in your Drafts when ready.
                </div>
              )}
            </div>
          )}

          {/* STEP: Done */}
          {step === 'done' && (
            <div className="flex flex-col items-center justify-center py-10 space-y-5 text-center">
              <div className="text-6xl">✅</div>
              <div>
                <h3 className="text-xl font-bold text-catalan-success mb-2">Form Generated!</h3>
                <p className="text-sm text-catalan-textMuted">
                  <strong className="text-catalan-text">"{generatedTitle}"</strong> is ready to edit.
                </p>
                <p className="text-xs text-catalan-textMuted mt-1">
                  Review all questions, update labels, add your org's specific fields, then activate.
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => onFormGenerated(generatedFormId, generatedTitle)}
                  className="px-5 py-2.5 bg-catalan-primary text-catalan-bg rounded-xl font-semibold text-sm hover:opacity-90 transition-opacity"
                >
                  Open in Form Builder →
                </button>
                <button
                  onClick={onClose}
                  className="px-5 py-2.5 border border-catalan-border text-catalan-text rounded-xl text-sm hover:bg-catalan-hover transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          )}

          {/* STEP: Error */}
          {step === 'error' && (
            <div className="flex flex-col items-center justify-center py-10 space-y-5 text-center">
              <div className="text-5xl">⚠️</div>
              <div>
                <h3 className="text-lg font-bold text-catalan-error mb-2">Generation Failed</h3>
                <p className="text-sm text-catalan-textMuted max-w-sm">{error}</p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => { setStep('objectives'); setError('') }}
                  className="px-5 py-2.5 bg-catalan-primary text-catalan-bg rounded-xl font-semibold text-sm hover:opacity-90"
                >
                  Try Again
                </button>
                <button onClick={onClose} className="px-5 py-2.5 border border-catalan-border text-catalan-text rounded-xl text-sm hover:bg-catalan-hover">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {step === 'objectives' && (
          <div className="px-6 py-4 border-t border-catalan-border flex justify-between items-center">
            <button onClick={onClose} className="text-sm text-catalan-textMuted hover:text-catalan-text transition-colors">Cancel</button>
            <button
              onClick={handleGenerate}
              disabled={objectives.trim().length < 30}
              className="px-5 py-2.5 bg-catalan-primary text-catalan-bg rounded-xl font-semibold text-sm hover:opacity-90 disabled:opacity-40 transition-opacity flex items-center gap-2"
            >
              <span>🤖</span> Generate Form
              {objectives.trim().length < 30 && <span className="text-catalan-bg/60 text-xs">(describe more)</span>}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
