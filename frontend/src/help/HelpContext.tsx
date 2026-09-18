import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'

interface HelpContextValue {
  isPanelOpen: boolean
  openPanel: (topicId?: string) => void
  closePanel: () => void
  togglePanel: () => void
  activeTopic: string | null
  setActiveTopic: (id: string | null) => void
  spotlightId: string | null
  startSpotlight: (elementId: string) => void
  clearSpotlight: () => void
}

const HelpContext = createContext<HelpContextValue | null>(null)

export function HelpProvider({ children }: { children: React.ReactNode }) {
  const [isPanelOpen, setIsPanelOpen] = useState(false)
  const [activeTopic, setActiveTopic] = useState<string | null>(null)
  const [spotlightId, setSpotlightId] = useState<string | null>(null)

  const openPanel = useCallback((topicId?: string) => {
    setIsPanelOpen(true)
    if (topicId) setActiveTopic(topicId)
  }, [])

  const closePanel = useCallback(() => {
    setIsPanelOpen(false)
    setSpotlightId(null)
  }, [])

  const togglePanel = useCallback(() => {
    setIsPanelOpen(prev => {
      if (prev) setSpotlightId(null)
      return !prev
    })
  }, [])

  const startSpotlight = useCallback((elementId: string) => {
    setSpotlightId(elementId)
  }, [])

  const clearSpotlight = useCallback(() => setSpotlightId(null), [])

  // Keyboard shortcut: ? to toggle panel, Escape to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === '?' || e.key === '/') togglePanel()
      if (e.key === 'Escape') { closePanel(); setSpotlightId(null) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [togglePanel, closePanel])

  return (
    <HelpContext.Provider value={{
      isPanelOpen, openPanel, closePanel, togglePanel,
      activeTopic, setActiveTopic,
      spotlightId, startSpotlight, clearSpotlight,
    }}>
      {children}
    </HelpContext.Provider>
  )
}

export function useHelp() {
  const ctx = useContext(HelpContext)
  if (!ctx) throw new Error('useHelp must be used inside HelpProvider')
  return ctx
}
