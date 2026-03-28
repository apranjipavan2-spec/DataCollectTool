import React, { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'

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

  return (
    <>
      {/* Desktop Sidebar */}
      {/* md (768-1023): collapsed (w-20, icons only) | lg (1024+): expanded (w-64, icons + text) */}
      <div
        className="
          fixed left-0 top-0 h-screen bg-catalan-surface border-r border-catalan-border
          transition-all duration-300 z-40
          hidden md:flex md:flex-col
          md:w-20 lg:w-64
        "
      >
        {/* Header */}
        <div className="h-16 flex items-center justify-between px-4 border-b border-catalan-border">
          <h1 className="text-xl font-bold text-catalan-primary hidden lg:block">FieldPulse</h1>
          <span className="text-xl font-bold text-catalan-primary lg:hidden">FP</span>
        </div>

        {/* Navigation Items */}
        <nav className="flex-1 p-4 space-y-1">
          {items.map((item) => (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={`
                w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200
                md:justify-center lg:justify-start
                ${
                  location.pathname === item.path
                    ? 'bg-catalan-primary text-catalan-bg font-semibold shadow-sm shadow-catalan-primary/20'
                    : 'text-catalan-text hover:bg-catalan-hover'
                }
              `}
              title={item.label}
            >
              <span className="text-lg flex-shrink-0">{item.icon}</span>
              <span className="text-sm hidden lg:inline">{item.label}</span>
            </button>
          ))}
        </nav>

        {/* Role Badge */}
        {role && (
          <div className="p-4 border-t border-catalan-border hidden lg:block">
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
          <h1 className="text-xl font-bold text-catalan-primary">FieldPulse</h1>
          <button
            onClick={() => setMobileOpen(false)}
            className="text-catalan-textMuted hover:text-catalan-text p-1"
          >
            ×
          </button>
        </div>

        <nav className="p-4 space-y-1">
          {items.map((item) => (
            <button
              key={item.path}
              onClick={() => {
                navigate(item.path)
                setMobileOpen(false)
              }}
              className={`
                w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200
                ${
                  location.pathname === item.path
                    ? 'bg-catalan-primary text-catalan-bg font-semibold'
                    : 'text-catalan-text hover:bg-catalan-hover'
                }
              `}
            >
              <span className="text-lg">{item.icon}</span>
              <span className="text-sm">{item.label}</span>
            </button>
          ))}
        </nav>

        {/* Role Badge - Mobile */}
        {role && (
          <div className="absolute bottom-4 left-4 right-4">
            <div className="p-3 bg-catalan-hover rounded-lg text-xs text-catalan-textMuted border border-catalan-border">
              <p className="font-semibold text-catalan-text capitalize">{role?.replace('_', ' ')}</p>
              <p className="mt-1">Logged in</p>
            </div>
          </div>
        )}
      </div>

      {/* Spacer for desktop */}
      <div className="hidden md:block transition-all duration-300 md:w-20 lg:w-64" />
    </>
  )
}

export default Sidebar
