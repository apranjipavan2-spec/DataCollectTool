import React from 'react'

interface FormErrorProps {
  error?: string
  className?: string
}

const FormError: React.FC<FormErrorProps> = ({ error, className = '' }) => {
  if (!error) return null

  return (
    <div className={`text-sm text-catalan-error ${className}`}>
      {error}
    </div>
  )
}

export default FormError
