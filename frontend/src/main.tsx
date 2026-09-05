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

// Stale-chunk recovery: after a deploy, a tab opened on the old build may try to
// lazy-load a chunk hash that no longer exists on the server. Vite fires
// `vite:preloadError` — reload once to pull the fresh index + chunks instead of
// showing an error. The 10s guard prevents a reload loop if the fetch keeps failing.
window.addEventListener('vite:preloadError', () => {
  const last = Number(sessionStorage.getItem('fg-preload-reload-at') || 0)
  if (Date.now() - last > 10_000) {
    sessionStorage.setItem('fg-preload-reload-at', String(Date.now()))
    window.location.reload()
  }
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
