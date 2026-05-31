import React from 'react'
import ReactDOM from 'react-dom/client'
import * as Sentry from '@sentry/react'
import posthog from 'posthog-js'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import './i18n'
import './index.css'

const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: import.meta.env.MODE,
    // Only send 20% of traces in production to keep quotas low
    tracesSampleRate: import.meta.env.PROD ? 0.2 : 1.0,
    // Capture replay on errors only
    replaysOnErrorSampleRate: 1.0,
    replaysSessionSampleRate: 0,
    integrations: [
      Sentry.browserTracingIntegration(),
    ],
  })
}

const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined
if (POSTHOG_KEY) {
  posthog.init(POSTHOG_KEY, {
    api_host: 'https://us.i.posthog.com',
    defaults: '2026-01-30',
    person_profiles: 'identified_only',
    capture_pageview: true,
    capture_pageleave: true,
    session_recording: { maskAllInputs: true },
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
