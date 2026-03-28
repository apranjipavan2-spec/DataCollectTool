import React from 'react'

interface LoadingProps {
  size?: 'sm' | 'md' | 'lg'
  fullScreen?: boolean
  message?: string
}

const Loading: React.FC<LoadingProps> = ({
  size = 'md',
  fullScreen = false,
  message,
}) => {
  const sizeClasses = {
    sm: 'w-6 h-6',
    md: 'w-12 h-12',
    lg: 'w-16 h-16',
  }

  const spinner = (
    <div className={`${sizeClasses[size]} border-4 border-catalan-border border-t-catalan-primary rounded-full animate-spin`} />
  )

  if (fullScreen) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-catalan-surface border border-catalan-border rounded-lg p-8 flex flex-col items-center gap-4">
          {spinner}
          {message && <p className="text-catalan-text">{message}</p>}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center gap-4 py-8">
      {spinner}
      {message && <p className="text-catalan-textMuted">{message}</p>}
    </div>
  )
}

export default Loading
