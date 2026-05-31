import { useNavigate } from 'react-router-dom'

const WA_NUMBER = '918088709011'
const WA_MESSAGE = encodeURIComponent(
  'Hi Pallavi, I would like to request a demo account for FieldGovern. Could you please share the login credentials?'
)
const WA_LINK = `https://wa.me/${WA_NUMBER}?text=${WA_MESSAGE}`

export default function RegisterPage() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen flex items-center justify-center p-6"
         style={{ background: 'linear-gradient(160deg, #f8fafc 0%, #eef2ff 100%)' }}>
      <div className="w-full max-w-md">

        <div className="text-center mb-8">
          <img src="/logo-wide.png" alt="FieldGovern" className="h-9 w-auto object-contain mx-auto" />
        </div>

        <div className="rounded-3xl p-8 text-center"
             style={{ background: '#fff', border: '1px solid #e2e8f0', boxShadow: '0 20px 60px rgba(0,0,0,0.06)' }}>

          {/* WhatsApp icon */}
          <div className="w-16 h-16 mx-auto mb-5 rounded-2xl flex items-center justify-center"
               style={{ background: 'rgba(37,211,102,0.1)', border: '1px solid rgba(37,211,102,0.25)' }}>
            <svg className="w-8 h-8" viewBox="0 0 24 24" fill="#25D366">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
            </svg>
          </div>

          <h1 className="text-2xl font-bold mb-2" style={{ color: '#1e293b' }}>Get started with FieldGovern</h1>
          <p className="text-sm mb-6" style={{ color: '#64748b' }}>
            We're currently onboarding users personally to ensure the best experience.
            Message us on WhatsApp and we'll set up your free trial account right away.
          </p>

          {/* Steps */}
          <div className="text-left mb-7 space-y-3">
            {[
              { n: '1', text: 'Tap the button below to open WhatsApp' },
              { n: '2', text: 'Send the pre-filled message — add your org name if you like' },
              { n: '3', text: 'Receive your login credentials within a few hours' },
            ].map(s => (
              <div key={s.n} className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold text-white"
                      style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', marginTop: '1px' }}>
                  {s.n}
                </span>
                <p className="text-sm" style={{ color: '#475569' }}>{s.text}</p>
              </div>
            ))}
          </div>

          {/* WhatsApp CTA */}
          <a
            href={WA_LINK}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2.5 w-full py-3.5 rounded-xl font-bold text-sm text-white transition-all duration-200 active:scale-[0.98]"
            style={{ background: '#25D366', boxShadow: '0 4px 14px rgba(37,211,102,0.35)' }}
            onMouseEnter={e => (e.currentTarget.style.background = '#20b958')}
            onMouseLeave={e => (e.currentTarget.style.background = '#25D366')}
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="white">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
            </svg>
            Request Demo Account on WhatsApp
          </a>

          <p className="text-xs mt-5" style={{ color: '#94a3b8' }}>
            Already have credentials?{' '}
            <button
              onClick={() => navigate('/login')}
              className="font-semibold transition-colors"
              style={{ color: '#6366f1' }}
            >
              Sign in
            </button>
          </p>

        </div>
      </div>
    </div>
  )
}
