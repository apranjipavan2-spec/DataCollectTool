import { useTheme } from '@/lib/ThemeContext'

const modes = [
  { value: 'dark'   as const, icon: '\u{1F319}', label: 'Dark'   },
  { value: 'light'  as const, icon: '\u{2600}\u{FE0F}',  label: 'Light'  },
  { value: 'system' as const, icon: '\u{1F4BB}', label: 'System' },
] as const

export default function ThemeToggle() {
  const { theme, setTheme } = useTheme()

  return (
    <div className="flex items-center gap-1 px-2 py-1.5 bg-catalan-hover/60 rounded-lg">
      {modes.map((m) => (
        <button
          key={m.value}
          onClick={() => setTheme(m.value)}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
            theme === m.value
              ? 'bg-catalan-primary/20 text-catalan-primary'
              : 'text-catalan-textMuted hover:text-catalan-text hover:bg-catalan-hover'
          }`}
          title={`${m.label} theme`}
        >
          <span className="text-sm">{m.icon}</span>
          <span className="hidden sm:inline">{m.label}</span>
        </button>
      ))}
    </div>
  )
}
