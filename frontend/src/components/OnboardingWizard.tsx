import { useState, useEffect } from 'react'
import api from '@/lib/api'
import EmojiIcon from '@/components/EmojiIcon'
import Select from '@/components/Select'

const STORAGE_KEY = 'fg_onboarding_done'

interface Step {
  id: number
  title: string
  desc: string
}

const STEPS: Step[] = [
  { id: 1, title: 'Set up your organisation', desc: "Name your workspace and upload a logo — this appears on all field reports and public survey links." },
  { id: 2, title: 'Build your first form', desc: "Describe your survey in plain English and let AI generate the questions. You can edit everything." },
  { id: 3, title: 'Invite your team', desc: "Add a supervisor or enumerator. They'll get a login link and can start collecting data immediately." },
  { id: 4, title: "You're ready to go", desc: "Head to the dashboard to deploy your form, monitor submissions, and run reports." },
]

const inp = 'w-full border border-catalan-border rounded-lg px-3 py-2.5 text-sm bg-catalan-bg text-catalan-text focus:outline-none focus:ring-2 focus:ring-catalan-primary'
const label = 'block text-sm font-medium text-catalan-textSecondary mb-1'
const btnPrimary = 'bg-catalan-primary hover:opacity-90 text-catalan-bg font-semibold rounded-lg py-2.5 text-sm transition-opacity disabled:opacity-50'
const btnSecondary = 'border border-catalan-border text-catalan-textSecondary font-medium rounded-lg py-2.5 text-sm hover:bg-catalan-hover transition-colors'

