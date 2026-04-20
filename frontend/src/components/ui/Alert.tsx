import React from 'react'

interface AlertProps {
  type?: 'info' | 'success' | 'warning' | 'error'
  title?: string
  message: string
  onClose?: () => void
  className?: string
}

const Alert: React.FC<AlertProps> = ({
  type = 'info',
  title,
  message,
  onClose,
  className = '',
}) => {
  const bgColor = {
    info: 'bg-catalan-info bg-opacity-10 border-catalan-info',
    success: 'bg-catalan-success bg-opacity-10 border-catalan-success',
    warning: 'bg-catalan-warning bg-opacity-10 border-catalan-warning',
    error: 'bg-catalan-error bg-opacity-5 border-catalan-error',
  }

  const textColor = {
    info: 'text-catalan-info',
    success: 'text-catalan-success',
    warning: 'text-catalan-text',   // black in light, white in dark — warning amber is illegible
    error: 'text-catalan-error',
  }

  return (
    <div className={`border-l-4 p-4 rounded-r-md ${bgColor[type]} ${className}`}>
      <div className="flex justify-between items-start">
        <div>
          {title && <h4 className={`font-semibold ${textColor[type]}`}>{title}</h4>}
          <p className={`text-sm mt-1 ${textColor[type]} opacity-90`}>{message}</p>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="text-catalan-textMuted hover:text-catalan-text transition-colors"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  )
}

export default Alert
