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

function themeStyles(dark: boolean) {
  const sep = dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)'
  const glassHover = dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)'
  return {
    sidebar: {
      background: dark
        ? 'linear-gradient(180deg, rgba(30,30,46,0.97) 0%, rgba(17,17,27,0.99) 100%)'
        : 'linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(245,245,249,0.99) 100%)',
      borderRight: `1px solid ${sep}`,
    },
    sep: { borderBottom: `1px solid ${sep}` },
    sepTop: { borderTop: `1px solid ${sep}` },
    sepBorder: `1px solid ${sep}`,
    glow1: {
      background: `radial-gradient(ellipse at 50% 0%, rgba(99,102,241,${dark ? 0.08 : 0.06}) 0%, transparent 70%)`,
    },
    glow2: {
      background: `radial-gradient(ellipse at 50% 100%, rgba(139,92,246,${dark ? 0.05 : 0.03}) 0%, transparent 70%)`,
    },
    glassHover: { background: `linear-gradient(135deg, ${glassHover}, transparent)` },
    helpBg: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
    roleBadge: {
      background: `linear-gradient(135deg, rgba(99,102,241,${dark ? 0.08 : 0.06}) 0%, rgba(139,92,246,${dark ? 0.04 : 0.03}) 100%)`,
      border: `1px solid ${sep}`,
    },
    hamburger: {
      background: dark
        ? 'linear-gradient(135deg, rgba(30,30,46,0.95), rgba(17,17,27,0.95))'
        : 'linear-gradient(135deg, rgba(255,255,255,0.95), rgba(245,245,249,0.95))',
      border: `1px solid ${dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
      boxShadow: `0 4px 20px rgba(0,0,0,${dark ? 0.3 : 0.1})`,
    },
    closeBtn: { background: dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' },
    mobileBtnInactive: {
      background: dark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
      border: `1px solid ${sep}`,
    },
  }
}

const activeItemStyle = {
  background: 'linear-gradient(135deg, rgba(99,102,241,0.9) 0%, rgba(139,92,246,0.85) 100%)',
  boxShadow: '0 4px 15px rgba(99,102,241,0.3), inset 0 1px 0 rgba(255,255,255,0.15)',
}

const Sidebar: React.FC<SidebarProps> = ({ items, role }) => {
  const [mobileOpen, setMobileOpen] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const { togglePanel, isPanelOpen } = useHelp()
  const { language, setLanguage } = useLanguage()
  const { resolvedTheme } = useTheme()
  const dark = resolvedTheme === 'dark'
  const ts = themeStyles(dark)

  const isActive = (path: string) => location.pathname === path

  const navButton = (item: SidebarItem, onClick?: () => void) => {
    const active = isActive(item.path)
    return (
      <button
        key={item.path}
        onClick={() => { navigate(item.path); onClick?.() }}
        className={`
          group w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-250
          md:justify-center lg:justify-start relative overflow-hidden
          ${active ? 'text-white font-semibold' : 'text-catalan-textMuted hover:text-catalan-text'}
        `}
        style={active ? activeItemStyle : undefined}
        title={item.label}
      >
        {!active && (
          <div className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-200"
            style={ts.glassHover} />
        )}
        <span className={`text-base flex-shrink-0 relative z-10 transition-transform duration-200 ${active ? 'scale-110' : 'group-hover:scale-105'}`}>
          {item.icon}
        </span>
        <span className="text-sm hidden lg:inline relative z-10">{item.label}</span>
        {active && (
          <div className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-5 rounded-l-full bg-white/40 hidden lg:block" />
        )}
      </button>
    )
  }

  return (
    <>
      {/* Desktop Sidebar */}
      <div
        className="fixed left-0 top-0 h-screen backdrop-blur-xl transition-all duration-300 z-40 hidden md:flex md:flex-col md:w-14 lg:w-52"
        style={ts.sidebar}
      >
        <div className="absolute top-0 left-0 w-full h-32 pointer-events-none" style={ts.glow1} />
        <div className="absolute bottom-0 left-0 w-full h-24 pointer-events-none" style={ts.glow2} />

        {/* Header */}
        <div className="h-16 flex items-center px-3 gap-2.5 relative" style={ts.sep}>
          <AppLogo size={28} className="flex-shrink-0 lg:hidden" />
          <AppLogo wide size={28} className="flex-shrink-0 hidden lg:block" />
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-2 space-y-1 relative z-10 overflow-y-auto">
          {items.map(item => navButton(item))}
        </nav>

        {/* Language picker */}
        <div className="px-2 pb-2 pt-2 relative z-10" style={ts.sepTop}>
          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs pointer-events-none">🌐</span>
            <select
              value={language}
              onChange={e => setLanguage(e.target.value as AppLanguage)}
              title="Language"
              className="w-full rounded-lg pl-7 pr-2 py-1.5 text-xs bg-transparent text-catalan-textMuted focus:outline-none focus:text-catalan-text transition-colors cursor-pointer appearance-none"
              style={{ border: ts.sepBorder }}
            >
              {LANGUAGE_OPTIONS.map(opt => (
                <option key={opt.code} value={opt.code} className="bg-catalan-surface">{opt.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Help button */}
        <div className="px-2 pb-2 relative z-10">
          <button
            onClick={togglePanel}
            title="Help & Guide (press ? anytime)"
            className={`
              w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200
              md:justify-center lg:justify-start
              ${isPanelOpen ? 'text-white font-semibold' : 'text-catalan-textMuted hover:text-catalan-text'}
            `}
            style={isPanelOpen ? {
              background: 'linear-gradient(135deg, rgba(99,102,241,0.7), rgba(139,92,246,0.6))',
              boxShadow: '0 2px 10px rgba(99,102,241,0.2)',
            } : undefined}
          >
            <span className="w-5 h-5 rounded-md flex items-center justify-center text-xs font-bold flex-shrink-0"
              style={{ background: isPanelOpen ? 'rgba(255,255,255,0.2)' : ts.helpBg }}>
              ?
            </span>
            <span className="text-xs hidden lg:inline font-medium">Help & Guide</span>
          </button>
        </div>

        {/* Role Badge */}
        {role && (
          <div className="px-3 pb-4 hidden lg:block relative z-10">
            <div className="p-3 rounded-xl text-xs" style={ts.roleBadge}>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <p className="font-semibold text-catalan-text capitalize">{role?.replace('_', ' ')}</p>
              </div>
              <p className="mt-1 text-catalan-textMuted ml-4">Online</p>
            </div>
          </div>
        )}
      </div>

      {/* Mobile Hamburger */}
      {!mobileOpen && (
        <div className="md:hidden fixed top-4 left-4 z-50">
          <button
            onClick={() => setMobileOpen(true)}
            className="p-2.5 rounded-xl text-catalan-primary shadow-lg backdrop-blur-xl"
            style={ts.hamburger}
          >
            ☰
          </button>
        </div>
      )}

      {/* Mobile Overlay */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/60 z-30 backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile Sidebar */}
      <div
        className={`
          md:hidden fixed left-0 top-0 h-screen w-64 backdrop-blur-xl
          transition-transform duration-300 z-40
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
        style={ts.sidebar}
      >
        <div className="absolute top-0 left-0 w-full h-32 pointer-events-none" style={ts.glow1} />

        <div className="h-16 flex items-center justify-between px-4" style={ts.sep}>
          <div className="flex items-center gap-2.5">
            <AppLogo size={32} />
            <h1 className="text-base font-bold text-catalan-primary">FieldGovern</h1>
          </div>
          <button
            onClick={() => setMobileOpen(false)}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-catalan-textMuted hover:text-catalan-text transition-colors"
            style={ts.closeBtn}
          >
            ×
          </button>
        </div>

        <nav className="p-2 space-y-1 relative z-10">
          {items.map(item => navButton(item, () => setMobileOpen(false)))}
        </nav>

        {/* Help, Language & Role - Mobile */}
        <div className="absolute bottom-4 left-3 right-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-catalan-textMuted flex-shrink-0">🌐</span>
            <select
              value={language}
              onChange={e => setLanguage(e.target.value as AppLanguage)}
              className="flex-1 rounded-lg px-2 py-1.5 text-xs bg-transparent text-catalan-textMuted focus:outline-none cursor-pointer"
              style={{ border: ts.sepBorder }}
            >
              {LANGUAGE_OPTIONS.map(opt => (
                <option key={opt.code} value={opt.code} className="bg-catalan-surface">{opt.label}</option>
              ))}
            </select>
          </div>

          <button
            onClick={() => { setMobileOpen(false); togglePanel() }}
            className={`
              w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-sm font-medium
              ${isPanelOpen ? 'text-white' : 'text-catalan-textMuted hover:text-catalan-text'}
            `}
            style={isPanelOpen ? {
              background: 'linear-gradient(135deg, rgba(99,102,241,0.7), rgba(139,92,246,0.6))',
            } : ts.mobileBtnInactive}
          >
            <span className="font-bold">?</span>
            <span>Help & Guide</span>
          </button>
          {role && (
            <div className="p-3 rounded-xl text-xs" style={ts.roleBadge}>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <p className="font-semibold text-catalan-text capitalize">{role?.replace('_', ' ')}</p>
              </div>
              <p className="mt-1 text-catalan-textMuted ml-4">Online</p>
            </div>
          )}
        </div>
      </div>

      {/* Spacer for desktop */}
      <div className="hidden md:block transition-all duration-300 md:w-14 lg:w-52" />
    </>
  )
}

export default Sidebar
