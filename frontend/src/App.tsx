import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Dashboard           from '@/dashboard/Dashboard.modern'
import FormBuilder         from '@/builder/FormBuilder.modern'
import LoginPage           from '@/auth/LoginPage'
import ForgotPasswordPage  from '@/auth/ForgotPasswordPage'
import ResetPasswordPage   from '@/auth/ResetPasswordPage'
import RequireAuth, { homeForRole } from '@/auth/RequireAuth'
import FieldApp       from '@/collect/FieldApp.modern'
import AdminPanel     from '@/admin/AdminPanel.modern'
import OrgAdminPanel  from '@/admin/OrgAdminPanel.modern'
import UserProfile    from '@/profile/UserProfile'
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

function RoleHome() {
  const user = getStoredUser()
  return <Navigate to={user ? homeForRole(user.role) : '/login'} replace />
}

// ── Session timeout manager ─────────────────────────────────────────────────
// Lives inside BrowserRouter so it can read location (for future use)
// but outside RequireAuth so it always runs.

function SessionTimeoutManager() {
  const user = getStoredUser()

  const handleExpire = () => {
    // Save any in-progress form draft before logging out
    // The FormBuilder keeps draft in localStorage automatically (auto-save),
    // but we do a final flush here just in case the debounce hadn't fired yet.
    const draft = loadFormDraft()
    if (draft) {
      saveFormDraft(draft.schema, draft.formId)   // re-save to ensure it's fresh
    }
    logout()
  }

  const { remaining, isWarning, extend } = useSessionTimeout({
    warnAfterMs:   28 * 60 * 1000,   // 28 minutes
    expireAfterMs: 30 * 60 * 1000,   // 30 minutes
    onExpire: handleExpire,
  })

  // Don't show modal if user is not logged in
  if (!user || !isWarning) return null

  return (
    <SessionTimeoutModal
      remaining={remaining}
      onExtend={extend}
      onLogout={() => { saveFormDraft(loadFormDraft()?.schema ?? { title:'', sections:[], version:1 }, null); logout() }}
    />
  )
}

// ── App ─────────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
      <ToastProvider>
        <LanguageProvider>
          <HelpProvider>
          <BrowserRouter>
            <SessionTimeoutManager />
            <HelpPanel />
            <HelpSpotlight />
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />

              <Route path="/" element={
                <RequireAuth roles={['org_admin', 'supervisor']}>
                  <ErrorBoundary>
                    <Dashboard />
                  </ErrorBoundary>
                </RequireAuth>
              } />

              <Route path="/builder" element={
                <RequireAuth roles={['org_admin']}>
                  <ErrorBoundary>
                    <FormBuilder />
                  </ErrorBoundary>
                </RequireAuth>
              } />

              <Route path="/collect" element={
                <RequireAuth>
                  <ErrorBoundary>
                    <FieldApp />
                  </ErrorBoundary>
                </RequireAuth>
              } />

              <Route path="/admin" element={
                <RequireAuth roles={['master_admin']}>
                  <ErrorBoundary>
                    <AdminPanel />
                  </ErrorBoundary>
                </RequireAuth>
              } />

              <Route path="/admin/org" element={
                <RequireAuth roles={['master_admin', 'org_admin', 'supervisor']}>
                  <ErrorBoundary>
                    <OrgAdminPanel />
                  </ErrorBoundary>
                </RequireAuth>
              } />

              <Route path="/profile" element={
                <RequireAuth>
                  <ErrorBoundary>
                    <UserProfile />
                  </ErrorBoundary>
                </RequireAuth>
              } />

              <Route path="*" element={<RoleHome />} />
            </Routes>
          </BrowserRouter>
          </HelpProvider>
        </LanguageProvider>
      </ToastProvider>
      </ThemeProvider>
    </ErrorBoundary>
  )
}
