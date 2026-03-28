import React, { useEffect } from 'react'

interface ToastProps {
  id: string
  type?: 'success' | 'error' | 'info' | 'warning'
  message: string
  duration?: number
  onClose: (id: string) => void
}

const Toast: React.FC<ToastProps> = ({
  id,
  type = 'info',
  message,
  duration = 4000,
  onClose,
}) => {
  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(() => onClose(id), duration)
      return () => clearTimeout(timer)
    }
  }, [id, duration, onClose])

  const bgColor = {
    success: 'bg-catalan-success text-white',
    error: 'bg-catalan-error text-white',
    info: 'bg-catalan-info text-catalan-bg',
    warning: 'bg-catalan-warning text-catalan-bg',
  }

  const icon = {
    success: '✓',
    error: '✕',
    info: 'ℹ',
    warning: '⚠',
  }

  return (
    <div
      className={`
        ${bgColor[type]}
        px-4 py-3 rounded-lg shadow-lg
        flex items-center gap-3
        animate-fade-in
      `}
    >
      <span className="text-lg font-bold">{icon[type]}</span>
      <span className="text-sm">{message}</span>
      <button
        onClick={() => onClose(id)}
        className="ml-auto opacity-70 hover:opacity-100 transition-opacity"
      >
        ×
      </button>
    </div>
  )
}

// Toast Container component
interface ToastContainerProps {
  toasts: ToastProps[]
  onClose: (id: string) => void
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onClose }) => {
  return (
    <div className="fixed bottom-4 right-4 space-y-2 z-40 max-w-sm">
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          {...toast}
          onClose={onClose}
        />
      ))}
    </div>
  )
}

export default Toast
