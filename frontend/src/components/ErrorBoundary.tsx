/**
 * ErrorBoundary — catches unhandled React render errors and shows a
 * recovery UI instead of a blank screen.
 *
 * Usage:
 *   <ErrorBoundary>
 *     <SomePage />
 *   </ErrorBoundary>
 *
 * Or with a custom fallback:
 *   <ErrorBoundary fallback={(error, reset) => <p>...</p>}>
 */

import React, { Component } from 'react'
import * as Sentry from '@sentry/react'
import EmojiIcon from '@/components/EmojiIcon'

interface Props {
  children: React.ReactNode
  fallback?: (error: Error, reset: () => void) => React.ReactNode
}

interface State {
  error: Error | null
  errorInfo: string
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { error: null, errorInfo: '' }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    this.setState({ errorInfo: info.componentStack ?? '' })
    console.error('[ErrorBoundary]', error, info)
    // Report to Sentry if configured (no-ops when DSN is absent)
    Sentry.captureException(error, { extra: { componentStack: info.componentStack } })
  }

  handleReset = () => this.setState({ error: null, errorInfo: '' })

  render() {
    const { error, errorInfo } = this.state
    if (!error) return this.props.children
    if (this.props.fallback) return this.props.fallback(error, this.handleReset)
    return <DefaultErrorUI error={error} errorInfo={errorInfo} onReset={this.handleReset} />
  }
}

// ── Default full-page error UI ───────────────────────────────────────────────

function DefaultErrorUI({
  error,
  errorInfo,
  onReset,
}: {
  error: Error
  errorInfo: string
  onReset: () => void
}) {
  const [showDetails, setShowDetails] = React.useState(false)

  return (
    <div className="min-h-screen bg-catalan-bg flex items-center justify-center p-6">
      <div className="max-w-lg w-full bg-catalan-surface border border-catalan-border rounded-2xl p-8 text-center space-y-5">

        <div className="text-6xl"><EmojiIcon e="⚠" /></div>

        <div>
          <h1 className="text-xl font-bold text-catalan-text mb-2">Something went wrong</h1>
          <p className="text-sm text-catalan-textMuted">
            An unexpected error occurred. Your data has not been affected.
          </p>
        </div>

        <div className="bg-catalan-error/10 border border-catalan-error/30 rounded-xl px-4 py-3 text-left">
          <p className="text-catalan-error text-sm font-mono break-all">
            {error.message || 'Unknown error'}
          </p>
        </div>

        <div className="flex gap-3 justify-center flex-wrap">
          <button
            onClick={onReset}
            className="px-5 py-2.5 bg-catalan-primary text-catalan-bg rounded-xl text-sm font-semibold hover:bg-catalan-primary/80 transition-colors"
          >
            Try again
          </button>
          <button
            onClick={() => { window.location.href = '/' }}
            className="px-5 py-2.5 border border-catalan-border text-catalan-textMuted rounded-xl text-sm hover:bg-catalan-hover hover:text-catalan-text transition-colors"
          >
            Go to Dashboard
          </button>
          <button
            onClick={() => window.location.reload()}
            className="px-5 py-2.5 border border-catalan-border text-catalan-textMuted rounded-xl text-sm hover:bg-catalan-hover hover:text-catalan-text transition-colors"
          >
            Reload page
          </button>
        </div>

        <button
          onClick={() => setShowDetails(v => !v)}
          className="text-xs text-catalan-textMuted/50 hover:text-catalan-textMuted transition-colors"
        >
          {showDetails ? 'Hide' : 'Show'} technical details
        </button>

        {showDetails && errorInfo && (
          <pre className="text-left text-xs text-catalan-textMuted/70 bg-catalan-bg border border-catalan-border rounded-xl p-4 overflow-auto max-h-48 font-mono leading-relaxed">
            {errorInfo.trim()}
          </pre>
        )}
      </div>
    </div>
  )
}

export default ErrorBoundary
