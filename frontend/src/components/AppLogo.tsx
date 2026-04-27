interface Props {
  size?: number
  className?: string
  wide?: boolean
}

export default function AppLogo({ size = 32, className = '', wide = false }: Props) {
  if (wide) {
    return (
      <img
        src="/logo-wide.png"
        alt="FieldGovern"
        style={{ height: size, width: 'auto', objectFit: 'contain', flexShrink: 0 }}
        className={className}
      />
    )
  }
  return (
    <img
      src="/logo-icon.png"
      alt="FieldGovern"
      style={{ width: size, height: size, objectFit: 'contain', flexShrink: 0 }}
      className={className}
    />
  )
}
