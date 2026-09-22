/**
 * Multi-tenant admin panel (master_admin only).
 *
 * Manage tenants: create, view stats, update branding, change plans.
 */
import { useState, useEffect } from 'react'
import api from '@/lib/api'
import Select from '@/components/Select'

interface TenantRow {
  id: string; name: string; app_name: string; logo_url: string;
  primary_color: string; plan_tier: string; subscription_status: string;
  users_count: number; submissions_count: number; forms_count: number;
  created_at: string
}

export default function AdminPanel() {
  const [tenants, setTenants] = useState<TenantRow[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState({
    name: '', plan_tier: 'starter', primary_color: '#2563EB', logo_url: '',
    app_name: '', admin_phone: '', admin_name: '', admin_password: 'fieldgovern123',
  })
  const [editForm, setEditForm] = useState({
    name: '', app_name: '', primary_color: '', logo_url: '', plan_tier: '', subscription_status: '',
  })

  useEffect(() => {
    api.get('/tenants/').then(r => { setTenants(r.data); setLoading(false) }).catch(() => setLoading(false))
  }, [])

  const createTenant = async () => {
    try {
      await api.post('/tenants/', form)
      const r = await api.get('/tenants/')
      setTenants(r.data)
      setShowCreate(false)
      setForm({ name: '', plan_tier: 'starter', primary_color: '#2563EB', logo_url: '', app_name: '', admin_phone: '', admin_name: '', admin_password: 'fieldgovern123' })
    } catch (e: any) {
      alert(e.response?.data?.detail || 'Failed to create tenant')
    }
  }

  const updateTenant = async () => {
    if (!editId) return
    try {
      await api.patch(`/tenants/${editId}`, editForm)
      const r = await api.get('/tenants/')
      setTenants(r.data)
      setEditId(null)
    } catch (e: any) {
      alert(e.response?.data?.detail || 'Failed to update tenant')
    }
  }

  const openEdit = (t: TenantRow) => {
    setEditId(t.id)
    setEditForm({
      name: t.name, app_name: t.app_name, primary_color: t.primary_color,
      logo_url: t.logo_url, plan_tier: t.plan_tier, subscription_status: t.subscription_status,
    })
  }

  const planBadge = (plan: string) => {
    const cls = plan === 'pro' || plan === 'custom' ? 'bg-catalan-primary/10 text-catalan-primary border-catalan-primary/20'
      : plan === 'growth' ? 'bg-green-500/10 text-green-500 border-green-500/20'
      : plan === 'starter' ? 'bg-amber-500/10 text-amber-500 border-amber-500/20'
      : 'bg-catalan-textMuted/10 text-catalan-textMuted border-catalan-border'
    return (
      <span className={`px-2 py-0.5 text-xs font-medium border rounded-full ${cls}`}>{plan}</span>
    )
  }

  const statusBadge = (s: string) => (
    <span className={`text-xs ${s === 'active' ? 'text-green-500' : 'text-catalan-error'}`}>{s}</span>
  )

  return (
    <div className="min-h-screen bg-catalan-bg text-catalan-text">
      <div className="max-w-[1100px] mx-auto p-5">

        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <div>
            <div className="text-xl font-bold">Tenant Management</div>
            <div className="text-sm text-catalan-textMuted">
              {tenants.length} tenant{tenants.length !== 1 ? 's' : ''} registered
            </div>
          </div>
          <button onClick={() => setShowCreate(!showCreate)} className={btnPr}>
            {showCreate ? 'Cancel' : '+ New Tenant'}
          </button>
        </div>

        {/* Create tenant form */}
        {showCreate && (
          <div className={card}>
            <div className="text-base font-semibold mb-4">Create New Tenant</div>
            <div className="grid grid-cols-3 gap-3 mb-3">
              <Field label="Org Name" value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} />
              <Field label="App Name (white-label)" value={form.app_name} onChange={v => setForm(f => ({ ...f, app_name: v }))} placeholder="e.g. DataCollect" />
              <div>
                <label className={labelCls}>Plan</label>
                <Select value={form.plan_tier} onChange={e => setForm(f => ({ ...f, plan_tier: e.target.value }))} className={inp}>
                  <option value="free">Free</option>
                  <option value="starter">Starter</option>
                  <option value="growth">Growth</option>
                  <option value="pro">Pro</option>
                  <option value="custom">Custom</option>
                </Select>
              </div>
              <Field label="Brand Color" value={form.primary_color} onChange={v => setForm(f => ({ ...f, primary_color: v }))} type="color" />
              <Field label="Logo URL" value={form.logo_url} onChange={v => setForm(f => ({ ...f, logo_url: v }))} placeholder="https://..." />
              <div /> {/* spacer */}
              <Field label="Admin Phone" value={form.admin_phone} onChange={v => setForm(f => ({ ...f, admin_phone: v }))} placeholder="+91..." />
              <Field label="Admin Name" value={form.admin_name} onChange={v => setForm(f => ({ ...f, admin_name: v }))} />
              <Field label="Admin Password" value={form.admin_password} onChange={v => setForm(f => ({ ...f, admin_password: v }))} type="password" />
            </div>
            <button onClick={createTenant} disabled={!form.name || !form.admin_phone || !form.admin_name} className={`${btnPr} disabled:opacity-40`}>
              Create Tenant
            </button>
          </div>
        )}

        {/* Edit modal */}
        {editId && (
          <div className={card}>
            <div className="flex justify-between items-center mb-4">
              <div className="text-base font-semibold">Edit Tenant</div>
              <button onClick={() => setEditId(null)} className="bg-transparent border-none text-catalan-textMuted text-lg cursor-pointer hover:text-catalan-text">X</button>
            </div>
            <div className="grid grid-cols-3 gap-3 mb-3">
              <Field label="Org Name" value={editForm.name} onChange={v => setEditForm(f => ({ ...f, name: v }))} />
              <Field label="App Name" value={editForm.app_name} onChange={v => setEditForm(f => ({ ...f, app_name: v }))} />
              <div>
                <label className={labelCls}>Plan</label>
                <Select value={editForm.plan_tier} onChange={e => setEditForm(f => ({ ...f, plan_tier: e.target.value }))} className={inp}>
                  <option value="free">Free</option>
                  <option value="starter">Starter</option>
                  <option value="growth">Growth</option>
                  <option value="pro">Pro</option>
                  <option value="custom">Custom</option>
                </Select>
              </div>
              <Field label="Brand Color" value={editForm.primary_color} onChange={v => setEditForm(f => ({ ...f, primary_color: v }))} type="color" />
              <Field label="Logo URL" value={editForm.logo_url} onChange={v => setEditForm(f => ({ ...f, logo_url: v }))} />
              <div>
                <label className={labelCls}>Status</label>
                <Select value={editForm.subscription_status} onChange={e => setEditForm(f => ({ ...f, subscription_status: e.target.value }))} className={inp}>
                  <option value="active">Active</option>
                  <option value="suspended">Suspended</option>
                  <option value="cancelled">Cancelled</option>
                </Select>
              </div>
            </div>
            <button onClick={updateTenant} className={btnPr}>Save Changes</button>
          </div>
        )}

        {/* Tenants table */}
        {loading && <div className="text-catalan-textMuted text-center pt-10">Loading...</div>}

        {!loading && tenants.length > 0 && (
          <div className={`${card} mt-4 overflow-x-auto`}>
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-catalan-border text-left text-xs text-catalan-textMuted uppercase tracking-wide">
                  <th className="py-2 px-3 font-medium">Tenant</th>
                  <th className="py-2 px-3 font-medium">Plan</th>
                  <th className="py-2 px-3 font-medium">Status</th>
                  <th className="py-2 px-3 font-medium">Users</th>
                  <th className="py-2 px-3 font-medium">Forms</th>
                  <th className="py-2 px-3 font-medium">Submissions</th>
                  <th className="py-2 px-3 font-medium">Created</th>
                  <th className="py-2 px-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-catalan-border/50">
                {tenants.map(t => (
                  <tr key={t.id} className="hover:bg-catalan-hover/30 transition-colors">
                    <td className="py-2.5 px-3 text-catalan-text">
                      <div className="flex items-center gap-2">
                        {t.logo_url ? (
                          <img src={t.logo_url} alt="" className="w-6 h-6 rounded object-cover" />
                        ) : (
                          <div className="w-6 h-6 rounded flex items-center justify-center text-xs font-bold"
                            style={{ background: t.primary_color + '33', color: t.primary_color }}>
                            {t.name.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div>
                          <div className="font-medium">{t.name}</div>
                          {t.app_name && t.app_name !== t.name && (
                            <div className="text-[11px] text-catalan-textMuted">as "{t.app_name}"</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 px-3">{planBadge(t.plan_tier)}</td>
                    <td className="py-2.5 px-3">{statusBadge(t.subscription_status)}</td>
                    <td className="py-2.5 px-3 text-center text-catalan-text">{t.users_count}</td>
                    <td className="py-2.5 px-3 text-center text-catalan-text">{t.forms_count}</td>
                    <td className="py-2.5 px-3 text-center text-catalan-text">{t.submissions_count}</td>
                    <td className="py-2.5 px-3 text-xs text-catalan-text whitespace-nowrap">{t.created_at?.slice(0, 10)}</td>
                    <td className="py-2.5 px-3">
                      <button onClick={() => openEdit(t)} className={btnSe}>Edit</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && tenants.length === 0 && !showCreate && (
          <div className="text-catalan-textMuted text-center pt-16">
            <div className="text-5xl mb-4">🏢</div>
            <div>No tenants yet. Create one to get started.</div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Tiny field component ──────────────────────────────────────────────────
function Field({ label, value, onChange, placeholder, type }: {
  label: string; value: string; onChange: (v: string) => void
  placeholder?: string; type?: string
}) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      <input
        type={type || 'text'}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={inp}
        // Tailwind utility precedence isn't guaranteed by class-string order, so a
        // trailing className override (`p-1 h-[34px]`) can't reliably beat `inp`'s
        // own px-3/py-2 — use inline style, which always wins, same as pre-reskin.
        style={type === 'color' ? { padding: 4, height: 34 } : undefined}
      />
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────
const card    = 'bg-catalan-surface border border-catalan-border rounded-xl p-5'
const labelCls = 'block text-xs text-catalan-textMuted mb-1'
const inp     = 'w-full border border-catalan-border rounded-lg px-3 py-2 text-sm bg-catalan-bg text-catalan-text focus:ring-2 focus:ring-catalan-primary outline-none'
const btnPr   = 'px-4 py-2 bg-catalan-primary text-catalan-bg rounded-lg text-sm font-medium hover:opacity-90 transition-opacity'
const btnSe   = 'px-3 py-1.5 text-sm border border-catalan-border rounded-lg text-catalan-text hover:bg-catalan-hover transition-colors'
