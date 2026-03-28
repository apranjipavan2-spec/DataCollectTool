import React from 'react'

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string
  subtitle?: string
  children: React.ReactNode
}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ title, subtitle, children, className = '', ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={`card ${className}`}
        {...props}
      >
        {title && (
          <div className="mb-4">
            <h3 className="text-lg font-semibold text-catalan-text">{title}</h3>
            {subtitle && <p className="text-sm text-catalan-textMuted mt-1">{subtitle}</p>}
          </div>
        )}
        {children}
      </div>
    )
  }
)

Card.displayName = 'Card'

export default Card
