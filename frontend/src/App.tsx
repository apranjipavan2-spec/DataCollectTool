import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Dashboard           from '@/dashboard/Dashboard.modern'
import FormBuilder         from '@/builder/FormBuilder.modern'
import LoginPage           from '@/auth/LoginPage'
import ForgotPasswordPage  from '@/auth/ForgotPasswordPage'
import ResetPasswordPage   from '@/auth/ResetPasswordPage'
import QrLoginPage         from '@/auth/QrLoginPage'
import RequireAuth, { homeForRole } from '@/auth/RequireAuth'
import FieldApp       from '@/collect/FieldApp.modern'
import AdminPanel     from '@/admin/AdminPanel.modern'
import OrgAdminPanel  from '@/admin/OrgAdminPanel.modern'
import UserProfile    from '@/profile/UserProfile'
import ProgramsPage        from '@/programs/ProgramsPage'
import FieldGovern         from '@/programs/FieldGovern'
import FgAnalyzer          from '@/programs/FgAnalyzer'
import FgCleaner           from '@/programs/FgCleaner'
import FgWriter            from '@/reports/FgWriter'
import FileManagerPage     from '@/fg/FileManagerPage'
import SuperAdminMonitor   from '@/admin/SuperAdminMonitor'
import MigrationPage      from '@/migration/MigrationPage'
import FieldMapPage       from '@/map/FieldMapPage'
import PublicSurveyPage   from '@/collect/PublicSurveyPage'
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

function FloatingContact() {
  return (
    <a
      href="https://wa.me/918088709011?text=Hi%2C%20I%27d%20like%20to%20know%20more%20about%20FieldGovern."
      target="_blank"
      rel="noopener noreferrer"
      title="Contact us on WhatsApp"
      className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-full shadow-lg text-white text-sm font-semibold transition-transform hover:scale-105 active:scale-95"
      style={{ background: '#25D366' }}
    >
      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
      </svg>
      Chat with us
    </a>
  )
}

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
            <FloatingContact />
            <HelpPanel />
            <HelpSpotlight />
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route path="/auth/qr-login" element={<QrLoginPage />} />

              <Route path="/" element={
                <RequireAuth roles={['org_admin', 'supervisor', 'enumerator']}>
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

              <Route path="/admin/org" element={<Navigate to="/fg/settings" replace />} />
              <Route path="/fg/settings" element={
                <RequireAuth roles={['master_admin', 'org_admin', 'supervisor']}>
                  <ErrorBoundary>
                    <OrgAdminPanel />
                  </ErrorBoundary>
                </RequireAuth>
              } />

              <Route path="/programs" element={
                <RequireAuth roles={['org_admin', 'supervisor']}>
                  <ErrorBoundary>
                    <ProgramsPage />
                  </ErrorBoundary>
                </RequireAuth>
              } />

              <Route path="/programs/:programId/govern" element={
                <RequireAuth roles={['org_admin', 'supervisor']}>
                  <ErrorBoundary>
                    <FieldGovern />
                  </ErrorBoundary>
                </RequireAuth>
              } />

              <Route path="/monitor" element={
                <RequireAuth roles={['master_admin']}>
                  <ErrorBoundary>
                    <SuperAdminMonitor />
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

              <Route path="/migration" element={
                <RequireAuth roles={['org_admin', 'master_admin']}>
                  <ErrorBoundary>
                    <MigrationPage />
                  </ErrorBoundary>
                </RequireAuth>
              } />

              <Route path="/writer" element={<Navigate to="/fg/writer" replace />} />

              <Route path="/fg/analyzer" element={
                <RequireAuth roles={['org_admin', 'supervisor']}>
                  <ErrorBoundary>
                    <FgAnalyzer />
                  </ErrorBoundary>
                </RequireAuth>
              } />

              <Route path="/fg/cleaner" element={
                <RequireAuth roles={['org_admin', 'supervisor']}>
                  <ErrorBoundary>
                    <FgCleaner />
                  </ErrorBoundary>
                </RequireAuth>
              } />

              <Route path="/fg/writer" element={
                <RequireAuth roles={['org_admin', 'supervisor']}>
                  <ErrorBoundary>
                    <FgWriter />
                  </ErrorBoundary>
                </RequireAuth>
              } />

              <Route path="/fg/files" element={
                <RequireAuth roles={['org_admin', 'supervisor']}>
                  <ErrorBoundary>
                    <FileManagerPage />
                  </ErrorBoundary>
                </RequireAuth>
              } />

              <Route path="/map" element={
                <RequireAuth roles={['org_admin', 'supervisor']}>
                  <ErrorBoundary>
                    <FieldMapPage />
                  </ErrorBoundary>
                </RequireAuth>
              } />

              <Route path="/survey/:token" element={
                <ErrorBoundary>
                  <PublicSurveyPage />
                </ErrorBoundary>
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
