import React, { createContext, useCallback, useContext, useState } from 'react'
import { ToastContainer } from '@/components/ui/Toast'

interface ToastItem {
  id: string
  type: 'success' | 'error' | 'info' | 'warning'
  message: string
  duration?: number
}

interface ToastAPI {
  success: (message: string, duration?: number) => void
  error: (message: string, duration?: number) => void
  info: (message: string, duration?: number) => void
  warning: (message: string, duration?: number) => void
}

const ToastContext = createContext<ToastAPI | null>(null)

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const add = useCallback((type: ToastItem['type'], message: string, duration = 4000) => {
    const id = `toast-${Date.now()}-${Math.random()}`
    setToasts(prev => [...prev, { id, type, message, duration }])
  }, [])

  const api: ToastAPI = {
    success: (msg, dur) => add('success', msg, dur),
    error: (msg, dur) => add('error', msg, dur),
    info: (msg, dur) => add('info', msg, dur),
    warning: (msg, dur) => add('warning', msg, dur),
  }

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastContainer toasts={toasts.map(t => ({ ...t, onClose: dismiss }))} onClose={dismiss} />
    </ToastContext.Provider>
  )
}

export function useToast(): ToastAPI {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside ToastProvider')
  return ctx
}