export default function OnboardingWizard() {
  const [visible, setVisible] = useState(false)
  const [step, setStep] = useState(1)
  const [orgName, setOrgName] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [invitePhone, setInvitePhone] = useState('')
  const [inviteRole, setInviteRole] = useState('enumerator')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (localStorage.getItem(STORAGE_KEY)) return
    // Show wizard only to org_admin on first login
    try {
      const user = JSON.parse(localStorage.getItem('fp_user') ?? '{}')
      if (user.role === 'org_admin') setVisible(true)
    } catch { /* ignore */ }
  }, [])

  function dismiss() {
    localStorage.setItem(STORAGE_KEY, '1')
    setVisible(false)
  }

  async function handleStep1() {
    if (!orgName.trim()) { setError('Please enter your organisation name'); return }
    setLoading(true); setError('')
    try {
      await api.patch('/tenants/my', { name: orgName.trim() })
      setStep(2)
    } catch { setError('Failed to save — try again') }
    finally { setLoading(false) }
  }

  async function handleStep2() {
    if (!formDescription.trim()) { setStep(3); return } // skip if empty
    setLoading(true); setError('')
    try {
      await api.post('/ai/generate-form', { description: formDescription.trim() })
      setStep(3)
    } catch { setError('AI form generation failed — you can build manually from the dashboard') }
    finally { setLoading(false) }
  }

  async function handleStep3() {
    if (!inviteEmail.trim() && !invitePhone.trim()) { setStep(4); return }
    setLoading(true); setError('')
    try {
      await api.post('/users/invite', {
        email: inviteEmail.trim() || undefined,
        phone: invitePhone.trim() || undefined,
        role: inviteRole,
        name: '',
      })
      setStep(4)
    } catch { setError('Invite failed — you can add team members later from Settings') }
    finally { setLoading(false) }
  }

  if (!visible) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-catalan-surface rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        {/* Progress bar */}
        <div className="h-1 bg-catalan-hover">
          <div
            className="h-1 bg-catalan-primary transition-all duration-500"
            style={{ width: `${(step / STEPS.length) * 100}%` }}
          />
        </div>

        {/* Header */}
        <div className="px-6 pt-5 pb-4 border-b border-catalan-border flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-catalan-primary uppercase tracking-wider mb-1">
              Step {step} of {STEPS.length}
            </p>
            <h2 className="text-lg font-bold text-catalan-text">
              {STEPS[step - 1].title}
            </h2>
            <p className="text-sm text-catalan-textMuted mt-0.5">{STEPS[step - 1].desc}</p>
          </div>
          <button
            onClick={dismiss}
            className="text-catalan-textMuted hover:text-catalan-text text-xl font-light leading-none p-1"
            title="Skip setup"
          >
            ×
          </button>
        </div>

        {/* Step content */}
        <div className="px-6 py-5">
          {error && (
            <p className="text-catalan-error text-sm mb-3 bg-catalan-error/10 rounded-lg px-3 py-2">{error}</p>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className={label}>
                  Organisation name
                </label>
                <input
                  type="text"
                  value={orgName}
                  onChange={e => setOrgName(e.target.value)}
                  placeholder="e.g. Pratham Education Foundation"
                  className={inp}
                  autoFocus
                />
              </div>
              <button
                onClick={handleStep1}
                disabled={loading}
                className={`w-full ${btnPrimary}`}
              >
                {loading ? 'Saving…' : 'Continue →'}
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div>
                <label className={label}>
                  Describe your survey <span className="text-catalan-textMuted font-normal">(optional)</span>
                </label>
                <textarea
                  value={formDescription}
                  onChange={e => setFormDescription(e.target.value)}
                  placeholder="e.g. A household survey to track WASH outcomes in rural Maharashtra — cover water source, sanitation facilities, hygiene practices, and 5-year trend questions."
                  rows={4}
                  className={`${inp} resize-none`}
                  autoFocus
                />
                <p className="text-xs text-catalan-textMuted mt-1">AI will generate a draft form — you can edit all questions before publishing.</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setStep(3)}
                  className={`flex-1 ${btnSecondary}`}
                >
                  Skip for now
                </button>
                <button
                  onClick={handleStep2}
                  disabled={loading}
                  className={`flex-1 ${btnPrimary}`}
                >
                  {loading ? 'Generating…' : 'Generate form →'}
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={label}>
                    Email <span className="text-catalan-textMuted font-normal">(optional)</span>
                  </label>
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={e => setInviteEmail(e.target.value)}
                    placeholder="team@org.com"
                    className={inp}
                  />
                </div>
                <div>
                  <label className={label}>
                    Phone
                  </label>
                  <input
                    type="tel"
                    value={invitePhone}
                    onChange={e => setInvitePhone(e.target.value)}
                    placeholder="+91 98765 43210"
                    className={inp}
                  />
                </div>
              </div>
              <div>
                <label className={label}>Role</label>
                <Select
                  value={inviteRole}
                  onChange={e => setInviteRole(e.target.value)}
                  className="w-full py-2.5"
                >
                  <option value="enumerator">Enumerator (field data collector)</option>
                  <option value="supervisor">Supervisor (reviews submissions)</option>
                  <option value="org_admin">Org Admin (full access)</option>
                </Select>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setStep(4)}
                  className={`flex-1 ${btnSecondary}`}
                >
                  Skip for now
                </button>
                <button
                  onClick={handleStep3}
                  disabled={loading}
                  className={`flex-1 ${btnPrimary}`}
                >
                  {loading ? 'Sending invite…' : 'Send invite →'}
                </button>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4 text-center py-2">
              <div className="text-5xl"><EmojiIcon e="🎉" /></div>
              <p className="text-catalan-textSecondary text-sm leading-relaxed">
                Your workspace is set up. Head to the dashboard to publish your first form, assign it to enumerators, and watch submissions come in — even offline.
              </p>
              <div className="bg-catalan-primary/10 rounded-lg px-4 py-3 text-left text-sm text-catalan-primaryLight">
                <strong>Quick tip:</strong> Use the AI Report button in the dashboard Analytics tab to auto-generate a narrative summary of your data — ideal for donor reports and presentations.
              </div>
              <button
                onClick={dismiss}
                className={`w-full ${btnPrimary}`}
              >
                Go to dashboard →
              </button>
            </div>
          )}
        </div>

        {/* Step dots */}
        <div className="px-6 pb-5 flex justify-center gap-1.5">
          {STEPS.map(s => (
            <div
              key={s.id}
              className={`w-2 h-2 rounded-full transition-colors ${
                s.id === step ? 'bg-catalan-primary' : s.id < step ? 'bg-catalan-primary/40' : 'bg-catalan-hover'
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
