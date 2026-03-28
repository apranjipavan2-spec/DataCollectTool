import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

export type AppLanguage = 'en' | 'hi' | 'kn' | 'te'

export const LANGUAGE_OPTIONS: { code: AppLanguage; label: string }[] = [
  { code: 'en', label: 'EN' },
  { code: 'hi', label: 'HI' },
  { code: 'kn', label: 'KN' },
  { code: 'te', label: 'TE' },
]

interface LanguageContextValue {
  language: AppLanguage
  setLanguage: (lang: AppLanguage) => void
}

const LanguageContext = createContext<LanguageContextValue>({
  language: 'en',
  setLanguage: () => {},
})

const STORAGE_KEY = 'fieldpulse_language'

function loadSaved(): AppLanguage {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved && ['en', 'hi', 'kn', 'te'].includes(saved)) return saved as AppLanguage
  } catch { /* localStorage unavailable */ }
  return 'en'
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<AppLanguage>(loadSaved)

  const setLanguage = useCallback((lang: AppLanguage) => {
    setLanguageState(lang)
    try { localStorage.setItem(STORAGE_KEY, lang) } catch { /* ignore */ }
  }, [])

  return (
    <LanguageContext.Provider value={{ language, setLanguage }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  return useContext(LanguageContext)
}

/**
 * Get a localized value from a form field definition.
 *
 * Supports two patterns form builders may use:
 *   1. Flat keys:   field.label_hi, field.hint_kn, etc.
 *   2. Nested:      field.languages.hi.label, field.languages.hi.hint
 *
 * Falls back to the base key (field[key]) when no translation exists.
 */
export function getLocalizedLabel(
  field: Record<string, unknown>,
  key: string,
  lang: AppLanguage,
): string {
  if (lang === 'en') return (field[key] as string) ?? ''

  // Pattern 1: flat key — e.g. field['label_hi']
  const flatKey = `${key}_${lang}`
  if (typeof field[flatKey] === 'string' && field[flatKey]) return field[flatKey] as string

  // Pattern 2: nested languages map — e.g. field.languages.hi.label
  const langs = field['languages'] as Record<string, Record<string, unknown>> | undefined
  if (langs?.[lang] && typeof langs[lang][key] === 'string' && langs[lang][key]) {
    return langs[lang][key] as string
  }

  // Fallback to English base value
  return (field[key] as string) ?? ''
}
