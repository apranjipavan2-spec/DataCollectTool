/**
 * Org Admin Dashboard — for org_admin and supervisor roles.
 *
 * Features:
 * - User Management (add, list, deactivate)
 * - API Key Management (generate, list, revoke)
 * - Form Templates (list, assign to enumerators)
 */
import { useState } from 'react'
import { getStoredUser } from '@/lib/api'
import { getNavItems } from '@/lib/navigation'
import Sidebar from '@/components/Sidebar'
import TopNav from '@/components/TopNav'
import { Card } from '@/components/ui'
import ApiKeyManager from './ApiKeyManager'
import IntegrationsPanel from './IntegrationsPanel'
import AiConfigPanel from './AiConfigPanel'

export default function OrgAdminPanel() {
  const [activeTab, setActiveTab] = useState('users')

  const user = getStoredUser() || { name: '', role: '' }
  const sidebarItems = getNavItems(user.role)

  const isMasterAdmin = user.role === 'master_admin'
  const tabs = [
    { id: 'users', label: '👥 Users', description: 'Manage team members' },
    { id: 'api-keys', label: '🔑 API Keys', description: 'Integration access' },
    { id: 'forms', label: '📋 Forms', description: 'Form templates' },
    { id: 'migration', label: '🔄 Import', description: 'Kobo · SurveyCTO · XLSForm' },
    { id: 'integrations', label: '🔗 Integrations', description: 'WhatsApp · Google Sheets' },
    ...(isMasterAdmin ? [{ id: 'ai', label: '🤖 AI', description: 'OpenAI · Claude · Gemini' }] : []),
  ]

  return (
    <div className="flex h-screen bg-catalan-bg">
      {/* Sidebar */}
      <Sidebar items={sidebarItems} role={user.role} />

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-auto">
        <TopNav title="Organization Settings" />

        <div className="flex-1 p-6">
          {/* Header */}
          <div className="mb-8">
            <h2 className="text-3xl font-bold text-catalan-text mb-2">Organization Admin</h2>
            <p className="text-catalan-textMuted">Manage users, API keys, and form assignments</p>
          </div>

          {/* Tab Navigation */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`p-4 rounded-lg text-left transition-all duration-200 ${
                  activeTab === tab.id
                    ? 'border-2 border-catalan-primary bg-catalan-primary/10 shadow-md shadow-catalan-primary/10'
                    : 'border-2 border-catalan-border bg-catalan-surface hover:border-catalan-primary/50 hover:shadow-md hover:shadow-catalan-primary/5'
                }`}
              >
                <div className="text-lg font-semibold text-catalan-text mb-1">{tab.label}</div>
                <p className="text-sm text-catalan-textMuted">{tab.description}</p>
              </button>
            ))}
          </div>

          {/* Tab Content */}
          <div>
            {activeTab === 'users' && <UsersTab />}
            {activeTab === 'api-keys' && <ApiKeyManager />}
            {activeTab === 'forms' && <FormsTab />}
            {activeTab === 'migration' && <MigrationTab />}
            {activeTab === 'integrations' && (
              <div className="p-6">
                <h3 className="text-lg font-semibold text-catalan-text mb-6">Integrations</h3>
                <IntegrationsPanel />
              </div>
            )}
            {activeTab === 'ai' && (
              <div className="p-6">
                <h3 className="text-lg font-semibold text-catalan-text mb-2">AI Configuration</h3>
                <p className="text-sm text-catalan-textMuted mb-6">Connect your own LLM API key to enable AI-powered report generation, skip logic suggestions, and label translation.</p>
                <AiConfigPanel />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function UsersTab() {
  return (
    <Card>
      <div className="p-6">
        <h3 className="text-lg font-semibold text-catalan-text mb-4">Team Management</h3>
        <div className="space-y-3">
          <p className="text-catalan-textMuted">
            User management is available in the <strong className="text-catalan-primary">Team tab</strong> of the main Dashboard.
          </p>
          <p className="text-sm text-catalan-textMuted">
            You can add new users, remove team members, and manage their roles and permissions from there.
          </p>
          <div className="mt-6">
            <a
              href="/"
              className="inline-block px-4 py-2 bg-catalan-primary text-catalan-bg rounded font-medium hover:bg-catalan-primaryDark transition-colors"
            >
              Go to Dashboard
            </a>
          </div>
        </div>
      </div>
    </Card>
  )
}

function MigrationTab() {
  return (
    <Card>
      <div className="p-6">
        <h3 className="text-lg font-semibold text-catalan-text mb-2">Import from Other Platforms</h3>
        <p className="text-catalan-textMuted mb-6">
          Migrate your forms and historical data from KoboToolbox, SurveyCTO, ODK Central, or any standard XLSForm file.
        </p>
        <a
          href="/migration"
          className="inline-block px-5 py-2.5 bg-catalan-primary text-catalan-bg rounded-lg font-semibold hover:opacity-90 transition-opacity"
        >
          🔄 Open Migration Wizard →
        </a>
      </div>
    </Card>
  )
}

function FormsTab() {
  return (
    <Card>
      <div className="p-6">
        <h3 className="text-lg font-semibold text-catalan-text mb-4">Form Templates</h3>
        <div className="space-y-3">
          <p className="text-catalan-textMuted">
            Form templates and assignments are managed through the main Dashboard <strong className="text-catalan-primary">Forms tab</strong>.
          </p>
          <p className="text-sm text-catalan-textMuted">
            You can view all available forms, create new ones, and assign them to enumerators from there.
          </p>
          <div className="mt-6">
            <a
              href="/"
              className="inline-block px-4 py-2 bg-catalan-primary text-catalan-bg rounded font-medium hover:bg-catalan-primaryDark transition-colors"
            >
              Go to Dashboard
            </a>
          </div>
        </div>
      </div>
    </Card>
  )
}
