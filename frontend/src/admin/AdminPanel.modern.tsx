/**
 * Master Admin Panel (master_admin only) - Tenant Management
 * Manage tenants: create, view stats, update branding, change plans.
 */
import { useState, useEffect, useMemo } from 'react'
import api, { getStoredUser } from '@/lib/api'
import { getNavItems } from '@/lib/navigation'
import Sidebar from '@/components/Sidebar'
import TopNav from '@/components/TopNav'
import { Button, Card, Input, Modal, Table, Alert } from '@/components/ui'

interface TenantRow {
  id: string
  name: string
  app_name: string
  logo_url: string
  primary_color: string
  plan_tier: string
  subscription_status: string
  users_count: number
  submissions_count: number
  forms_count: number
  created_at: string
}

export default function AdminPanel() {
  const [tenants, setTenants] = useState<TenantRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingTenant, setEditingTenant] = useState<TenantRow | null>(null)

  const [formData, setFormData] = useState({
    name: '',
    app_name: '',
    plan_tier: 'starter',
    primary_color: '#89b4fa',
    logo_url: '',
    admin_phone: '',
    admin_name: '',
    admin_password: 'fieldpulse123',
  })

  const user = getStoredUser() || { name: '', role: '' }
  const sidebarItems = getNavItems(user.role)

  const totals = useMemo(() => ({
    users: tenants.reduce((sum, t) => sum + t.users_count, 0),
    submissions: tenants.reduce((sum, t) => sum + t.submissions_count, 0),
    forms: tenants.reduce((sum, t) => sum + t.forms_count, 0),
  }), [tenants])

  useEffect(() => {
    loadTenants()
  }, [])

  const loadTenants = async () => {
    setLoading(true)
    setError('')
    try {
      const { data } = await api.get('/tenants/')
      setTenants(data)
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to load tenants')
    } finally {
      setLoading(false)
    }
  }

  const createTenant = async () => {
    try {
      await api.post('/tenants/', formData)
      await loadTenants()
      setShowCreateModal(false)
      setFormData({
        name: '',
        app_name: '',
        plan_tier: 'starter',
        primary_color: '#89b4fa',
        logo_url: '',
        admin_phone: '',
        admin_name: '',
        admin_password: 'fieldpulse123',
      })
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to create tenant')
    }
  }

  const updateTenant = async () => {
    if (!editingTenant) return
    try {
      await api.patch(`/tenants/${editingTenant.id}`, {
        name: formData.name,
        app_name: formData.app_name,
        primary_color: formData.primary_color,
        logo_url: formData.logo_url,
        plan_tier: formData.plan_tier,
      })
      await loadTenants()
      setShowEditModal(false)
      setEditingTenant(null)
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to update tenant')
    }
  }

  const openEditModal = (tenant: TenantRow) => {
    setEditingTenant(tenant)
    setFormData({
      name: tenant.name,
      app_name: tenant.app_name,
      plan_tier: tenant.plan_tier,
      primary_color: tenant.primary_color,
      logo_url: tenant.logo_url,
      admin_phone: '',
      admin_name: '',
      admin_password: 'fieldpulse123',
    })
    setShowEditModal(true)
  }

  const getPlanColor = (plan: string) => {
    switch (plan) {
      case 'enterprise':
        return 'bg-catalan-primary/15 text-catalan-primary border border-catalan-primary/30 font-semibold'
      case 'professional':
        return 'bg-catalan-success/15 text-catalan-success border border-catalan-success/30 font-semibold'
      case 'starter':
        return 'bg-catalan-warning/15 text-catalan-warning border border-catalan-warning/30 font-semibold'
      default:
        return 'bg-catalan-textMuted/15 text-catalan-textMuted border border-catalan-textMuted/30'
    }
  }

  return (
    <div className="flex h-screen bg-catalan-bg">
      {/* Sidebar */}
      <Sidebar items={sidebarItems} role={user.role} />

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-auto">
        <TopNav title="Master Admin - Tenant Management" />

        <div className="flex-1 p-6">
          {error && (
            <Alert
              type="error"
              title="Error"
              message={error}
              onClose={() => setError('')}
            />
          )}

          {/* Total Stats */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <Card className="border-l-4 border-l-catalan-primary">
              <div className="text-xs font-medium text-catalan-textMuted mb-1">Total Tenants</div>
              <div className="text-3xl font-bold text-catalan-primary">{tenants.length}</div>
            </Card>
            <Card className="border-l-4 border-l-catalan-info">
              <div className="text-xs font-medium text-catalan-textMuted mb-1">Total Users</div>
              <div className="text-3xl font-bold text-catalan-info">{totals.users}</div>
            </Card>
            <Card className="border-l-4 border-l-catalan-success">
              <div className="text-xs font-medium text-catalan-textMuted mb-1">Total Submissions</div>
              <div className="text-3xl font-bold text-catalan-success">{totals.submissions}</div>
            </Card>
            <Card className="border-l-4 border-l-catalan-warning">
              <div className="text-xs font-medium text-catalan-textMuted mb-1">Total Forms</div>
              <div className="text-3xl font-bold text-catalan-warning">{totals.forms}</div>
            </Card>
          </div>

          {/* Header */}
          <div className="flex justify-between items-start mb-6">
            <div>
              <h2 className="text-2xl font-bold text-catalan-text mb-1">Tenants</h2>
              <p className="text-catalan-textMuted">
                {tenants.length} tenant{tenants.length !== 1 ? 's' : ''} registered
              </p>
            </div>
            <Button onClick={() => setShowCreateModal(true)}>
              + New Tenant
            </Button>
          </div>

          {/* Tenants Table */}
          {loading ? (
            <div className="text-catalan-textMuted text-center py-12">Loading tenants…</div>
          ) : tenants.length === 0 ? (
            <Card>
              <div className="text-center py-12">
                <div className="text-4xl mb-4">🏢</div>
                <p className="text-catalan-textMuted">No tenants created yet</p>
                <Button onClick={() => setShowCreateModal(true)} className="mt-4">
                  Create First Tenant
                </Button>
              </div>
            </Card>
          ) : (
            <Card>
              <Table
                columns={[
                  { key: 'name', label: 'Organization' },
                  { key: 'app_name', label: 'App Name' },
                  {
                    key: 'plan_tier',
                    label: 'Plan',
                    render: (val) => (
                      <span className={`text-xs px-2 py-1 rounded capitalize ${getPlanColor(val)}`}>
                        {val}
                      </span>
                    ),
                  },
                  {
                    key: 'users_count',
                    label: 'Users',
                    render: (val) => <span className="text-sm">{val}</span>,
                  },
                  {
                    key: 'submissions_count',
                    label: 'Submissions',
                    render: (val) => <span className="text-sm">{val}</span>,
                  },
                  {
                    key: 'forms_count',
                    label: 'Forms',
                    render: (val) => <span className="text-sm">{val}</span>,
                  },
                ]}
                data={tenants}
                keyExtractor={(row) => row.id}
                actions={(row) => (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openEditModal(row)}
                  >
                    Edit
                  </Button>
                )}
              />
            </Card>
          )}
        </div>
      </div>

      {/* Create Tenant Modal */}
      {showCreateModal && (
        <Modal
          isOpen={showCreateModal}
          title="Create New Tenant"
          onClose={() => setShowCreateModal(false)}
          footer={
            <div className="flex gap-3">
              <Button
                variant="secondary"
                onClick={() => setShowCreateModal(false)}
              >
                Cancel
              </Button>
              <Button onClick={createTenant}>Create Tenant</Button>
            </div>
          }
        >
          <div className="space-y-4">
            <Input
              label="Organization Name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g., Health Ministry"
            />
            <Input
              label="App Name"
              value={formData.app_name}
              onChange={(e) => setFormData({ ...formData, app_name: e.target.value })}
              placeholder="e.g., FieldPulse Health"
            />
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-catalan-text mb-2">
                  Plan Tier
                </label>
                <select
                  value={formData.plan_tier}
                  onChange={(e) => setFormData({ ...formData, plan_tier: e.target.value })}
                  className="w-full bg-catalan-hover border border-catalan-border text-catalan-text rounded px-3 py-2 text-sm"
                >
                  <option value="starter">Starter</option>
                  <option value="professional">Professional</option>
                  <option value="enterprise">Enterprise</option>
                </select>
              </div>
              <Input
                label="Primary Color"
                type="color"
                value={formData.primary_color}
                onChange={(e) => setFormData({ ...formData, primary_color: e.target.value })}
              />
            </div>
            <Input
              label="Admin Phone"
              type="tel"
              value={formData.admin_phone}
              onChange={(e) => setFormData({ ...formData, admin_phone: e.target.value })}
              placeholder="+919999999999"
            />
            <Input
              label="Admin Name"
              value={formData.admin_name}
              onChange={(e) => setFormData({ ...formData, admin_name: e.target.value })}
              placeholder="Full name"
            />
            <Input
              label="Admin Password"
              type="password"
              value={formData.admin_password}
              onChange={(e) => setFormData({ ...formData, admin_password: e.target.value })}
            />
          </div>
        </Modal>
      )}

      {/* Edit Tenant Modal */}
      {showEditModal && editingTenant && (
        <Modal
          isOpen={showEditModal}
          title={`Edit Tenant: ${editingTenant.name}`}
          onClose={() => {
            setShowEditModal(false)
            setEditingTenant(null)
          }}
          footer={
            <div className="flex gap-3">
              <Button
                variant="secondary"
                onClick={() => {
                  setShowEditModal(false)
                  setEditingTenant(null)
                }}
              >
                Cancel
              </Button>
              <Button onClick={updateTenant}>Save Changes</Button>
            </div>
          }
        >
          <div className="space-y-4">
            <Input
              label="Organization Name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            />
            <Input
              label="App Name"
              value={formData.app_name}
              onChange={(e) => setFormData({ ...formData, app_name: e.target.value })}
            />
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-catalan-text mb-2">
                  Plan Tier
                </label>
                <select
                  value={formData.plan_tier}
                  onChange={(e) => setFormData({ ...formData, plan_tier: e.target.value })}
                  className="w-full bg-catalan-hover border border-catalan-border text-catalan-text rounded px-3 py-2 text-sm"
                >
                  <option value="starter">Starter</option>
                  <option value="professional">Professional</option>
                  <option value="enterprise">Enterprise</option>
                </select>
              </div>
              <Input
                label="Primary Color"
                type="color"
                value={formData.primary_color}
                onChange={(e) => setFormData({ ...formData, primary_color: e.target.value })}
              />
            </div>
            <Input
              label="Logo URL"
              value={formData.logo_url}
              onChange={(e) => setFormData({ ...formData, logo_url: e.target.value })}
              placeholder="https://example.com/logo.png"
            />
          </div>
        </Modal>
      )}
    </div>
  )
}
