import React, { lazy, Suspense, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import RequireAuth, { homeForRole } from '@/auth/RequireAuth'
import { LanguageProvider } from '@/i18n/LanguageContext'
import { ToastProvider } from '@/lib/ToastContext'
import { ThemeProvider } from '@/lib/ThemeContext'
import { useSessionTimeout } from '@/lib/useSessionTimeout'
import { saveFormDraft, loadFormDraft } from '@/lib/formDraft'
import { logout, getStoredUser } from '@/lib/api'
import SessionTimeoutModal from '@/components/SessionTimeoutModal'
import ErrorBoundary from '@/components/ErrorBoundary'
import { HelpProvider } from '@/help/HelpContext'
import HelpPanel from '@/help/HelpPanel'
import HelpSpotlight from '@/help/HelpSpotlight'
import { SubscriptionProvider } from '@/lib/SubscriptionContext'
import SubscriptionBanner from '@/components/SubscriptionBanner'
import UpgradeModal from '@/components/UpgradeModal'
import OnboardingWizard from '@/components/OnboardingWizard'

// Route-level code splitting — each lazy() call becomes a separate dynamic import.
// This is what makes manualChunks actually defer loading instead of just splitting files.
const Dashboard       = lazy(() => import('@/dashboard/Dashboard.modern'))
const FormBuilder     = lazy(() => import('@/builder/FormBuilder.modern'))
const LoginPage       = lazy(() => import('@/auth/LoginPage'))
const ForgotPasswordPage = lazy(() => import('@/auth/ForgotPasswordPage'))
const ResetPasswordPage  = lazy(() => import('@/auth/ResetPasswordPage'))
const QrLoginPage     = lazy(() => import('@/auth/QrLoginPage'))
const RegisterPage    = lazy(() => import('@/auth/RegisterPage'))
const VerifyEmailPage = lazy(() => import('@/auth/VerifyEmailPage'))
const FieldApp        = lazy(() => import('@/collect/FieldApp.modern'))
const AdminPanel      = lazy(() => import('@/admin/AdminPanel.modern'))
const OrgAdminPanel   = lazy(() => import('@/admin/OrgAdminPanel.modern'))
const UserProfile     = lazy(() => import('@/profile/UserProfile'))
const ProgramsPage    = lazy(() => import('@/programs/ProgramsPage'))
const FieldGovern     = lazy(() => import('@/programs/FieldGovern'))
const FgAnalyzer      = lazy(() => import('@/programs/FgAnalyzer'))
const FgCleaner       = lazy(() => import('@/programs/FgCleaner'))
const FgWriter        = lazy(() => import('@/reports/FgWriter'))
const FileManagerPage = lazy(() => import('@/fg/FileManagerPage'))
const SuperAdminMonitor = lazy(() => import('@/admin/SuperAdminMonitor'))
const MigrationPage   = lazy(() => import('@/migration/MigrationPage'))
const FieldMapPage    = lazy(() => import('@/map/FieldMapPage'))
const PublicSurveyPage   = lazy(() => import('@/collect/PublicSurveyPage'))
const RecoverPage        = lazy(() => import('@/collect/RecoverPage'))
const SubscriptionPage   = lazy(() => import('@/admin/SubscriptionPage'))
const AdminPayments      = lazy(() => import('@/admin/AdminPayments'))
const PricingPage        = lazy(() => import('@/pages/PricingPage'))
const BinPage            = lazy(() => import('@/admin/BinPage'))

function PageLoader() {
  return (
    <div className="min-h-screen bg-catalan-bg flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-catalan-primary border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

function FloatingContact() {
  const [dismissed, setDismissed] = useState(() => localStorage.getItem('fg_wa_dismissed') === '1')
  if (dismissed) return null
  return (
    <div className="fixed bottom-6 right-6 z-40 flex items-center">
      <a
        href="https://wa.me/918088709011?text=Hi%2C%20I%27d%20like%20to%20know%20more%20about%20FieldGovern."
        target="_blank"
        rel="noopener noreferrer"
        title="Contact us on WhatsApp"
        className="flex items-center gap-2 px-4 py-3 rounded-full shadow-lg text-white text-sm font-semibold transition-transform hover:scale-105 active:scale-95"
        style={{ background: '#25D366' }}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
        </svg>
        Chat with us
      </a>
      <button
        type="button"
        onClick={() => { localStorage.setItem('fg_wa_dismissed', '1'); setDismissed(true) }}
        title="Hide"
        aria-label="Hide WhatsApp chat button"
        className="absolute -top-2 -right-2 w-5 h-5 flex items-center justify-center rounded-full bg-catalan-surface text-catalan-textMuted border border-catalan-border shadow hover:text-catalan-text hover:scale-110 transition-all text-xs leading-none"
      >
        ×
      </button>
    </div>
  )
}

function RoleHome() {
  const user = getStoredUser()
  return <Navigate to={user ? homeForRole(user.role) : '/login'} replace />
}

function SessionTimeoutManager() {
  const user = getStoredUser()

  // Re-touch whichever draft was last being edited (via the active-draft
  // pointer), preserving its own formId — re-saving under a hardcoded `null`
  // would silently reassign an in-progress *existing* form's draft to the
  // "new form" bucket, orphaning it from the form it actually belongs to.
  const touchActiveDraft = () => {
    const draft = loadFormDraft()
    if (draft) saveFormDraft(draft.schema, draft.formId)
  }
  const handleExpire = () => { touchActiveDraft(); logout() }

  const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000

  const { remaining, isWarning, extend } = useSessionTimeout({
    warnAfterMs:   THREE_DAYS_MS - 5 * 60 * 1000,
    expireAfterMs: THREE_DAYS_MS,
    onExpire: handleExpire,
  })

  if (!user || !isWarning) return null

  return (
    <SessionTimeoutModal
      remaining={remaining}
      onExtend={extend}
      onLogout={() => { touchActiveDraft(); logout() }}
    />
  )
}

function LazyRoute({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary>
      <Suspense fallback={<PageLoader />}>
        {children}
      </Suspense>
    </ErrorBoundary>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
      <ToastProvider>
        <LanguageProvider>
          <HelpProvider>
          <BrowserRouter>
            <SubscriptionProvider>
            <SessionTimeoutManager />
            <FloatingContact />
            <SubscriptionBanner />
            <UpgradeModal />
            <OnboardingWizard />
            <HelpPanel />
            <HelpSpotlight />
            <Routes>
              <Route path="/login" element={<LazyRoute><LoginPage /></LazyRoute>} />
              <Route path="/forgot-password" element={<LazyRoute><ForgotPasswordPage /></LazyRoute>} />
              <Route path="/reset-password" element={<LazyRoute><ResetPasswordPage /></LazyRoute>} />
              <Route path="/auth/qr-login" element={<LazyRoute><QrLoginPage /></LazyRoute>} />
              <Route path="/register" element={<LazyRoute><RegisterPage /></LazyRoute>} />
              <Route path="/verify-email" element={<LazyRoute><VerifyEmailPage /></LazyRoute>} />

              <Route path="/" element={
                <RequireAuth roles={['org_admin', 'supervisor', 'enumerator']}>
                  <LazyRoute><Dashboard /></LazyRoute>
                </RequireAuth>
              } />

              <Route path="/builder" element={
                <RequireAuth roles={['org_admin']}>
                  <LazyRoute><FormBuilder /></LazyRoute>
                </RequireAuth>
              } />

              <Route path="/collect" element={
                <RequireAuth>
                  <LazyRoute><FieldApp /></LazyRoute>
                </RequireAuth>
              } />

              <Route path="/admin" element={
                <RequireAuth roles={['master_admin']}>
                  <LazyRoute><AdminPanel /></LazyRoute>
                </RequireAuth>
              } />

              <Route path="/admin/org" element={<Navigate to="/fg/settings" replace />} />
              <Route path="/fg/settings" element={
                <RequireAuth roles={['master_admin', 'org_admin', 'supervisor']}>
                  <LazyRoute><OrgAdminPanel /></LazyRoute>
                </RequireAuth>
              } />

              <Route path="/programs" element={
                <RequireAuth roles={['org_admin', 'supervisor']}>
                  <LazyRoute><ProgramsPage /></LazyRoute>
                </RequireAuth>
              } />

              <Route path="/programs/:programId/govern" element={
                <RequireAuth roles={['org_admin', 'supervisor']}>
                  <LazyRoute><FieldGovern /></LazyRoute>
                </RequireAuth>
              } />

              <Route path="/monitor" element={
                <RequireAuth roles={['master_admin']}>
                  <LazyRoute><SuperAdminMonitor /></LazyRoute>
                </RequireAuth>
              } />

              <Route path="/profile" element={
                <RequireAuth>
                  <LazyRoute><UserProfile /></LazyRoute>
                </RequireAuth>
              } />

              <Route path="/migration" element={
                <RequireAuth roles={['org_admin', 'master_admin']}>
                  <LazyRoute><MigrationPage /></LazyRoute>
                </RequireAuth>
              } />

              <Route path="/writer" element={<Navigate to="/fg/writer" replace />} />

              <Route path="/fg/analyzer" element={
                <RequireAuth roles={['org_admin', 'supervisor', 'master_admin']}>
                  <LazyRoute><FgAnalyzer /></LazyRoute>
                </RequireAuth>
              } />

              <Route path="/fg/cleaner" element={
                <RequireAuth roles={['org_admin', 'supervisor', 'master_admin']}>
                  <LazyRoute><FgCleaner /></LazyRoute>
                </RequireAuth>
              } />

              <Route path="/fg/writer" element={
                <RequireAuth roles={['org_admin', 'supervisor', 'master_admin']}>
                  <LazyRoute><FgWriter /></LazyRoute>
                </RequireAuth>
              } />

              <Route path="/fg/files" element={
                <RequireAuth roles={['org_admin', 'supervisor', 'master_admin']}>
                  <LazyRoute><FileManagerPage /></LazyRoute>
                </RequireAuth>
              } />

              <Route path="/map" element={
                <RequireAuth roles={['org_admin', 'supervisor']}>
                  <LazyRoute><FieldMapPage /></LazyRoute>
                </RequireAuth>
              } />

              <Route path="/survey/recover" element={
                <LazyRoute><RecoverPage /></LazyRoute>
              } />

              <Route path="/survey/:token" element={
                <LazyRoute><PublicSurveyPage /></LazyRoute>
              } />

              <Route path="/pricing" element={
                <LazyRoute><PricingPage /></LazyRoute>
              } />

              <Route path="/subscription" element={
                <RequireAuth roles={['org_admin', 'master_admin']}>
                  <LazyRoute><SubscriptionPage /></LazyRoute>
                </RequireAuth>
              } />

              <Route path="/admin/payments" element={
                <RequireAuth roles={['master_admin']}>
                  <LazyRoute><AdminPayments /></LazyRoute>
                </RequireAuth>
              } />

              <Route path="/bin" element={
                <RequireAuth roles={['org_admin', 'master_admin']}>
                  <LazyRoute><BinPage /></LazyRoute>
                </RequireAuth>
              } />

              <Route path="*" element={<RoleHome />} />
            </Routes>
          </SubscriptionProvider>
          </BrowserRouter>
          </HelpProvider>
        </LanguageProvider>
      </ToastProvider>
      </ThemeProvider>
    </ErrorBoundary>
  )
}
