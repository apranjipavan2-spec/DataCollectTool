import { useEffect, useState } from 'react'
import { getStoredUser } from '@/lib/api'
import api from '@/lib/api'

// The 3 credentials shown on the public demo.html role picker. Anyone who logs
// in with one of these is a prospect exploring the live demo, not a real
// customer — capture their (real) name/phone once per session so the
// super-admin Leads page can follow up.
const DEMO_PHONES = new Set(['+919999990001', '+919999990002', '+919999990003'])
const SESSION_KEY = 'fg_demo_lead_done'

export default function DemoLeadPrompt() {
  const [show, setShow] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'sending'>('idle')
  const [err, setErr] = useState('')

  useEffect(() => {
    const user = getStoredUser()
    if (!user?.phone || !DEMO_PHONES.has(user.phone)) return
    try {
      if (sessionStorage.getItem(SESSION_KEY) === '1') return
    } catch { /* ignore — worst case we ask again */ }
    setShow(true)
  }, [])

  const dismiss = () => {
    try { sessionStorage.setItem(SESSION_KEY, '1') } catch { /* non-fatal */ }
    setShow(false)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !phone.trim()) { setErr('Please share your name and phone number.'); return }
    setErr(''); setState('sending')
    try {
      await api.post('/auth/lead', {
        email: email.trim() || undefined,   // backend derives a stable fallback from phone if omitted
        name: name.trim(), phone: phone.trim(), source: 'demo_gate',
        message: `Logged into the ${getStoredUser()?.role ?? ''} demo dashboard`,
      })
    } catch { /* never block access to the demo over a network hiccup */ }
    dismiss()
  }

  if (!show) return null

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/60 p-4" role="dialog" aria-modal="true" aria-label="Share your details">
      <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl">
        <h3 className="text-lg font-bold text-slate-800 mb-1">👋 Exploring the demo?</h3>
        <p className="text-sm text-slate-500 mb-4">Share your name and phone so our team can help if you have questions.</p>
        <form onSubmit={submit} className="space-y-2">
          <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800"
                 placeholder="Your name *" value={name} onChange={e => setName(e.target.value)} autoFocus required />
          <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800"
                 placeholder="Phone number *" value={phone} onChange={e => setPhone(e.target.value)} required />
          <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800"
                 placeholder="Email (optional)" type="email" value={email} onChange={e => setEmail(e.target.value)} />
          {err && <p className="text-xs text-red-600">{err}</p>}
          <button type="submit" disabled={state === 'sending'}
                  className="w-full bg-indigo-600 text-white rounded-lg py-2 text-sm font-semibold disabled:opacity-60">
            {state === 'sending' ? 'Sending…' : 'Continue to Dashboard →'}
          </button>
        </form>
      </div>
    </div>
  )
}
