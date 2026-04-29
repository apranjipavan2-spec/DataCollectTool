import React, { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useHelp } from '@/help/HelpContext'
import AppLogo from '@/components/AppLogo'
import { useLanguage, LANGUAGE_OPTIONS, type AppLanguage } from '@/i18n/LanguageContext'

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

  return (
    <>
      {/* Desktop Sidebar */}
      {/* md (768-1023): collapsed (w-20, icons only) | lg (1024+): expanded (w-64, icons + text) */}
      <div
        className="
          fixed left-0 top-0 h-screen bg-catalan-surface border-r border-catalan-border
          transition-all duration-300 z-40
          hidden md:flex md:flex-col
          md:w-14 lg:w-48
        "
      >
        {/* Header */}
        <div className="h-16 flex items-center px-3 border-b border-catalan-border gap-2.5">
          <AppLogo size={28} className="flex-shrink-0 lg:hidden" />
          <AppLogo wide size={28} className="flex-shrink-0 hidden lg:block" />
        </div>

        {/* Navigation Items */}
        <nav className="flex-1 p-2 space-y-1">
          {items.map((item) => (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={`
                w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200
                md:justify-center lg:justify-start
                ${
                  location.pathname === item.path
                    ? 'bg-catalan-primary text-catalan-bg font-semibold shadow-sm shadow-catalan-primary/20'
                    : 'text-catalan-text hover:bg-catalan-hover'
                }
              `}
              title={item.label}
            >
              <span className="text-base flex-shrink-0">{item.icon}</span>
              <span className="text-sm hidden lg:inline">{item.label}</span>
            </button>
          ))}
        </nav>

        {/* Language picker — dropdown */}
        <div className="px-2 pb-2 border-t border-catalan-border pt-2">
          <select
            value={language}
            onChange={e => setLanguage(e.target.value as AppLanguage)}
            title="Language"
            className="w-full border border-catalan-border rounded-lg px-2 py-1.5 text-xs bg-catalan-bg text-catalan-text focus:outline-none focus:border-catalan-primary transition-colors cursor-pointer"
          >
            {LANGUAGE_OPTIONS.map(opt => (
              <option key={opt.code} value={opt.code}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* Help button */}
        <div className="p-3 border-t border-catalan-border">
          <button
            onClick={togglePanel}
            title="Help & Guide (press ? anytime)"
            className={`
              w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200
              md:justify-center lg:justify-start
              ${isPanelOpen
                ? 'bg-catalan-primary text-white'
                : 'text-catalan-textMuted hover:bg-catalan-hover hover:text-catalan-text'
              }
            `}
          >
            <span className="text-base flex-shrink-0 font-bold">?</span>
            <span className="text-xs hidden lg:inline font-medium">Help & Guide</span>
          </button>
        </div>

        {/* Role Badge */}
        {role && (
          <div className="px-4 pb-4 hidden lg:block">
            <div className="p-3 bg-catalan-hover rounded-lg text-xs text-catalan-textMuted border border-catalan-border">
              <p className="font-semibold text-catalan-text capitalize">{role?.replace('_', ' ')}</p>
              <p className="mt-1">Logged in</p>
            </div>
          </div>
        )}
      </div>

      {/* Mobile Hamburger */}
      {!mobileOpen && (
        <div className="md:hidden fixed top-4 left-4 z-50">
          <button
            onClick={() => setMobileOpen(true)}
            className="p-2.5 bg-catalan-surface border border-catalan-border rounded-lg text-catalan-primary shadow-lg"
          >
            ☰
          </button>
        </div>
      )}

      {/* Mobile Overlay */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/50 z-30 backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile Sidebar */}
      <div
        className={`
          md:hidden fixed left-0 top-0 h-screen w-64 bg-catalan-surface border-r border-catalan-border
          transition-transform duration-300 z-40
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        <div className="h-16 flex items-center justify-between px-4 border-b border-catalan-border">
          <div className="flex items-center gap-2.5">
            <AppLogo size={32} />
            <h1 className="text-base font-bold text-catalan-primary">FieldGovern</h1>
          </div>
          <button
            onClick={() => setMobileOpen(false)}
            className="text-catalan-textMuted hover:text-catalan-text p-1"
          >
            ×
          </button>
        </div>

        <nav className="p-2 space-y-1">
          {items.map((item) => (
            <button
              key={item.path}
              onClick={() => {
                navigate(item.path)
                setMobileOpen(false)
              }}
              className={`
                w-full flex items-center gap-3 px-3 py-1.5 rounded-lg transition-all duration-200
                ${
                  location.pathname === item.path
                    ? 'bg-catalan-primary text-catalan-bg font-semibold'
                    : 'text-catalan-text hover:bg-catalan-hover'
                }
              `}
            >
              <span className="text-base">{item.icon}</span>
              <span className="text-sm">{item.label}</span>
            </button>
          ))}
        </nav>

        {/* Help, Language & Role - Mobile */}
        <div className="absolute bottom-4 left-4 right-4 space-y-2">
          {/* Language dropdown */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-catalan-textMuted flex-shrink-0">🌐</span>
            <select
              value={language}
              onChange={e => setLanguage(e.target.value as AppLanguage)}
              className="flex-1 border border-catalan-border rounded-lg px-2 py-1.5 text-xs bg-catalan-bg text-catalan-text focus:outline-none focus:border-catalan-primary cursor-pointer"
            >
              {LANGUAGE_OPTIONS.map(opt => (
                <option key={opt.code} value={opt.code}>{opt.label}</option>
              ))}
            </select>
          </div>

          <button
            onClick={() => { setMobileOpen(false); togglePanel() }}
            className={`
              w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all text-sm font-medium
              ${isPanelOpen ? 'bg-catalan-primary text-white' : 'bg-catalan-hover text-catalan-textMuted border border-catalan-border hover:text-catalan-text'}
            `}
          >
            <span className="font-bold">?</span>
            <span>Help & Guide</span>
          </button>
          {role && (
            <div className="p-3 bg-catalan-hover rounded-lg text-xs text-catalan-textMuted border border-catalan-border">
              <p className="font-semibold text-catalan-text capitalize">{role?.replace('_', ' ')}</p>
              <p className="mt-1">Logged in</p>
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
