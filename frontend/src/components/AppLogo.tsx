import { useTheme } from '@/lib/ThemeContext'

interface Props {
  size?: number
  className?: string
}

export default function AppLogo({ size = 32, className = '' }: Props) {
  const { resolvedTheme } = useTheme()
  return (
    <img
      src="/logo.png"
      alt="FieldGovern"
      style={{
        width: size,
        height: size,
        objectFit: 'contain',
        flexShrink: 0,
        ...(resolvedTheme === 'dark'
          // Dark bg: white silhouette so the lion is clearly visible
          ? { filter: 'brightness(0) invert(1)' }
          // Light bg: blend removes the white square, gold lion shows through
          : { mixBlendMode: 'multiply' as const }
        ),
      }}
      className={className}
    />
  )
}
