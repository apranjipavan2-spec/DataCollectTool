import { useState } from 'react'
import api from '@/lib/api'
import { useNavigate } from 'react-router-dom'
import EmojiIcon from '@/components/EmojiIcon'

const FG_WHATSAPP = '918088709011'

function waLink(phone: string, message: string) {
  const clean = phone.replace(/\D/g, '')
  const num = clean.startsWith('91') ? clean : `91${clean}`
  return `https://wa.me/${num}?text=${encodeURIComponent(message)}`
}

export default function ForgotPasswordPage() {
  const navigate = useNavigate()
  const [role, setRole] = useState<'enumerator' | 'admin' | null>(null)

  // Enumerator state
  const [enumPhone, setEnumPhone]     = useState('')
  const [enumPhoneErr, setEnumPhoneErr] = useState('')
  const [enumLoading, setEnumLoading] = useState(false)
  const [adminContact, setAdminContact] = useState<{ name: string; phone: string; qr_login_enabled: boolean } | null>(null)
  const [lookupDone, setLookupDone]   = useState(false)

  // Admin state — WhatsApp contact only
  const [adminPhone, setAdminPhone] = useState('')

  const normalizePhone = (raw: string) => {
    const digits = raw.replace(/\D/g, '')
    if (digits.length === 10) return `+91${digits}`
    if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`
    return raw.trim()
  }

  // Enumerator — look up admin contact
  const handleEnumLookup = async () => {
    setEnumPhoneErr('')
    const normalized = normalizePhone(enumPhone)
    if (!enumPhone.trim() || normalized.length < 10) {
      setEnumPhoneErr('Enter a valid mobile number')
      return
    }
    setEnumLoading(true)
    try {
      const { data } = await api.get<{ name: string | null; phone: string | null; qr_login_enabled: boolean }>(
        `/auth/admin-contact?phone=${encodeURIComponent(normalized)}`
      )
      setAdminContact(data.phone ? { name: data.name ?? 'Admin', phone: data.phone, qr_login_enabled: data.qr_login_enabled ?? false } : null)
    } catch {
      setAdminContact(null)
    } finally {
      setEnumLoading(false)
      setLookupDone(true)
    }
  }

  const enumWaMessage = (adminName: string) =>
    `Hi ${adminName}, I need a password reset for FieldGovern. My registered number is ${normalizePhone(enumPhone)}. Could you please reset my password?`

  const adminWaMessage = () => {
    const num = adminPhone.trim() ? ` My registered number is ${normalizePhone(adminPhone)}.` : ''
    return `Hi FieldGovern Support, I'm an organization admin and I need help with my account.${num} Please assist.`
  }

  const adminSubscribeMessage = () => {
    const num = adminPhone.trim() ? ` My number is ${normalizePhone(adminPhone)}.` : ''
    return `Hi FieldGovern, I'd like to enquire about subscription plans for my organization.${num}`
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-[420px]">

        {/* Logo */}
        <div className="flex items-center justify-center mb-10">
          <img src="/logo-wide.png" alt="FieldGovern" className="h-10 w-auto object-contain" />
        </div>

        {/* Role selector */}
        {!role && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
            <h1 className="text-xl font-bold text-slate-900 mb-1">Forgot password?</h1>
            <p className="text-slate-400 text-sm mb-7">Tell us who you are so we can help you.</p>
            <div className="space-y-3">
              <button
                onClick={() => setRole('enumerator')}
                className="w-full text-left p-4 rounded-xl border-2 border-slate-200 hover:border-blue-400 hover:bg-blue-50/50 transition-all group"
              >
                <div className="font-semibold text-slate-800 group-hover:text-blue-700"><EmojiIcon e="📱" /> Field Enumerator / Supervisor</div>
                <div className="text-xs text-slate-500 mt-0.5">I collect data in the field</div>
              </button>
              <button
                onClick={() => setRole('admin')}
                className="w-full text-left p-4 rounded-xl border-2 border-slate-200 hover:border-purple-400 hover:bg-purple-50/50 transition-all group"
              >
                <div className="font-semibold text-slate-800 group-hover:text-purple-700"><EmojiIcon e="🏢" /> Organization Admin</div>
                <div className="text-xs text-slate-500 mt-0.5">I manage the organization account</div>
              </button>
            </div>
            <div className="mt-6 text-center">
              <button onClick={() => navigate('/login')} className="text-sm text-slate-400 hover:text-blue-600 transition-colors">
                <EmojiIcon e="←" /> Back to Sign In
              </button>
            </div>
          </div>
        )}

        {/* Enumerator — find admin + WhatsApp */}
        {role === 'enumerator' && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
            <div className="text-3xl mb-4 text-center"><EmojiIcon e="📱" /></div>
            <h2 className="text-xl font-bold text-slate-900 mb-1 text-center">Contact Your Admin</h2>
            <p className="text-slate-400 text-sm text-center mb-6">
              Enter your phone number — we'll find your admin and open WhatsApp with a pre-filled message.
            </p>

            {!lookupDone ? (
              <>
                <div className="mb-4">
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                    Your Mobile Number
                  </label>
                  <input
                    type="tel"
                    inputMode="numeric"
                    placeholder="98765 43210"
                    value={enumPhone}
                    autoFocus
                    onChange={e => { setEnumPhone(e.target.value); setEnumPhoneErr('') }}
                    onKeyDown={e => e.key === 'Enter' && handleEnumLookup()}
                    className={`w-full bg-slate-50 border rounded-xl px-4 py-3 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white transition-all ${
                      enumPhoneErr ? 'border-red-400 focus:border-red-400 focus:ring-2 focus:ring-red-100'
                                   : 'border-slate-200 focus:border-blue-400 focus:ring-2 focus:ring-blue-100'}`}
                  />
                  {enumPhoneErr && <p className="text-xs text-red-500 mt-1.5 flex items-center gap-1"><span><EmojiIcon e="⚠" /></span>{enumPhoneErr}</p>}
                </div>
                <button
                  onClick={handleEnumLookup}
                  disabled={enumLoading}
                  className="w-full py-3.5 rounded-xl font-semibold text-sm text-white transition-all flex items-center justify-center gap-2 disabled:opacity-50 shadow-md hover:shadow-lg active:scale-[0.99] mb-4"
                  style={{ background: 'linear-gradient(135deg, #2563eb, #1d4ed8)' }}
                >
                  {enumLoading
                    ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /><span>Looking up…</span></>
                    : 'Find My Admin →'}
                </button>
              </>
            ) : adminContact ? (
              /* Admin found — WhatsApp CTA */
              <div className="mb-4">
                <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-4">
                  <p className="text-xs font-semibold text-green-700 uppercase tracking-wider mb-1">Admin found</p>
                  <p className="text-sm font-bold text-green-800">{adminContact.name}</p>
                  <p className="text-xs text-green-600">{adminContact.phone}</p>
                </div>
                <a
                  href={waLink(adminContact.phone, enumWaMessage(adminContact.name))}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full py-3.5 rounded-xl font-semibold text-sm text-white transition-all shadow-md hover:shadow-lg active:scale-[0.99] mb-3"
                  style={{ background: 'linear-gradient(135deg, #16a34a, #15803d)' }}
                >
                  <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                  Message {adminContact.name} on WhatsApp
                </a>
                {adminContact.qr_login_enabled && (
                  <button
                    onClick={() => navigate('/auth/qr-login')}
                    className="w-full py-2.5 rounded-xl font-semibold text-sm text-white transition-all shadow-sm mb-3"
                    style={{ background: 'linear-gradient(135deg, #2563eb, #1d4ed8)' }}
                  >
                    <EmojiIcon e="📷" /> Login via QR Code
                  </button>
                )}
                <button
                  onClick={() => { setLookupDone(false); setEnumPhone(''); setAdminContact(null) }}
                  className="w-full py-2.5 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-all"
                >
                  Try a different number
                </button>
              </div>
            ) : (
              /* Admin not found — fallback */
              <div className="mb-4">
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4">
                  <p className="text-sm text-amber-800">We couldn't find an admin linked to that number. Please contact your supervisor directly.</p>
                </div>
                <button
                  onClick={() => { setLookupDone(false); setEnumPhone(''); setAdminContact(null) }}
                  className="w-full py-2.5 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-all"
                >
                  Try a different number
                </button>
              </div>
            )}

            <button onClick={() => setRole(null)} className="w-full py-3 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-all">
              <EmojiIcon e="←" /> Back
            </button>
          </div>
        )}

        {/* Admin — WhatsApp contact (password reset + subscription) */}
        {role === 'admin' && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
            <div className="text-3xl mb-4 text-center"><EmojiIcon e="🏢" /></div>
            <h2 className="text-xl font-bold text-slate-900 mb-1 text-center">Contact FieldGovern</h2>
            <p className="text-slate-400 text-sm text-center mb-6">
              For password resets or subscription enquiries, message us on WhatsApp — we respond within a few hours.
            </p>

            <div className="mb-5">
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                Your Mobile Number <span className="font-normal text-slate-400">(optional — helps us find your account)</span>
              </label>
              <input
                type="tel"
                inputMode="numeric"
                placeholder="98765 43210"
                value={adminPhone}
                autoFocus
                onChange={e => setAdminPhone(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all"
              />
            </div>

            <div className="space-y-3 mb-5">
              <a
                href={`https://wa.me/${FG_WHATSAPP}?text=${encodeURIComponent(adminWaMessage())}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 w-full px-4 py-3.5 rounded-xl font-semibold text-sm text-white transition-all shadow-md hover:shadow-lg active:scale-[0.99]"
                style={{ background: 'linear-gradient(135deg, #16a34a, #15803d)' }}
              >
                <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current shrink-0"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                <div className="text-left">
                  <div>Reset my password</div>
                  <div className="text-xs font-normal opacity-80">WhatsApp FieldGovern support</div>
                </div>
              </a>

              <a
                href={`https://wa.me/${FG_WHATSAPP}?text=${encodeURIComponent(adminSubscribeMessage())}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 w-full px-4 py-3.5 rounded-xl font-semibold text-sm text-white transition-all shadow-md hover:shadow-lg active:scale-[0.99]"
                style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)' }}
              >
                <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current shrink-0"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                <div className="text-left">
                  <div>Enquire about subscription</div>
                  <div className="text-xs font-normal opacity-80">Plans, pricing, and upgrades</div>
                </div>
              </a>
            </div>

            <button onClick={() => setRole(null)} className="w-full py-2.5 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-all">
              <EmojiIcon e="←" /> Back
            </button>
          </div>
        )}

      </div>
    </div>
  )
}
