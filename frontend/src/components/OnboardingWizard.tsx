import { useState, useEffect } from 'react'
import api from '@/lib/api'

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
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        {/* Progress bar */}
        <div className="h-1 bg-gray-100 dark:bg-gray-800">
          <div
            className="h-1 bg-blue-500 transition-all duration-500"
            style={{ width: `${(step / STEPS.length) * 100}%` }}
          />
        </div>

        {/* Header */}
        <div className="px-6 pt-5 pb-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-blue-500 uppercase tracking-wider mb-1">
              Step {step} of {STEPS.length}
            </p>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">
              {STEPS[step - 1].title}
            </h2>
            <p className="text-sm text-gray-500 mt-0.5">{STEPS[step - 1].desc}</p>
          </div>
          <button
            onClick={dismiss}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xl font-light leading-none p-1"
            title="Skip setup"
          >
            ×
          </button>
        </div>

        {/* Step content */}
        <div className="px-6 py-5">
          {error && (
            <p className="text-red-500 text-sm mb-3 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Organisation name
                </label>
                <input
                  type="text"
                  value={orgName}
                  onChange={e => setOrgName(e.target.value)}
                  placeholder="e.g. Pratham Education Foundation"
                  className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white"
                  autoFocus
                />
              </div>
              <button
                onClick={handleStep1}
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg py-2.5 text-sm transition-colors disabled:opacity-50"
              >
                {loading ? 'Saving…' : 'Continue →'}
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Describe your survey <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <textarea
                  value={formDescription}
                  onChange={e => setFormDescription(e.target.value)}
                  placeholder="e.g. A household survey to track WASH outcomes in rural Maharashtra — cover water source, sanitation facilities, hygiene practices, and 5-year trend questions."
                  rows={4}
                  className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white resize-none"
                  autoFocus
                />
                <p className="text-xs text-gray-400 mt-1">AI will generate a draft form — you can edit all questions before publishing.</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setStep(3)}
                  className="flex-1 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 font-medium rounded-lg py-2.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  Skip for now
                </button>
                <button
                  onClick={handleStep2}
                  disabled={loading}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg py-2.5 text-sm transition-colors disabled:opacity-50"
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
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Email <span className="text-gray-400 font-normal">(optional)</span>
                  </label>
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={e => setInviteEmail(e.target.value)}
                    placeholder="team@org.com"
                    className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Phone
                  </label>
                  <input
                    type="tel"
                    value={invitePhone}
                    onChange={e => setInvitePhone(e.target.value)}
                    placeholder="+91 98765 43210"
                    className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Role</label>
                <select
                  value={inviteRole}
                  onChange={e => setInviteRole(e.target.value)}
                  className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white"
                >
                  <option value="enumerator">Enumerator (field data collector)</option>
                  <option value="supervisor">Supervisor (reviews submissions)</option>
                  <option value="org_admin">Org Admin (full access)</option>
                </select>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setStep(4)}
                  className="flex-1 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 font-medium rounded-lg py-2.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  Skip for now
                </button>
                <button
                  onClick={handleStep3}
                  disabled={loading}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg py-2.5 text-sm transition-colors disabled:opacity-50"
                >
                  {loading ? 'Sending invite…' : 'Send invite →'}
                </button>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4 text-center py-2">
              <div className="text-5xl">🎉</div>
              <p className="text-gray-600 dark:text-gray-400 text-sm leading-relaxed">
                Your workspace is set up. Head to the dashboard to publish your first form, assign it to enumerators, and watch submissions come in — even offline.
              </p>
              <div className="bg-blue-50 dark:bg-blue-900/30 rounded-lg px-4 py-3 text-left text-sm text-blue-800 dark:text-blue-200">
                <strong>Quick tip:</strong> Use the AI Report button in the dashboard Analytics tab to auto-generate a narrative summary of your data — ideal for donor reports and presentations.
              </div>
              <button
                onClick={dismiss}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg py-2.5 text-sm transition-colors"
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
                s.id === step ? 'bg-blue-500' : s.id < step ? 'bg-blue-200' : 'bg-gray-200 dark:bg-gray-700'
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
