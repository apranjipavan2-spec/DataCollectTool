import { useState, useEffect, useCallback } from 'react'
import api from '@/lib/api'
import { getStoredUser } from '@/lib/api'
import Sidebar from '@/components/Sidebar'
import TopNav from '@/components/TopNav'
import { getNavItems } from '@/lib/navigation'
import { useToast } from '@/lib/ToastContext'

interface PaymentConfig {
  upi_id: string
  upi_name: string
  bank_account: string
  bank_ifsc: string
  bank_name: string
  admin_whatsapp: string
  support_email: string
}

const EMPTY_CFG: PaymentConfig = {
  upi_id: '', upi_name: '', bank_account: '',
  bank_ifsc: '', bank_name: '', admin_whatsapp: '', support_email: '',
}

const card  = 'bg-catalan-surface border border-catalan-border rounded-xl p-5'
const btnPr = 'px-4 py-2 bg-catalan-primary text-catalan-bg rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40'
const btnSe = 'px-3 py-1.5 text-sm border border-catalan-border rounded-lg text-catalan-text hover:bg-catalan-hover transition-colors'
const inp   = 'w-full border border-catalan-border rounded-lg px-3 py-2 text-sm bg-catalan-bg text-catalan-text focus:ring-2 focus:ring-catalan-primary outline-none'

const CFG_FIELDS: { key: keyof PaymentConfig; label: string; placeholder: string; hint?: string }[] = [
  { key: 'upi_id',         label: 'UPI ID',           placeholder: 'yourname@upi',              hint: 'Shown on the QR code payment screen' },
  { key: 'upi_name',       label: 'UPI Display Name',  placeholder: 'FieldGovern Technologies' },
  { key: 'bank_account',   label: 'Bank Account No.',  placeholder: '00000012345678' },
  { key: 'bank_ifsc',      label: 'IFSC Code',         placeholder: 'HDFC0001234' },
  { key: 'bank_name',      label: 'Bank Name',         placeholder: 'HDFC Bank' },
  { key: 'admin_whatsapp', label: 'WhatsApp Number',   placeholder: '919876543210',             hint: 'With country code, no + or spaces (e.g. 919876543210)' },
  { key: 'support_email',  label: 'Support Email',     placeholder: 'support@fieldgovern.in' },
]

// Platform-wide config for master_admin, distinct from an org's own /fg/settings.
// Currently one section (Payment Config, relocated here from Admin > Payments);
// add further platform-level sections here as they come up rather than
// scattering them across other admin screens.
export default function PlatformSettingsPage() {
  const user  = getStoredUser()
  const toast = useToast()

  const [cfg,        setCfg]        = useState<PaymentConfig>(EMPTY_CFG)
  const [cfgLoading, setCfgLoading] = useState(false)
  const [cfgSaving,  setCfgSaving]  = useState(false)

  const loadCfg = useCallback(async () => {
    setCfgLoading(true)
    try {
      const res = await api.get('/billing/admin/payment-config')
      setCfg({ ...EMPTY_CFG, ...res.data })
    } catch {
      toast.error('Failed to load payment config')
    } finally {
      setCfgLoading(false)
    }
  }, [toast])

  useEffect(() => { loadCfg() }, [loadCfg])

  const saveCfg = async () => {
    setCfgSaving(true)
    try {
      await api.patch('/billing/admin/payment-config', cfg)
      toast.success('Payment settings saved')
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Failed to save')
    } finally {
      setCfgSaving(false)
    }
  }

  return (
    <div className="flex h-screen bg-catalan-bg">
      <Sidebar items={getNavItems(user?.role ?? '')} role={user?.role} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopNav title="Platform Settings" />
        <main className="flex-1 overflow-auto p-6">
          <div className="max-w-xl space-y-6">
            <div className={card}>
              <h2 className="text-base font-bold text-catalan-text mb-1">Payment Configuration</h2>
              <p className="text-xs text-catalan-textMuted mb-5">
                These details are shown to organisations on the subscription page when they make a payment.
                Changes take effect immediately — no redeploy needed.
              </p>

              {cfgLoading ? (
                <div className="text-catalan-textMuted text-sm text-center py-8">Loading…</div>
              ) : (
                <div className="space-y-4">
                  {CFG_FIELDS.map(f => (
                    <div key={f.key}>
                      <label className="block text-xs font-semibold text-catalan-text mb-1">{f.label}</label>
                      <input
                        className={inp}
                        placeholder={f.placeholder}
                        value={cfg[f.key]}
                        onChange={e => setCfg(prev => ({ ...prev, [f.key]: e.target.value }))}
                      />
                      {f.hint && <p className="text-xs text-catalan-textMuted mt-1">{f.hint}</p>}
                    </div>
                  ))}

                  <div className="pt-2 flex items-center gap-3">
                    <button onClick={saveCfg} disabled={cfgSaving} className={btnPr}>
                      {cfgSaving ? 'Saving…' : 'Save Payment Settings'}
                    </button>
                    <button onClick={loadCfg} className={btnSe}>Reset</button>
                  </div>
                </div>
              )}
            </div>

            {/* Live preview */}
            <div className={card}>
              <h3 className="text-sm font-bold text-catalan-text mb-3">Preview — what organisations will see</h3>
              <div className="space-y-2 text-sm">
                <div className="flex gap-3">
                  <span className="text-catalan-textMuted w-32 shrink-0">UPI ID</span>
                  <span className="font-mono text-catalan-primary">{cfg.upi_id || <span className="text-catalan-textMuted italic">not set</span>}</span>
                </div>
                <div className="flex gap-3">
                  <span className="text-catalan-textMuted w-32 shrink-0">Bank Account</span>
                  <span className="font-mono text-catalan-text">{cfg.bank_account || <span className="text-catalan-textMuted italic">not set</span>}</span>
                </div>
                <div className="flex gap-3">
                  <span className="text-catalan-textMuted w-32 shrink-0">IFSC</span>
                  <span className="font-mono text-catalan-text">{cfg.bank_ifsc || <span className="text-catalan-textMuted italic">not set</span>}</span>
                </div>
                <div className="flex gap-3">
                  <span className="text-catalan-textMuted w-32 shrink-0">Bank</span>
                  <span className="text-catalan-text">{cfg.bank_name || <span className="text-catalan-textMuted italic">not set</span>}</span>
                </div>
                <div className="flex gap-3">
                  <span className="text-catalan-textMuted w-32 shrink-0">WhatsApp</span>
                  {cfg.admin_whatsapp ? (
                    <a href={`https://wa.me/${cfg.admin_whatsapp}`} target="_blank" rel="noopener noreferrer"
                      className="text-green-500 hover:underline">+{cfg.admin_whatsapp}</a>
                  ) : <span className="text-catalan-textMuted italic">not set</span>}
                </div>
                <div className="flex gap-3">
                  <span className="text-catalan-textMuted w-32 shrink-0">Support Email</span>
                  <span className="text-catalan-text">{cfg.support_email || <span className="text-catalan-textMuted italic">not set</span>}</span>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
