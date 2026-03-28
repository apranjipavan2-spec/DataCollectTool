import { Navigate } from 'react-router-dom'
import { getStoredUser } from '@/lib/api'

interface Props {
  children: React.ReactNode
  roles?: string[]   // if provided, restrict to these roles
}

export default function RequireAuth({ children, roles }: Props) {
  const user = getStoredUser()
  if (!user) return <Navigate to="/login" replace />
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />
  return <>{children}</>
}
