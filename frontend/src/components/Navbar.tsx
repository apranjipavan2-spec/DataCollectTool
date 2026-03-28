/**
 * Global navigation bar for FieldPulse.
 *
 * Shows on all authenticated pages. Adapts to user role:
 *   - Enumerators: Collect, (no dashboard/builder)
 *   - Supervisors: Dashboard, Collect
 *   - Admins: Dashboard, Builder, Collect
 *
 * Features:
 *   - Back button (browser history)
 *   - Home button
 *   - Role-based nav links
 *   - User name + logout
 *   - Offline indicator
 */
import { useLocation, useNavigate, Link } from 'react-router-dom'
import { getStoredUser, logout } from '@/lib/api'
import { useState, useEffect } from 'react'

const ADMIN_ROLES = ['master_admin', 'org_admin']
const SUPERVISOR_ROLES = [...ADMIN_ROLES, 'supervisor']

interface NavItem {
  path: string
  label: string
  icon: string
  roles?: string[] // undefined = all roles
}

const NAV_ITEMS: NavItem[] = [
  { path: '/',        label: 'Dashboard', icon: '📊', roles: SUPERVISOR_ROLES },
  { path: '/collect', label: 'Collect',   icon: '📋' },
  { path: '/builder', label: 'Builder',   icon: '🔧', roles: ADMIN_ROLES },
  { path: '/admin',   label: 'Admin',     icon: '🏢', roles: ['master_admin'] },
]

export default function Navbar() {
  const location = useLocation()
  const navigate = useNavigate()
  const user = getStoredUser()
  const [isOffline, setIsOffline] = useState(!navigator.onLine)
  const [showMenu, setShowMenu] = useState(false)

  useEffect(() => {
    const on = () => setIsOffline(false)
    const off = () => setIsOffline(true)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  if (!user) return null // Don't show on login page

  const visibleItems = NAV_ITEMS.filter(
    item => !item.roles || item.roles.includes(user.role)
  )

  const canGoBack = window.history.length > 1

  return (
    <nav style={navBar}>
      {/* Left: Back + Home */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {canGoBack && (
          <button onClick={() => navigate(-1)} style={iconBtn} title="Go back">
            ‹
          </button>
        )}
        <Link to={user.role === 'enumerator' ? '/collect' : '/'} style={logoLink}>
          <span style={{ fontWeight: 800, fontSize: 15, color: '#89b4fa' }}>FP</span>
        </Link>
        {isOffline && (
          <span style={offlineBadge}>offline</span>
        )}
      </div>

      {/* Center: Nav links */}
      <div style={{ display: 'flex', gap: 2 }}>
        {visibleItems.map(item => {
          const active = location.pathname === item.path
          return (
            <Link
              key={item.path}
              to={item.path}
              style={{
                ...navLink,
                background: active ? '#89b4fa22' : 'transparent',
                color: active ? '#89b4fa' : '#6c7086',
                fontWeight: active ? 600 : 400,
              }}
            >
              <span style={{ fontSize: 14 }}>{item.icon}</span>
              <span style={navLabel}>{item.label}</span>
            </Link>
          )
        })}
      </div>

      {/* Right: User menu */}
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setShowMenu(!showMenu)}
          style={userBtn}
        >
          <span style={avatar}>{user.name?.charAt(0)?.toUpperCase() || '?'}</span>
          <span style={userName}>{user.name?.split(' ')[0] || 'User'}</span>
          <span style={{ fontSize: 10, color: '#6c7086' }}>▼</span>
        </button>

        {showMenu && (
          <>
            <div style={menuBackdrop} onClick={() => setShowMenu(false)} />
            <div style={menuDropdown}>
              <div style={menuHeader}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#cdd6f4' }}>{user.name}</div>
                <div style={{ fontSize: 11, color: '#6c7086', textTransform: 'capitalize' }}>
                  {user.role?.replace('_', ' ')}
                </div>
              </div>
              <div style={menuDivider} />
              <button onClick={logout} style={menuItem}>
                <span>↪</span> Sign out
              </button>
            </div>
          </>
        )}
      </div>
    </nav>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────

const navBar: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '0 12px',
  height: 48,
  background: '#181825',
  borderBottom: '1px solid #2a2a3e',
  position: 'sticky',
  top: 0,
  zIndex: 100,
  fontFamily: 'system-ui',
}

const iconBtn: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#89b4fa',
  fontSize: 22,
  cursor: 'pointer',
  padding: '4px 8px',
  borderRadius: 6,
  lineHeight: 1,
}

const logoLink: React.CSSProperties = {
  textDecoration: 'none',
  padding: '4px 8px',
  borderRadius: 6,
}

const offlineBadge: React.CSSProperties = {
  background: '#f9e2af22',
  border: '1px solid #f9e2af',
  color: '#f9e2af',
  borderRadius: 4,
  padding: '1px 6px',
  fontSize: 10,
  fontWeight: 500,
}

const navLink: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  padding: '6px 12px',
  borderRadius: 8,
  textDecoration: 'none',
  fontSize: 13,
  transition: 'background 0.15s',
}

const navLabel: React.CSSProperties = {
  // Hide label on very small screens
}

const userBtn: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: '4px 8px',
  borderRadius: 8,
}

const avatar: React.CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: '50%',
  background: '#89b4fa33',
  color: '#89b4fa',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 13,
  fontWeight: 700,
}

const userName: React.CSSProperties = {
  color: '#cdd6f4',
  fontSize: 13,
  fontWeight: 500,
}

const menuBackdrop: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  zIndex: 99,
}

const menuDropdown: React.CSSProperties = {
  position: 'absolute',
  top: '100%',
  right: 0,
  marginTop: 6,
  background: '#1e1e2e',
  border: '1px solid #2a2a3e',
  borderRadius: 10,
  minWidth: 180,
  boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
  zIndex: 100,
  overflow: 'hidden',
}

const menuHeader: React.CSSProperties = {
  padding: '12px 14px',
}

const menuDivider: React.CSSProperties = {
  height: 1,
  background: '#2a2a3e',
}

const menuItem: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  padding: '10px 14px',
  background: 'none',
  border: 'none',
  color: '#f38ba8',
  fontSize: 13,
  cursor: 'pointer',
  textAlign: 'left',
}
