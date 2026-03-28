/**
 * API Key Management UI for org admins.
 *
 * Features:
 * - Generate new API keys (displayed once)
 * - List active keys with last used timestamp
 * - Revoke (deactivate) keys
 * - Copy key to clipboard
 */
import { useState, useEffect } from 'react'
import api from '@/lib/api'

interface ApiKey {
  id: string
  name: string
  created_at: string
  last_used_at: string | null
  is_active: boolean
}

interface NewKeyResponse extends ApiKey {
  key: string  // Shown only once
}

export default function ApiKeyManager() {
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [createdKey, setCreatedKey] = useState<NewKeyResponse | null>(null)
  const [showCopyNotice, setShowCopyNotice] = useState(false)
  const [error, setError] = useState('')

  // Load existing keys
  useEffect(() => {
    loadKeys()
  }, [])

  const loadKeys = async () => {
    try {
      setLoading(true)
      const response = await api.get('/api-keys/')
      setKeys(response.data)
      setError('')
    } catch (err) {
      setError('Failed to load API keys')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const generateKey = async () => {
    if (!newKeyName.trim()) {
      setError('Please enter a name for this key')
      return
    }

    try {
      setLoading(true)
      const response = await api.post('/api-keys/', { name: newKeyName })
      setCreatedKey(response.data)
      setNewKeyName('')
      setError('')
      await loadKeys()
    } catch (err) {
      setError('Failed to generate API key')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const revokeKey = async (keyId: string) => {
    if (!confirm('Revoke this API key? It will no longer work.')) return

    try {
      await api.delete(`/api-keys/${keyId}`)
      setError('')
      await loadKeys()
    } catch (err) {
      setError('Failed to revoke API key')
      console.error(err)
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    setShowCopyNotice(true)
    setTimeout(() => setShowCopyNotice(false), 2000)
  }

  return (
    <div style={container}>
      <h3 style={heading}>Generate API Key</h3>
      <div style={formRow}>
        <input
          type="text"
          placeholder="e.g., Mobile App, Data Export Tool"
          value={newKeyName}
          onChange={(e) => setNewKeyName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && generateKey()}
          style={input}
          disabled={loading}
        />
        <button onClick={generateKey} style={button} disabled={loading}>
          {loading ? 'Generating...' : 'Generate Key'}
        </button>
      </div>

      {error && <div style={errorAlert}>{error}</div>}

      {createdKey && (
        <div style={successBox}>
          <h4>New API Key Created</h4>
          <p style={{ color: '#999', fontSize: '0.9em', marginBottom: '10px' }}>
            Save this key now. You won't see it again.
          </p>
          <div style={keyDisplay}>
            <code style={keyCode}>{createdKey.key}</code>
            <button
              onClick={() => copyToClipboard(createdKey.key)}
              style={copyButton}
            >
              {showCopyNotice ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <p style={{ color: '#999', fontSize: '0.85em', marginTop: '10px' }}>
            Use in requests:<br />
            <code>Authorization: Bearer {createdKey.key.substring(0, 8)}...</code>
          </p>
          <button
            onClick={() => setCreatedKey(null)}
            style={dismissButton}
          >
            Got it
          </button>
        </div>
      )}

      <h3 style={{ ...heading, marginTop: '30px' }}>Active Keys</h3>
      {loading ? (
        <p>Loading keys...</p>
      ) : keys.length === 0 ? (
        <p style={emptyState}>No API keys yet. Generate one above.</p>
      ) : (
        <div style={keyList}>
          {keys.map((key) => (
            <div key={key.id} style={keyItem}>
              <div style={keyInfo}>
                <div style={keyName}>{key.name}</div>
                <div style={keyMeta}>
                  Created: {new Date(key.created_at).toLocaleDateString()}
                  {key.last_used_at && (
                    <>
                      <br />
                      Last used: {new Date(key.last_used_at).toLocaleDateString()}
                    </>
                  )}
                </div>
              </div>
              <button
                onClick={() => revokeKey(key.id)}
                style={revokeButton}
              >
                Revoke
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────

const container: React.CSSProperties = {
  padding: '20px',
}

const heading: React.CSSProperties = {
  fontSize: '1.1em',
  fontWeight: 600,
  color: '#cdd6f4',
  marginBottom: '15px',
}

const formRow: React.CSSProperties = {
  display: 'flex',
  gap: '10px',
  marginBottom: '20px',
}

const input: React.CSSProperties = {
  flex: 1,
  padding: '10px 12px',
  background: '#313244',
  border: '1px solid #45475a',
  borderRadius: '6px',
  color: '#cdd6f4',
  fontSize: '0.95em',
}

const button: React.CSSProperties = {
  padding: '10px 20px',
  background: '#89b4fa',
  color: '#1e1e2e',
  border: 'none',
  borderRadius: '6px',
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'opacity 0.2s',
}

const errorAlert: React.CSSProperties = {
  padding: '12px 15px',
  background: '#f38ba833',
  border: '1px solid #f38ba8',
  color: '#f38ba8',
  borderRadius: '6px',
  marginBottom: '15px',
  fontSize: '0.9em',
}

const successBox: React.CSSProperties = {
  padding: '20px',
  background: '#313244',
  border: '1px solid #45475a',
  borderRadius: '8px',
  marginBottom: '20px',
}

const keyDisplay: React.CSSProperties = {
  display: 'flex',
  gap: '10px',
  alignItems: 'center',
  marginTop: '10px',
}

const keyCode: React.CSSProperties = {
  flex: 1,
  padding: '10px',
  background: '#1e1e2e',
  borderRadius: '4px',
  fontSize: '0.85em',
  color: '#89b4fa',
  fontFamily: 'monospace',
  wordBreak: 'break-all',
}

const copyButton: React.CSSProperties = {
  padding: '8px 12px',
  background: '#a6e3a1',
  color: '#1e1e2e',
  border: 'none',
  borderRadius: '4px',
  cursor: 'pointer',
  fontSize: '0.9em',
  fontWeight: 500,
}

const dismissButton: React.CSSProperties = {
  marginTop: '15px',
  padding: '8px 16px',
  background: '#45475a',
  color: '#cdd6f4',
  border: 'none',
  borderRadius: '4px',
  cursor: 'pointer',
}

const keyList: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
}

const keyItem: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '15px',
  background: '#313244',
  border: '1px solid #45475a',
  borderRadius: '6px',
}

const keyInfo: React.CSSProperties = {
  flex: 1,
}

const keyName: React.CSSProperties = {
  fontSize: '1em',
  fontWeight: 500,
  color: '#cdd6f4',
  marginBottom: '5px',
}

const keyMeta: React.CSSProperties = {
  fontSize: '0.85em',
  color: '#6c7086',
}

const revokeButton: React.CSSProperties = {
  padding: '8px 16px',
  background: '#f38ba8',
  color: '#1e1e2e',
  border: 'none',
  borderRadius: '4px',
  cursor: 'pointer',
  fontWeight: 500,
  transition: 'opacity 0.2s',
}

const emptyState: React.CSSProperties = {
  color: '#6c7086',
  fontStyle: 'italic',
  fontSize: '0.95em',
}
