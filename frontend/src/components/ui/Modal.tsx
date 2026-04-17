import React, { useEffect } from 'react'
import Button from './Button'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
  footer?: React.ReactNode
  size?: 'sm' | 'md' | 'lg'
}

const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
  footer,
  size = 'md',
}) => {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
      const handleEscape = (e: KeyboardEvent) => {
        if (e.key === 'Escape') onClose()
      }
      document.addEventListener('keydown', handleEscape)
      return () => {
        document.removeEventListener('keydown', handleEscape)
        document.body.style.overflow = 'unset'
      }
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  const desktopMax = { sm: 'sm:max-w-sm', md: 'sm:max-w-md', lg: 'sm:max-w-2xl' }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 backdrop-blur-sm">
      <div
        className={`
          bg-catalan-surface border border-catalan-border shadow-2xl
          w-full ${desktopMax[size]}
          rounded-t-2xl sm:rounded-xl
          max-h-[92dvh] sm:max-h-[90vh]
          flex flex-col
          sm:mx-4
        `}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drag handle — mobile only */}
        <div className="flex justify-center pt-3 pb-1 sm:hidden flex-shrink-0">
          <div className="w-10 h-1 rounded-full bg-catalan-border" />
        </div>

        {title && (
          <div className="border-b border-catalan-border px-5 py-3.5 flex justify-between items-center flex-shrink-0">
            <h2 className="text-base font-semibold text-catalan-text">{title}</h2>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-catalan-textMuted hover:text-catalan-text hover:bg-catalan-hover transition-colors text-xl leading-none"
            >
              ×
            </button>
          </div>
        )}

        <div className="px-5 py-4 overflow-y-auto flex-1">
          {children}
        </div>

        {footer && (
          <div className="border-t border-catalan-border px-5 py-3 flex justify-end gap-2 flex-shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

export default Modal
