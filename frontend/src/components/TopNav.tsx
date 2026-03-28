import React, { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { getStoredUser, logout } from '@/lib/api'
import ThemeToggle from '@/components/ThemeToggle'

interface TopNavProps {
  title?: string
  breadcrumbs?: { label: string; path?: string }[]
  rightContent?: React.ReactNode
}

const TopNav: React.FC<TopNavProps> = ({ title, breadcrumbs, rightContent }) => {
  const navigate = useNavigate()
  const [showUserMenu, setShowUserMenu]           = useState(false)
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const user = getStoredUser() || { name: '', role: '' }

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false)
        setShowLogoutConfirm(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Close dropdown on Escape
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
                  {item.path ? (
                    <button
                      onClick={() => navigate(item.path!)}
                      className="text-catalan-primary hover:text-catalan-primaryLight transition-colors"
                    >
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
          <div className="flex-1 flex justify-center">
            {rightContent}
          </div>
        )}

        {/* Right: User Menu */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => { setShowUserMenu(v => !v); setShowLogoutConfirm(false) }}
            className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-catalan-hover transition-colors"
          >
            <div className="w-8 h-8 rounded-full bg-catalan-primary flex items-center justify-center text-catalan-bg font-semibold text-sm">
              {user.name?.[0]?.toUpperCase() || 'U'}
            </div>
            <div className="hidden sm:block text-sm">
              <p className="font-medium text-catalan-text">{user.name || 'User'}</p>
              <p className="text-xs text-catalan-textMuted capitalize">{user.role?.replace('_', ' ') || 'user'}</p>
            </div>
            <span className={`text-catalan-textMuted text-xs transition-transform duration-200 ${showUserMenu ? 'rotate-180' : ''}`}>▼</span>
          </button>

          {/* Dropdown */}
          {showUserMenu && (
            <div className="absolute right-0 mt-2 w-52 bg-catalan-surface border border-catalan-border rounded-xl shadow-xl z-50 overflow-hidden">
              {/* User info header */}
              <div className="px-4 py-3 border-b border-catalan-border bg-catalan-hover/50">
                <p className="text-sm font-medium text-catalan-text truncate">{user.name || 'User'}</p>
                <p className="text-xs text-catalan-textMuted capitalize">{user.role?.replace('_', ' ')}</p>
              </div>

              <button
                onClick={() => { setShowUserMenu(false); navigate('/profile') }}
                className="w-full text-left px-4 py-2.5 hover:bg-catalan-hover text-sm text-catalan-text transition-colors flex items-center gap-2.5"
              >
                <span className="text-base">👤</span> My Profile
              </button>

              {/* Theme toggle */}
              <div className="px-3 py-2">
                <ThemeToggle />
              </div>

              <button
                onClick={() => { setShowUserMenu(false); navigate('/admin/org') }}
                className="w-full text-left px-4 py-2.5 hover:bg-catalan-hover text-sm text-catalan-text transition-colors flex items-center gap-2.5"
              >
                <span className="text-base">⚙️</span> Organization
              </button>

              <div className="border-t border-catalan-border" />

              {/* Logout — two-step confirmation */}
              {!showLogoutConfirm ? (
                <button
                  onClick={() => setShowLogoutConfirm(true)}
                  className="w-full text-left px-4 py-2.5 hover:bg-catalan-error/10 text-sm text-catalan-error transition-colors flex items-center gap-2.5"
                >
                  <span className="text-base">🚪</span> Log Out
                </button>
              ) : (
                <div className="px-4 py-3 bg-catalan-error/5">
                  <p className="text-xs text-catalan-text mb-2 font-medium">Are you sure?</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setShowUserMenu(false); setShowLogoutConfirm(false); logout() }}
                      className="flex-1 px-3 py-1.5 bg-catalan-error text-white text-xs rounded-lg font-medium hover:bg-catalan-error/80 transition-colors"
                    >
                      Yes, log out
                    </button>
                    <button
                      onClick={() => setShowLogoutConfirm(false)}
                      className="flex-1 px-3 py-1.5 bg-catalan-hover text-catalan-text text-xs rounded-lg font-medium hover:bg-catalan-border transition-colors"
                    >
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
  )
}

export default TopNav
