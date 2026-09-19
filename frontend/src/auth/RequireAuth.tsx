import { Navigate } from 'react-router-dom'
import { getStoredUser, logout } from '@/lib/api'
import { useSessionTimeout } from '@/lib/useSessionTimeout'
import SessionTimeoutModal from '@/components/SessionTimeoutModal'

export function homeForRole(role: string): string {
  if (role === 'master_admin') return '/admin'
  if (role === 'enumerator')   return '/'
  return '/'   // org_admin, supervisor
}

interface Props {
  children: React.ReactNode
  roles?: string[]
}

export default function RequireAuth({ children, roles }: Props) {
  const user = getStoredUser()
  // Every activity event (click/scroll/keydown/touch) resets this, so normal
  // form-filling or reading a screen during a long interview keeps the
  // session alive — this only fires after genuine inactivity.
  const { remaining, extend } = useSessionTimeout({ onExpire: logout })

  if (!user) return <Navigate to="/login" replace />
  if (roles && !roles.includes(user.role)) return <Navigate to={homeForRole(user.role)} replace />
  return (
    <>
      {children}
      <SessionTimeoutModal remaining={remaining} onExtend={extend} onLogout={logout} />
    </>
  )
}
