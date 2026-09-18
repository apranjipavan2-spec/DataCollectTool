import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { getStoredUser, logout } from '@/lib/api'
import api from '@/lib/api'
import ThemeToggle from '@/components/ThemeToggle'
import { useSubscription } from '@/lib/SubscriptionContext'
import { useTheme } from '@/lib/ThemeContext'
import EmojiIcon from '@/components/EmojiIcon'

interface TopNavProps {
  title?: string
  titleNode?: React.ReactNode
  breadcrumbs?: { label: string; path?: string; onClick?: () => void }[]
  rightContent?: React.ReactNode
}

interface InboxItem {
  id: string; type: string; title: string; body: string
  link: string; read: boolean; created_at: string | null
}

const TYPE_ICON: Record<string, string> = {
  comment: '💬', assignment: '📋', flagged: '🚩', approved: '✅',
  rejected: '❌', payment: '💳', info: 'ℹ️', system: '⚙️',
}
const TYPE_COLOR: Record<string, string> = {
  flagged:  'bg-amber-500/8',
  rejected: 'bg-red-500/8',
  approved: 'bg-emerald-500/8',
  payment:  'bg-blue-500/8',
}
const TYPE_ICON_BG: Record<string, string> = {
  flagged:  'bg-amber-50',
  rejected: 'bg-red-50',
  approved: 'bg-emerald-50',
  payment:  'bg-blue-50',
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1)  return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)  return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days === 1) return 'Yesterday'
  if (days < 7)   return `${days}d ago`
  return new Date(dateStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}

function NotifRow({ item, onClick }: { item: InboxItem; onClick: (i: InboxItem) => void }) {
  const unread = !item.read
  return (
    <button
      onClick={() => onClick(item)}
      className={`w-full text-left px-4 py-3.5 border-b border-catalan-border/40 hover:bg-catalan-hover transition-colors ${unread ? (TYPE_COLOR[item.type] || 'bg-catalan-primary/5') : ''}`}
    >
      <div className="flex gap-3 items-start">
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-sm flex-shrink-0 mt-0.5 ${unread ? (TYPE_ICON_BG[item.type] || 'bg-catalan-primary/10') : 'bg-catalan-bg'}`}>
          <EmojiIcon e={TYPE_ICON[item.type] || '🔔'} />
        </div>
        <div className="flex-1 min-w-0">
          <div className={`text-sm leading-snug ${unread ? 'font-semibold text-catalan-text' : 'font-medium text-catalan-textMuted'}`}>
            {item.title}
          </div>
          <div className="text-xs text-catalan-textMuted mt-0.5 line-clamp-2 leading-relaxed">{item.body}</div>
          <div className="text-[10px] text-catalan-textMuted/70 mt-1.5">{timeAgo(item.created_at)}</div>
        </div>
        {unread && <div className="w-2 h-2 rounded-full bg-catalan-primary mt-2 flex-shrink-0 animate-pulse" />}
      </div>
    </button>
  )
}

function navThemeStyles(dark: boolean) {
  const sep = dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)'
  return {
    bar: {
      background: dark
        ? 'linear-gradient(90deg, rgba(30,30,46,0.92) 0%, rgba(17,17,27,0.95) 100%)'
        : 'linear-gradient(90deg, rgba(255,255,255,0.95) 0%, rgba(245,245,249,0.97) 100%)',
      borderBottom: `1px solid ${sep}`,
      boxShadow: `0 4px 20px rgba(0,0,0,${dark ? 0.15 : 0.05})`,
    },
    accent: {
      background: `linear-gradient(90deg, transparent, rgba(99,102,241,${dark ? 0.3 : 0.15}) 30%, rgba(139,92,246,${dark ? 0.3 : 0.15}) 70%, transparent)`,
    },
    bellActive: {
      background: `linear-gradient(135deg, rgba(99,102,241,${dark ? 0.15 : 0.1}), rgba(139,92,246,${dark ? 0.1 : 0.07}))`,
      boxShadow: '0 2px 8px rgba(99,102,241,0.15)',
    },
    dropdown: {
      background: dark
        ? 'linear-gradient(180deg, rgba(30,30,46,0.98), rgba(17,17,27,0.99))'
        : 'linear-gradient(180deg, rgba(255,255,255,0.99), rgba(245,245,249,0.99))',
      border: `1px solid ${sep}`,
      boxShadow: `0 20px 60px rgba(0,0,0,${dark ? 0.5 : 0.15}), 0 0 0 1px ${dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)'}`,
    },
    sep,
    userBtnActive: {
      background: `linear-gradient(135deg, rgba(99,102,241,${dark ? 0.12 : 0.08}), rgba(139,92,246,${dark ? 0.08 : 0.05}))`,
      border: `1px solid ${sep}`,
    },
    userHeader: {
      background: `linear-gradient(135deg, rgba(99,102,241,${dark ? 0.1 : 0.06}), rgba(139,92,246,${dark ? 0.06 : 0.03}))`,
      borderBottom: `1px solid ${sep}`,
    },
    usageBar: {
      background: dark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
      border: `1px solid ${dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}`,
    },
    cancelBtn: {
      background: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
      border: `1px solid ${sep}`,
    },
  }
}

