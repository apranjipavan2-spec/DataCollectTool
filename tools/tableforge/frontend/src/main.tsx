import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'
import { hasValidToken, getFgLoginUrl } from './api'

// Auth gate: the analyzer is only usable by a logged-in FieldGovern user. Without
// a valid token we render a login prompt instead of the tool. This is the UX
// layer only — the backend independently rejects every API call that lacks a
// verified token, so the gate cannot be bypassed by editing client code.
function LoginRequired() {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#0f172a', color: '#e2e8f0', fontFamily: 'system-ui, sans-serif', padding: 24,
    }}>
      <div style={{
        maxWidth: 420, textAlign: 'center', background: '#1e293b', border: '1px solid #334155',
        borderRadius: 12, padding: '40px 32px',
      }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div>
        <h1 style={{ fontSize: 20, margin: '0 0 8px' }}>Sign in required</h1>
        <p style={{ fontSize: 14, color: '#94a3b8', margin: '0 0 24px', lineHeight: 1.5 }}>
          The Analyzer is only available to signed-in FieldGovern users. Please log in
          and open the Analyzer from your account.
        </p>
        <a href={getFgLoginUrl()} style={{
          display: 'inline-block', background: '#3b82f6', color: '#fff', textDecoration: 'none',
          padding: '10px 24px', borderRadius: 8, fontSize: 14, fontWeight: 600,
        }}>Go to login</a>
      </div>
    </div>
  );
}

const Root = hasValidToken() ? App : LoginRequired;

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: '' };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, color: '#ef4444', fontFamily: 'monospace' }}>
          <h2>Something went wrong</h2>
          <p>{this.state.error}</p>
          <button onClick={() => { this.setState({ hasError: false, error: '' }); }}
            style={{ marginTop: 16, padding: '8px 16px', cursor: 'pointer' }}>
            Try Again
          </button>
          <button onClick={() => window.location.reload()}
            style={{ marginTop: 16, marginLeft: 8, padding: '8px 16px', cursor: 'pointer' }}>
            Reload Page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  </React.StrictMode>,
)
