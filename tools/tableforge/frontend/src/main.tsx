import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'

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
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
