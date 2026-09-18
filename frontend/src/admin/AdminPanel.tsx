/**
 * Multi-tenant admin panel (master_admin only).
 *
 * Manage tenants: create, view stats, update branding, change plans.
 */
import { useState, useEffect } from 'react'
import api from '@/lib/api'

interface TenantRow {
  id: string; name: string; app_name: string; logo_url: string;
  primary_color: string; plan_tier: string; subscription_status: string;
  users_count: number; submissions_count: number; forms_count: number;
  created_at: string
}

const theme = {
  bg: '#11111b', surface: '#1e1e2e', border: '#2a2a3e',
  text: '#cdd6f4', muted: '#6c7086', accent: '#89b4fa',
  green: '#a6e3a1', red: '#f38ba8', yellow: '#f9e2af',
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

  const planColor = (plan: string) => {
    if (plan === 'enterprise') return theme.accent
    if (plan === 'professional') return theme.green
    if (plan === 'starter') return theme.yellow
    return theme.muted
  }

  return (
    <div style={{ background: theme.bg, minHeight: '100vh', color: theme.text, fontFamily: 'system-ui' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: 20 }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>Tenant Management</div>
            <div style={{ fontSize: 13, color: theme.muted }}>
              {tenants.length} tenant{tenants.length !== 1 ? 's' : ''} registered
            </div>
          </div>
          <button onClick={() => setShowCreate(!showCreate)} style={primaryBtn}>
            {showCreate ? 'Cancel' : '+ New Tenant'}
          </button>
        </div>

        {/* Create tenant form */}
        {showCreate && (
          <div style={card}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Create New Tenant</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
              <Field label="Org Name" value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} />
              <Field label="App Name (white-label)" value={form.app_name} onChange={v => setForm(f => ({ ...f, app_name: v }))} placeholder="e.g. DataCollect" />
              <div>
                <label style={labelStyle}>Plan</label>
                <select value={form.plan_tier} onChange={e => setForm(f => ({ ...f, plan_tier: e.target.value }))} style={inputStyle}>
                  <option value="free">Free</option>
                  <option value="starter">Starter</option>
                  <option value="professional">Professional</option>
                  <option value="enterprise">Enterprise</option>
                </select>
              </div>
              <Field label="Brand Color" value={form.primary_color} onChange={v => setForm(f => ({ ...f, primary_color: v }))} type="color" />
              <Field label="Logo URL" value={form.logo_url} onChange={v => setForm(f => ({ ...f, logo_url: v }))} placeholder="https://..." />
              <div /> {/* spacer */}
              <Field label="Admin Phone" value={form.admin_phone} onChange={v => setForm(f => ({ ...f, admin_phone: v }))} placeholder="+91..." />
              <Field label="Admin Name" value={form.admin_name} onChange={v => setForm(f => ({ ...f, admin_name: v }))} />
              <Field label="Admin Password" value={form.admin_password} onChange={v => setForm(f => ({ ...f, admin_password: v }))} type="password" />
            </div>
            <button onClick={createTenant} disabled={!form.name || !form.admin_phone || !form.admin_name} style={{
              ...primaryBtn, opacity: (!form.name || !form.admin_phone || !form.admin_name) ? 0.5 : 1,
            }}>Create Tenant</button>
          </div>
        )}

        {/* Edit modal */}
        {editId && (
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontSize: 15, fontWeight: 600 }}>Edit Tenant</div>
              <button onClick={() => setEditId(null)} style={{ background: 'none', border: 'none', color: theme.muted, fontSize: 18, cursor: 'pointer' }}>X</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
              <Field label="Org Name" value={editForm.name} onChange={v => setEditForm(f => ({ ...f, name: v }))} />
              <Field label="App Name" value={editForm.app_name} onChange={v => setEditForm(f => ({ ...f, app_name: v }))} />
              <div>
                <label style={labelStyle}>Plan</label>
                <select value={editForm.plan_tier} onChange={e => setEditForm(f => ({ ...f, plan_tier: e.target.value }))} style={inputStyle}>
                  <option value="free">Free</option>
                  <option value="starter">Starter</option>
                  <option value="professional">Professional</option>
                  <option value="enterprise">Enterprise</option>
                </select>
              </div>
              <Field label="Brand Color" value={editForm.primary_color} onChange={v => setEditForm(f => ({ ...f, primary_color: v }))} type="color" />
              <Field label="Logo URL" value={editForm.logo_url} onChange={v => setEditForm(f => ({ ...f, logo_url: v }))} />
              <div>
                <label style={labelStyle}>Status</label>
                <select value={editForm.subscription_status} onChange={e => setEditForm(f => ({ ...f, subscription_status: e.target.value }))} style={inputStyle}>
                  <option value="active">Active</option>
                  <option value="suspended">Suspended</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
            </div>
            <button onClick={updateTenant} style={primaryBtn}>Save Changes</button>
          </div>
        )}

        {/* Tenants table */}
        {loading && <div style={{ color: theme.muted, textAlign: 'center', paddingTop: 40 }}>Loading...</div>}

        {!loading && tenants.length > 0 && (
          <div style={{ ...card, marginTop: 16, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>Tenant</th>
                  <th style={th}>Plan</th>
                  <th style={th}>Status</th>
                  <th style={th}>Users</th>
                  <th style={th}>Forms</th>
                  <th style={th}>Submissions</th>
                  <th style={th}>Created</th>
                  <th style={th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {tenants.map(t => (
                  <tr key={t.id}>
                    <td style={td}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {t.logo_url ? (
                          <img src={t.logo_url} alt="" style={{ width: 24, height: 24, borderRadius: 4, objectFit: 'cover' }} />
                        ) : (
                          <div style={{
                            width: 24, height: 24, borderRadius: 4,
                            background: t.primary_color + '33', color: t.primary_color,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 12, fontWeight: 700,
                          }}>
                            {t.name.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div>
                          <div style={{ fontWeight: 500 }}>{t.name}</div>
                          {t.app_name && t.app_name !== t.name && (
                            <div style={{ fontSize: 11, color: theme.muted }}>as "{t.app_name}"</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td style={td}>
                      <span style={{
                        background: planColor(t.plan_tier) + '22', color: planColor(t.plan_tier),
                        borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 500,
                      }}>{t.plan_tier}</span>
                    </td>
                    <td style={td}>
                      <span style={{
                        color: t.subscription_status === 'active' ? theme.green : theme.red,
                        fontSize: 12,
                      }}>
                        {t.subscription_status}
                      </span>
                    </td>
                    <td style={{ ...td, textAlign: 'center' }}>{t.users_count}</td>
                    <td style={{ ...td, textAlign: 'center' }}>{t.forms_count}</td>
                    <td style={{ ...td, textAlign: 'center' }}>{t.submissions_count}</td>
                    <td style={{ ...td, fontSize: 12, whiteSpace: 'nowrap' }}>{t.created_at?.slice(0, 10)}</td>
                    <td style={td}>
                      <button onClick={() => openEdit(t)} style={smallBtn}>Edit</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && tenants.length === 0 && !showCreate && (
          <div style={{ color: theme.muted, textAlign: 'center', paddingTop: 60 }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🏢</div>
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
      <label style={labelStyle}>{label}</label>
      <input
        type={type || 'text'}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={type === 'color' ? { ...inputStyle, padding: 4, height: 34, width: '100%' } : { ...inputStyle, width: '100%' }}
      />
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────
const card: React.CSSProperties = {
  background: theme.surface, border: `1px solid ${theme.border}`,
  borderRadius: 10, padding: 20,
}
const th: React.CSSProperties = {
  color: theme.muted, fontSize: 11, textTransform: 'uppercase',
  letterSpacing: 1, padding: '8px 12px', textAlign: 'left',
  borderBottom: `1px solid ${theme.border}`,
}
const td: React.CSSProperties = {
  color: theme.text, fontSize: 13, padding: '10px 12px',
  borderBottom: `1px solid ${theme.border}`,
}
const labelStyle: React.CSSProperties = {
  color: theme.muted, fontSize: 11, display: 'block', marginBottom: 4,
}
const inputStyle: React.CSSProperties = {
  background: theme.bg, border: `1px solid ${theme.border}`,
  color: theme.text, borderRadius: 7, padding: '7px 12px', fontSize: 13,
}
const primaryBtn: React.CSSProperties = {
  background: '#1e66f5', border: 'none', color: '#fff', borderRadius: 7,
  padding: '8px 16px', fontSize: 13, cursor: 'pointer', fontWeight: 500,
}
const smallBtn: React.CSSProperties = {
  background: 'none', border: `1px solid ${theme.accent}44`, color: theme.accent,
  borderRadius: 5, padding: '3px 10px', fontSize: 11, cursor: 'pointer',
}