function NotificationBell() {
  const [open,        setOpen]        = useState(false)
  const [items,       setItems]       = useState<InboxItem[]>([])
  const [unread,      setUnread]      = useState(0)
  const [fetchingNow, setFetchingNow] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const { resolvedTheme } = useTheme()
  const ts = navThemeStyles(resolvedTheme === 'dark')

  const load = useCallback(async (showSpinner = false) => {
    if (showSpinner) setFetchingNow(true)
    try {
      const { data } = await api.get('/inbox/')
      setItems(data.items || [])
      setUnread(data.unread_count || 0)
    } catch { }
    finally { setFetchingNow(false) }
  }, [])

  useEffect(() => { load() }, [load])
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

  const unreadItems = items.filter(i => !i.read)
  const readItems   = items.filter(i => i.read)

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => { setOpen(v => { const next = !v; if (next) load(items.length === 0); return next }); }}
        className="relative p-2 rounded-xl transition-all duration-200 group"
        style={open ? ts.bellActive : undefined}
        aria-label="Notifications"
      >
        <span className="text-xl group-hover:scale-110 inline-block transition-transform duration-200"><EmojiIcon e="🔔" /></span>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1"
            style={{ background: 'linear-gradient(135deg, #ef4444, #f97316)', boxShadow: '0 2px 8px rgba(239,68,68,0.4)' }}>
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-96 rounded-2xl shadow-2xl z-50 overflow-hidden backdrop-blur-xl"
          style={ts.dropdown}>

          <div className="flex items-center justify-between px-4 py-3.5"
            style={{ borderBottom: `1px solid ${ts.sep}` }}>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-catalan-text">Notifications</span>
              {unread > 0 && (
                <span className="text-[11px] font-bold text-white rounded-full px-2 py-0.5"
                  style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>
                  {unread} new
                </span>
              )}
            </div>
            {unread > 0 && (
              <button onClick={markAllRead} className="text-xs text-catalan-primary hover:opacity-70 font-medium transition-opacity">
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-[420px] overflow-y-auto">
            {fetchingNow ? (
              <div className="p-4 space-y-3">
                {[1, 2, 3].map(n => (
                  <div key={n} className="flex gap-3 animate-pulse">
                    <div className="w-8 h-8 rounded-xl bg-catalan-border flex-shrink-0" />
                    <div className="flex-1 space-y-2 py-1">
                      <div className="h-3 bg-catalan-border rounded w-3/4" />
                      <div className="h-2.5 bg-catalan-border rounded w-full" />
                      <div className="h-2 bg-catalan-border rounded w-1/4" />
                    </div>
                  </div>
                ))}
              </div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
                <span className="text-4xl mb-3 opacity-20"><EmojiIcon e="🔔" /></span>
                <p className="text-sm font-medium text-catalan-text mb-1">All caught up</p>
                <p className="text-xs text-catalan-textMuted leading-relaxed">
                  Notifications about submissions, payments, and assignments will appear here.
                </p>
              </div>
            ) : (
              <>
                {unreadItems.length > 0 && (
                  <>
                    <div className="px-4 py-1.5 text-[10px] font-bold text-catalan-textMuted uppercase tracking-widest bg-catalan-bg/60">New</div>
                    {unreadItems.map(item => <NotifRow key={item.id} item={item} onClick={handleClick} />)}
                  </>
                )}
                {readItems.length > 0 && (
                  <>
                    {unreadItems.length > 0 && (
                      <div className="px-4 py-1.5 text-[10px] font-bold text-catalan-textMuted uppercase tracking-widest bg-catalan-bg/60">Earlier</div>
                    )}
                    {readItems.map(item => <NotifRow key={item.id} item={item} onClick={handleClick} />)}
                  </>
                )}
              </>
            )}
          </div>

          {items.length > 0 && (
            <div className="px-4 py-2.5 flex justify-end" style={{ borderTop: `1px solid ${ts.sep}` }}>
              <button
                onClick={markAllRead}
                disabled={unread === 0}
                className="text-xs text-catalan-textMuted hover:text-catalan-text disabled:opacity-30 transition-colors"
              >
                Clear all
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function UsageBar() {
  const user = getStoredUser()
  const { data } = useSubscription()
  const navigate = useNavigate()
  const { resolvedTheme } = useTheme()
  const ts = navThemeStyles(resolvedTheme === 'dark')

  if (!data || !['org_admin', 'supervisor'].includes(user?.role ?? '')) return null

  const used  = data.usage.submissions_used
  const limit = data.limits.submissions_limit
  if (!limit) return null

  const pct   = Math.min(100, Math.round((used / limit) * 100))
  const barGradient = pct >= 90
    ? 'linear-gradient(90deg, #ef4444, #f97316)'
    : pct >= 70
    ? 'linear-gradient(90deg, #f59e0b, #eab308)'
    : 'linear-gradient(90deg, #6366f1, #8b5cf6)'
  const label = pct >= 90 ? 'text-catalan-error' : pct >= 70 ? 'text-amber-500' : 'text-catalan-textMuted'

  return (
    <button
      onClick={() => navigate('/subscription')}
      title={`${used.toLocaleString()} of ${limit.toLocaleString()} submissions used`}
      className="hidden sm:flex flex-col gap-1 min-w-[120px] hover:opacity-80 transition-opacity px-3 py-1.5 rounded-xl"
      style={ts.usageBar}
    >
      <div className={`flex justify-between text-[10px] ${label}`}>
        <span>Submissions</span>
        <span>{used.toLocaleString()}/{limit.toLocaleString()}</span>
      </div>
      <div className="h-1.5 bg-catalan-border/50 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: barGradient }} />
      </div>
    </button>
  )
}

const TopNav: React.FC<TopNavProps> = ({ title, titleNode, breadcrumbs, rightContent }) => {
  const navigate = useNavigate()
  const [showUserMenu, setShowUserMenu]           = useState(false)
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const user = getStoredUser() || { name: '', role: '' }
  const { resolvedTheme } = useTheme()
  const ts = navThemeStyles(resolvedTheme === 'dark')

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
    <div className="sticky top-0 z-30 backdrop-blur-xl" style={ts.bar}>
      {/* Subtle top accent line */}
      <div className="absolute top-0 left-0 right-0 h-px" style={ts.accent} />

      <div className="flex items-center justify-between h-16 px-6 pl-14 md:pl-6">

        {/* Left: Title/Breadcrumbs */}
        <div className="flex-1">
          {titleNode ? titleNode : breadcrumbs && breadcrumbs.length > 0 ? (
            <div className="flex items-center gap-2 text-sm">
              {breadcrumbs.map((item, i) => (
                <React.Fragment key={i}>
                  {i > 0 && <span className="text-catalan-textMuted/40">/</span>}
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
            <h1 className="text-xl font-bold text-catalan-text tracking-tight">{title}</h1>
          ) : null}
        </div>

        {/* Center: Custom Content */}
        {rightContent && (
          <div className="flex-1 flex justify-center">{rightContent}</div>
        )}

        {/* Right: Usage bar + Bell + User Menu */}
        <div className="flex items-center gap-3">
          <UsageBar />
          <NotificationBell />

          <div className="relative" ref={menuRef}>
            <button
              onClick={() => { setShowUserMenu(v => !v); setShowLogoutConfirm(false) }}
              className="flex items-center gap-3 px-3 py-2 rounded-xl transition-all duration-200 group"
              style={showUserMenu ? ts.userBtnActive : { border: '1px solid transparent' }}
            >
              <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-semibold text-sm transition-transform duration-200 group-hover:scale-105"
                style={{
                  background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                  boxShadow: '0 2px 10px rgba(99,102,241,0.3)',
                }}>
                {user.name?.[0]?.toUpperCase() || 'U'}
              </div>
              <div className="hidden sm:block text-left">
                <p className="text-sm font-medium text-catalan-text leading-tight">{user.name || 'User'}</p>
                <p className="text-[11px] text-catalan-textMuted capitalize leading-tight">{user.role?.replace('_', ' ') || 'user'}</p>
              </div>
              <span className={`text-catalan-textMuted text-xs transition-transform duration-200 ${showUserMenu ? 'rotate-180' : ''}`}>▼</span>
            </button>

            {showUserMenu && (
              <div className="absolute right-0 mt-2 w-56 rounded-2xl shadow-2xl z-50 overflow-hidden backdrop-blur-xl"
                style={ts.dropdown}>
                <div className="px-4 py-3.5" style={ts.userHeader}>
                  <p className="text-sm font-semibold text-catalan-text truncate">{user.name || 'User'}</p>
                  <p className="text-xs text-catalan-textMuted capitalize mt-0.5">{user.role?.replace('_', ' ')}</p>
                </div>

                <div className="py-1">
                  <button onClick={() => { setShowUserMenu(false); navigate('/profile') }}
                    className="w-full text-left px-4 py-2.5 hover:bg-catalan-hover text-sm text-catalan-text transition-colors flex items-center gap-2.5 group">
                    <span className="text-base group-hover:scale-110 inline-block transition-transform"><EmojiIcon e="👤" /></span> My Profile
                  </button>

                  <div className="px-3 py-2"><ThemeToggle /></div>

                  <button onClick={() => { setShowUserMenu(false); navigate('/admin/org') }}
                    className="w-full text-left px-4 py-2.5 hover:bg-catalan-hover text-sm text-catalan-text transition-colors flex items-center gap-2.5 group">
                    <span className="text-base group-hover:scale-110 inline-block transition-transform"><EmojiIcon e="⚙️" /></span> Organization
                  </button>
                </div>

                <div style={{ borderTop: `1px solid ${ts.sep}` }}>
                  {!showLogoutConfirm ? (
                    <button onClick={() => setShowLogoutConfirm(true)}
                      className="w-full text-left px-4 py-2.5 hover:bg-catalan-error/10 text-sm text-catalan-error transition-colors flex items-center gap-2.5 group">
                      <span className="text-base group-hover:scale-110 inline-block transition-transform"><EmojiIcon e="🚪" /></span> Log Out
                    </button>
                  ) : (
                    <div className="px-4 py-3" style={{ background: 'rgba(239,68,68,0.06)' }}>
                      <p className="text-xs text-catalan-text mb-2 font-medium">Are you sure?</p>
                      <div className="flex gap-2">
                        <button onClick={() => { setShowUserMenu(false); setShowLogoutConfirm(false); logout() }}
                          className="flex-1 px-3 py-1.5 text-white text-xs rounded-lg font-medium transition-all hover:opacity-90"
                          style={{ background: 'linear-gradient(135deg, #ef4444, #dc2626)', boxShadow: '0 2px 8px rgba(239,68,68,0.3)' }}>
                          Yes, log out
                        </button>
                        <button onClick={() => setShowLogoutConfirm(false)}
                          className="flex-1 px-3 py-1.5 text-catalan-text text-xs rounded-lg font-medium transition-colors"
                          style={ts.cancelBtn}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default TopNav
