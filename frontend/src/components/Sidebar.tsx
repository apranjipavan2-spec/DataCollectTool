import React, { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useHelp } from '@/help/HelpContext'
import AppLogo from '@/components/AppLogo'
import { useLanguage, LANGUAGE_OPTIONS, type AppLanguage } from '@/i18n/LanguageContext'
import { useTheme } from '@/lib/ThemeContext'

interface SidebarItem {
  label: string
  path: string
  icon: string
}

interface SidebarProps {
  items: SidebarItem[]
  role?: string
}

const Sidebar: React.FC<SidebarProps> = ({ items, role }) => {
  const [mobileOpen, setMobileOpen] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const { togglePanel, isPanelOpen } = useHelp()
  const { language, setLanguage } = useLanguage()
  const { resolvedTheme } = useTheme()
  const dark = resolvedTheme === 'dark'

  const glass = {
    bg: dark
      ? 'rgba(15, 15, 25, 0.85)'
      : 'rgba(255, 255, 255, 0.72)',
    border: dark
      ? 'rgba(255, 255, 255, 0.08)'
      : 'rgba(0, 0, 0, 0.06)',
    hover: dark
      ? 'rgba(255, 255, 255, 0.06)'
      : 'rgba(0, 0, 0, 0.04)',
    active: dark
      ? 'rgba(99, 102, 241, 0.15)'
      : 'rgba(99, 102, 241, 0.08)',
    accent: '#6366f1',
  }

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/'
    return location.pathname === path || location.pathname.startsWith(path + '/')
  }

  const navItem = (item: SidebarItem, onClick?: () => void) => {
    const active = isActive(item.path)
    return (
      <button
        key={item.path}
        onClick={() => { navigate(item.path); onClick?.() }}
        className={`
          w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-150
          md:justify-center lg:justify-start relative
          ${active
            ? 'text-indigo-500 dark:text-indigo-400 font-medium'
            : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
          }
        `}
        style={{
          background: active ? glass.active : undefined,
        }}
        onMouseEnter={e => { if (!active) e.currentTarget.style.background = glass.hover }}
        onMouseLeave={e => { if (!active) e.currentTarget.style.background = '' }}
        title={item.label}
      >
        {active && (
          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-r-full"
            style={{ background: glass.accent }} />
        )}
        <span className="text-[15px] flex-shrink-0">{item.icon}</span>
        <span className="text-[13px] hidden lg:inline tracking-wide">{item.label}</span>
      </button>
    )
  }

  return (
    <>
      {/* Desktop Sidebar */}
      <div
        className="fixed left-0 top-0 h-screen backdrop-blur-2xl transition-all duration-300 z-40 hidden md:flex md:flex-col md:w-14 lg:w-48"
        style={{ background: glass.bg, borderRight: `1px solid ${glass.border}` }}
      >
        {/* Header */}
        <div className="h-14 flex items-center px-3 gap-2" style={{ borderBottom: `1px solid ${glass.border}` }}>
          <AppLogo size={24} className="flex-shrink-0 lg:hidden" />
          <AppLogo wide size={24} className="flex-shrink-0 hidden lg:block" />
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-1.5 py-3 space-y-0.5 overflow-y-auto">
          {items.map(item => navItem(item))}
        </nav>

        {/* Language */}
        <div className="px-2 py-2" style={{ borderTop: `1px solid ${glass.border}` }}>
          <select
            value={language}
            onChange={e => setLanguage(e.target.value as AppLanguage)}
            title="Language"
            className="w-full rounded-md px-2 py-1.5 text-xs bg-transparent text-slate-500 dark:text-slate-400 focus:outline-none cursor-pointer appearance-none"
            style={{ border: `1px solid ${glass.border}` }}
          >
            {LANGUAGE_OPTIONS.map(opt => (
              <option key={opt.code} value={opt.code} className="bg-white dark:bg-slate-900">{opt.label}</option>
            ))}
          </select>
        </div>

        {/* Help */}
        <div className="px-1.5 pb-2">
          <button
            onClick={togglePanel}
            title="Help (press ? anytime)"
            className={`
              w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-150
              md:justify-center lg:justify-start text-[13px]
              ${isPanelOpen
                ? 'text-indigo-500 dark:text-indigo-400 font-medium'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
              }
            `}
            style={{ background: isPanelOpen ? glass.active : undefined }}
          >
            <span className="text-[15px] flex-shrink-0">?</span>
            <span className="hidden lg:inline tracking-wide">Help</span>
          </button>
        </div>

        {/* Role */}
        {role && (
          <div className="px-2 pb-3 hidden lg:block">
            <div className="flex items-center gap-2 px-2.5 py-2 rounded-md text-[11px]"
              style={{ background: glass.hover, border: `1px solid ${glass.border}` }}>
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span className="text-slate-600 dark:text-slate-300 font-medium capitalize">{role?.replace('_', ' ')}</span>
            </div>
          </div>
        )}
      </div>

      {/* Mobile Hamburger */}
      {!mobileOpen && (
        <div className="md:hidden fixed top-4 left-4 z-50">
          <button
            onClick={() => setMobileOpen(true)}
            className="w-10 h-10 flex items-center justify-center rounded-xl backdrop-blur-2xl text-slate-600 dark:text-slate-300 shadow-lg"
            style={{ background: glass.bg, border: `1px solid ${glass.border}` }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M3 6h18M3 12h18M3 18h18" />
            </svg>
          </button>
        </div>
      )}

      {/* Mobile Overlay */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/40 z-30 backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile Sidebar */}
      <div
        className={`
          md:hidden fixed left-0 top-0 h-screen w-64 backdrop-blur-2xl
          transition-transform duration-300 z-40
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
        style={{ background: glass.bg, borderRight: `1px solid ${glass.border}` }}
      >
        <div className="h-14 flex items-center justify-between px-4" style={{ borderBottom: `1px solid ${glass.border}` }}>
          <div className="flex items-center gap-2">
            <AppLogo size={28} />
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">FieldGovern</span>
          </div>
          <button
            onClick={() => setMobileOpen(false)}
            className="w-7 h-7 flex items-center justify-center rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <nav className="px-1.5 py-3 space-y-0.5">
          {items.map(item => navItem(item, () => setMobileOpen(false)))}
        </nav>

        {/* Bottom section - Mobile */}
        <div className="absolute bottom-4 left-3 right-3 space-y-2">
          <select
            value={language}
            onChange={e => setLanguage(e.target.value as AppLanguage)}
            className="w-full rounded-md px-2 py-1.5 text-xs bg-transparent text-slate-500 dark:text-slate-400 focus:outline-none cursor-pointer"
            style={{ border: `1px solid ${glass.border}` }}
          >
            {LANGUAGE_OPTIONS.map(opt => (
              <option key={opt.code} value={opt.code} className="bg-white dark:bg-slate-900">{opt.label}</option>
            ))}
          </select>

          <button
            onClick={() => { setMobileOpen(false); togglePanel() }}
            className={`
              w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all text-[13px]
              ${isPanelOpen
                ? 'text-indigo-500 font-medium'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }
            `}
            style={{ background: isPanelOpen ? glass.active : glass.hover }}
          >
            <span>?</span>
            <span>Help</span>
          </button>

          {role && (
            <div className="flex items-center gap-2 px-2.5 py-2 rounded-md text-[11px]"
              style={{ background: glass.hover, border: `1px solid ${glass.border}` }}>
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span className="text-slate-600 dark:text-slate-300 font-medium capitalize">{role?.replace('_', ' ')}</span>
            </div>
          )}
        </div>
      </div>

      {/* Spacer for desktop */}
      <div className="hidden md:block transition-all duration-300 md:w-14 lg:w-48" />
    </>
  )
}

export default Sidebar
