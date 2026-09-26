import { useState } from 'react'
import api from '@/lib/api'

/** Floating chat bubble for the login screen: asks new visitors for their email so we can follow up. */
export default function ChatLeadWidget() {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle')
  const [err, setErr] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr('')
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setErr('Please enter a valid email.'); return }
    setState('sending')
    try {
      await api.post('/auth/lead', {
        email: email.trim(), name: name.trim() || undefined, phone: phone.trim() || undefined, source: 'login_chat',
      })
      setState('done')
    } catch {
      setErr('Could not send. Please try again.')
      setState('idle')
    }
  }

  const input = 'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 bg-white'

  return (
    <div className="fixed bottom-5 right-5 z-50">
      {open && (
        <div className="mb-3 w-72 bg-white border border-slate-200 rounded-2xl shadow-xl p-4">
          <div className="flex justify-between items-start mb-2">
            <p className="text-sm font-semibold text-slate-800">👋 New to FieldGovern?</p>
            <button onClick={() => setOpen(false)} aria-label="Close chat" className="text-slate-400 hover:text-slate-600 leading-none">×</button>
          </div>
          {state === 'done' ? (
            <p className="text-sm text-slate-600">Thanks! We'll reach out on {email.trim()} shortly.</p>
          ) : (
            <form onSubmit={submit} className="space-y-2">
              <p className="text-xs text-slate-500">Share your email and we'll help you get started.</p>
              <input className={input} type="email" placeholder="Email *" value={email} onChange={e => setEmail(e.target.value)} required />
              <input className={input} placeholder="Name (optional)" value={name} onChange={e => setName(e.target.value)} />
              <input className={input} placeholder="Phone (optional)" value={phone} onChange={e => setPhone(e.target.value)} />
              {err && <p className="text-xs text-red-600">{err}</p>}
              <button disabled={state === 'sending'} className="w-full bg-indigo-600 text-white rounded-lg py-2 text-sm font-medium disabled:opacity-60">
                {state === 'sending' ? 'Sending…' : 'Get in touch'}
              </button>
            </form>
          )}
        </div>
      )}
      <button
        onClick={() => setOpen(o => !o)} aria-label="Chat with us"
        className="ml-auto flex w-12 h-12 items-center justify-center rounded-full bg-indigo-600 text-white text-xl shadow-lg"
      >💬</button>
    </div>
  )
}
