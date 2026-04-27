import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { getStoredUser, logout } from '@/lib/api'
import api from '@/lib/api'
import ThemeToggle from '@/components/ThemeToggle'

interface TopNavProps {
  title?: string
  breadcrumbs?: { label: string; path?: string; onClick?: () => void }[]
  rightContent?: React.ReactNode
}

interface InboxItem {
  id: string; type: string; title: string; body: string
  link: string; read: boolean; created_at: string | null
}

function NotificationBell() {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<InboxItem[]>([])
  const [unread, setUnread] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/inbox/')
      setItems(data.items || [])
      setUnread(data.unread_count || 0)
    } catch { }
  }, [])

  useEffect(() => { load() }, [load])
  // Poll every 60s
  useEffect(() => {
    const t = setInterval(load, 60_000)
    return () => clearInterval(t)
  }, [load])

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const markAllRead = async () => {
    await api.post('/inbox/read-all').catch(() => {})
    setUnread(0)
    setItems(prev => prev.map(i => ({ ...i, read: true })))
  }

  const handleClick = async (item: InboxItem) => {
    if (!item.read) {
      await api.patch(`/inbox/${item.id}/read`).catch(() => {})
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, read: true } : i))
      setUnread(prev => Math.max(0, prev - 1))
    }
    setOpen(false)
    if (item.link) navigate(item.link)
  }

  const TYPE_ICON: Record<string, string> = {
    comment: '💬', assignment: '📋', flagged: '🚩', approved: '✅', info: 'ℹ️'
  }

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => { setOpen(v => !v); if (!open) load() }}
        className="relative p-2 rounded-lg hover:bg-catalan-hover transition-colors">
        <span className="text-xl">🔔</span>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-catalan-error text-white text-[10px] font-bold
            rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 bg-catalan-surface border border-catalan-border rounded-xl shadow-xl z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-catalan-border">
            <span className="text-sm font-semibold text-catalan-text">Notifications</span>
            {unread > 0 && (
              <button onClick={markAllRead} className="text-xs text-catalan-primary hover:opacity-80">
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <div className="p-8 text-center text-catalan-textMuted text-sm">No notifications</div>
            ) : items.map(item => (
              <button key={item.id} onClick={() => handleClick(item)}
                className={`w-full text-left px-4 py-3 border-b border-catalan-border/50 hover:bg-catalan-hover transition-colors ${!item.read ? 'bg-catalan-primary/5' : ''}`}>
                <div className="flex gap-3 items-start">
                  <span className="text-base mt-0.5 flex-shrink-0">{TYPE_ICON[item.type] || 'ℹ️'}</span>
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm font-medium text-catalan-text truncate ${!item.read ? 'font-semibold' : ''}`}>
                      {item.title}
                    </div>
                    <div className="text-xs text-catalan-textMuted mt-0.5 line-clamp-2">{item.body}</div>
                    {item.created_at && (
                      <div className="text-[10px] text-catalan-textMuted mt-1">
                        {new Date(item.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </div>
                    )}
                  </div>
                  {!item.read && <div className="w-2 h-2 rounded-full bg-catalan-primary mt-1.5 flex-shrink-0" />}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

const TopNav: React.FC<TopNavProps> = ({ title, breadcrumbs, rightContent }) => {
  const navigate = useNavigate()
  const [showUserMenu, setShowUserMenu]           = useState(false)
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const user = getStoredUser() || { name: '', role: '' }

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false); setShowLogoutConfirm(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setShowUserMenu(false); setShowLogoutConfirm(false) }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  return (
    <div className="bg-catalan-surface border-b border-catalan-border sticky top-0 z-30">
      <div className="flex items-center justify-between h-16 px-6 pl-14 md:pl-6">

        {/* Left: Title/Breadcrumbs */}
        <div className="flex-1">
          {breadcrumbs && breadcrumbs.length > 0 ? (
            <div className="flex items-center gap-2 text-sm">
              {breadcrumbs.map((item, i) => (
                <React.Fragment key={i}>
                  {i > 0 && <span className="text-catalan-textMuted">/</span>}
                  {item.path || item.onClick ? (
                    <button onClick={() => item.onClick ? item.onClick() : navigate(item.path!)}
                      className="text-catalan-primary hover:text-catalan-primaryLight transition-colors">
                      {item.label}
                    </button>
                  ) : (
                    <span className="text-catalan-text font-medium">{item.label}</span>
                  )}
                </React.Fragment>
              ))}
            </div>
          ) : title ? (
            <h1 className="text-2xl font-bold text-catalan-text">{title}</h1>
          ) : null}
        </div>

        {/* Center: Custom Content */}
        {rightContent && (
          <div className="flex-1 flex justify-center">{rightContent}</div>
        )}

        {/* Right: Bell + User Menu */}
        <div className="flex items-center gap-2">
          {user.role !== 'master_admin' && <NotificationBell />}

          <div className="relative" ref={menuRef}>
            <button
              onClick={() => { setShowUserMenu(v => !v); setShowLogoutConfirm(false) }}
              className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-catalan-hover transition-colors">
              <div className="w-8 h-8 rounded-full bg-catalan-primary flex items-center justify-center text-catalan-bg font-semibold text-sm">
                {user.name?.[0]?.toUpperCase() || 'U'}
              </div>
              <div className="hidden sm:block text-sm">
                <p className="font-medium text-catalan-text">{user.name || 'User'}</p>
                <p className="text-xs text-catalan-textMuted capitalize">{user.role?.replace('_', ' ') || 'user'}</p>
              </div>
              <span className={`text-catalan-textMuted text-xs transition-transform duration-200 ${showUserMenu ? 'rotate-180' : ''}`}>▼</span>
            </button>

            {showUserMenu && (
              <div className="absolute right-0 mt-2 w-52 bg-catalan-surface border border-catalan-border rounded-xl shadow-xl z-50 overflow-hidden">
                <div className="px-4 py-3 border-b border-catalan-border bg-catalan-hover/50">
                  <p className="text-sm font-medium text-catalan-text truncate">{user.name || 'User'}</p>
                  <p className="text-xs text-catalan-textMuted capitalize">{user.role?.replace('_', ' ')}</p>
                </div>

                <button onClick={() => { setShowUserMenu(false); navigate('/profile') }}
                  className="w-full text-left px-4 py-2.5 hover:bg-catalan-hover text-sm text-catalan-text transition-colors flex items-center gap-2.5">
                  <span className="text-base">👤</span> My Profile
                </button>

                <div className="px-3 py-2"><ThemeToggle /></div>

                <button onClick={() => { setShowUserMenu(false); navigate('/admin/org') }}
                  className="w-full text-left px-4 py-2.5 hover:bg-catalan-hover text-sm text-catalan-text transition-colors flex items-center gap-2.5">
                  <span className="text-base">⚙️</span> Organization
                </button>

                <div className="border-t border-catalan-border" />

                {!showLogoutConfirm ? (
                  <button onClick={() => setShowLogoutConfirm(true)}
                    className="w-full text-left px-4 py-2.5 hover:bg-catalan-error/10 text-sm text-catalan-error transition-colors flex items-center gap-2.5">
                    <span className="text-base">🚪</span> Log Out
                  </button>
                ) : (
                  <div className="px-4 py-3 bg-catalan-error/5">
                    <p className="text-xs text-catalan-text mb-2 font-medium">Are you sure?</p>
                    <div className="flex gap-2">
                      <button onClick={() => { setShowUserMenu(false); setShowLogoutConfirm(false); logout() }}
                        className="flex-1 px-3 py-1.5 bg-catalan-error text-white text-xs rounded-lg font-medium hover:bg-catalan-error/80 transition-colors">
                        Yes, log out
                      </button>
                      <button onClick={() => setShowLogoutConfirm(false)}
                        className="flex-1 px-3 py-1.5 bg-catalan-hover text-catalan-text text-xs rounded-lg font-medium hover:bg-catalan-border transition-colors">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default TopNav
