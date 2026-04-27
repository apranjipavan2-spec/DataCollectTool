import { useTheme } from '@/lib/ThemeContext'

interface Props {
  size?: number
  className?: string
}

export default function AppLogo({ size = 32, className = '' }: Props) {
  return (
    <img
      src="/logo-icon.png"
      alt="FieldGovern"
      style={{ width: size, height: size, objectFit: 'contain', flexShrink: 0 }}
      className={className}
    />
  )
}
