import { Navigate } from 'react-router-dom'
import { getStoredUser } from '@/lib/api'

export function homeForRole(role: string): string {
  if (role === 'master_admin') return '/admin'
  if (role === 'enumerator')   return '/collect'
  return '/'   // org_admin, supervisor
}

interface Props {
  children: React.ReactNode
  roles?: string[]
}

export default function RequireAuth({ children, roles }: Props) {
  const user = getStoredUser()
  if (!user) return <Navigate to="/login" replace />
  if (roles && !roles.includes(user.role)) return <Navigate to={homeForRole(user.role)} replace />
  return <>{children}</>
}
