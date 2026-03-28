/**
 * Org Admin Dashboard — for org_admin and supervisor roles.
 *
 * Features:
 * - User Management (add, list, deactivate)
 * - API Key Management (generate, list, revoke)
 * - Form Templates (list, assign to enumerators)
 */
import { useState } from 'react'
import ApiKeyManager from './ApiKeyManager'

export default function OrgAdminPanel() {
  const [activeTab, setActiveTab] = useState('users')

  return (
    <div style={panel}>
      <div style={header}>
        <h1 style={title}>Organization Admin</h1>
        <p style={subtitle}>Manage users, API keys, and form assignments</p>
      </div>

      <div style={tabs}>
        <button
          onClick={() => setActiveTab('users')}
          style={{
            ...tabButton,
            background: activeTab === 'users' ? '#89b4fa' : '#45475a',
            color: activeTab === 'users' ? '#1e1e2e' : '#cdd6f4',
          }}
        >
          👥 Users
        </button>
        <button
          onClick={() => setActiveTab('api-keys')}
          style={{
            ...tabButton,
            background: activeTab === 'api-keys' ? '#89b4fa' : '#45475a',
            color: activeTab === 'api-keys' ? '#1e1e2e' : '#cdd6f4',
          }}
        >
          🔑 API Keys
        </button>
        <button
          onClick={() => setActiveTab('forms')}
          style={{
            ...tabButton,
            background: activeTab === 'forms' ? '#89b4fa' : '#45475a',
            color: activeTab === 'forms' ? '#1e1e2e' : '#cdd6f4',
          }}
        >
          📋 Forms
        </button>
      </div>

      <div style={tabContent}>
        {activeTab === 'users' && <UsersTab />}
        {activeTab === 'api-keys' && <ApiKeyManager />}
        {activeTab === 'forms' && <FormsTab />}
      </div>
    </div>
  )
}

function UsersTab() {
  return (
    <div style={{ padding: '20px' }}>
      <p style={{ color: '#6c7086' }}>
        User management is available in the Team tab of the main Dashboard.
      </p>
      <p style={{ color: '#6c7086', fontSize: '0.9em', marginTop: '10px' }}>
        You can add, remove, and manage users from there.
      </p>
    </div>
  )
}

function FormsTab() {
  return (
    <div style={{ padding: '20px' }}>
      <p style={{ color: '#6c7086' }}>
        Form templates and assignments are managed through the Dashboard.
      </p>
      <p style={{ color: '#6c7086', fontSize: '0.9em', marginTop: '10px' }}>
        Go to the Forms tab to view all forms and assign them to enumerators.
      </p>
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────

const panel: React.CSSProperties = {
  background: '#1e1e2e',
  minHeight: '100vh',
  padding: '0',
}

const header: React.CSSProperties = {
  background: '#313244',
  borderBottom: '1px solid #45475a',
  padding: '30px',
}

const title: React.CSSProperties = {
  fontSize: '1.8em',
  fontWeight: 700,
  color: '#cdd6f4',
  margin: '0 0 5px 0',
}

const subtitle: React.CSSProperties = {
  fontSize: '1em',
  color: '#6c7086',
  margin: '0',
}

const tabs: React.CSSProperties = {
  display: 'flex',
  gap: '0',
  borderBottom: '1px solid #45475a',
  background: '#181825',
}

const tabButton: React.CSSProperties = {
  flex: 1,
  padding: '15px 20px',
  background: '#45475a',
  color: '#cdd6f4',
  border: 'none',
  borderBottom: '3px solid transparent',
  cursor: 'pointer',
  fontSize: '1em',
  fontWeight: 500,
  transition: 'all 0.2s',
}

const tabContent: React.CSSProperties = {
  padding: '30px',
  background: '#1e1e2e',
}
