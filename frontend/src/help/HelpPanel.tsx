/**
 * HelpPanel — slide-out help panel from the right side.
 * Opened via sidebar button, keyboard shortcut (?), or InfoButton "Full guide →".
 * Shows all help topics organized by section. Each topic has a "Highlight" button
 * that spotlights the relevant element in the app.
 */
import { useState, useEffect, useRef } from 'react'
import { useHelp } from './HelpContext'
import { getSectionsForRole, type HelpTopic, type HelpSection } from './helpContent'
import { getStoredUser } from '@/lib/api'
import EmojiIcon from '@/components/EmojiIcon'

function TopicCard({ topic, isActive, onClick, onHighlight }: {
  topic: HelpTopic
  isActive: boolean
  onClick: () => void
  onHighlight: () => void
}) {
  return (
    <div
      className={`
        rounded-xl border transition-all duration-200 overflow-hidden
        ${isActive
          ? 'border-catalan-primary bg-catalan-primary/5 shadow-sm'
          : 'border-catalan-border bg-catalan-surface hover:border-catalan-primary/40 hover:shadow-sm cursor-pointer'
        }
      `}
    >
      {/* Header — always visible */}
      <button
        className="w-full text-left px-4 py-3 flex items-center justify-between gap-2"
        onClick={onClick}
        type="button"
      >
        <span className={`text-sm font-semibold leading-tight ${isActive ? 'text-catalan-primary' : 'text-catalan-text'}`}>
          {topic.title}
        </span>
        <span className="text-catalan-textMuted text-xs flex-shrink-0 transition-transform duration-200"
          style={{ transform: isActive ? 'rotate(180deg)' : 'rotate(0deg)' }}>
          ▾
        </span>
      </button>

      {/* Expanded content */}
      {isActive && (
        <div className="px-4 pb-4 border-t border-catalan-border/50 pt-3">
          <p className="text-xs text-catalan-textMuted mb-3 leading-relaxed">{topic.description}</p>

          <ol className="space-y-2 mb-3">
            {topic.steps.map((step, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="text-base flex-shrink-0 leading-none mt-0.5">{step.icon}</span>
                <span className="text-xs text-catalan-text leading-relaxed">{step.text}</span>
              </li>
            ))}
          </ol>

          {topic.elementId && (
            <button
              onClick={(e) => { e.stopPropagation(); onHighlight() }}
              className="
                flex items-center gap-1.5 text-xs font-semibold
                text-catalan-primary border border-catalan-primary/30
                rounded-lg px-3 py-1.5 w-full justify-center
                hover:bg-catalan-primary hover:text-white
                transition-all duration-150
              "
              type="button"
            >
              <span><EmojiIcon e="🎯" /></span> Highlight in app
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function SectionBlock({ section, activeTopicId, onTopicClick, onHighlight }: {
  section: HelpSection
  activeTopicId: string | null
  onTopicClick: (id: string) => void
  onHighlight: (elementId: string) => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  return (
    <div className="mb-5">
      <button
        className="flex items-center gap-2 mb-2 w-full text-left group"
        onClick={() => setCollapsed(v => !v)}
        type="button"
      >
        <span className="text-base">{section.icon}</span>
        <span className="text-xs font-bold text-catalan-textMuted uppercase tracking-wider group-hover:text-catalan-text transition-colors">
          {section.title}
        </span>
        <span className="text-catalan-textMuted text-xs ml-auto transition-transform duration-200"
          style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>▾</span>
      </button>

      {!collapsed && (
        <div className="space-y-2 pl-1">
          {section.topics.map(topic => (
            <TopicCard
              key={topic.id}
              topic={topic}
              isActive={activeTopicId === topic.id}
              onClick={() => onTopicClick(topic.id)}
              onHighlight={() => topic.elementId && onHighlight(topic.elementId)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default function HelpPanel() {
  const { isPanelOpen, closePanel, activeTopic, setActiveTopic, startSpotlight } = useHelp()
  const user = getStoredUser()
  const role = user?.role || 'enumerator'
  const sections = getSectionsForRole(role)
  const [search, setSearch] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)

  // Filter by search
  const filteredSections = search.trim()
    ? sections.map(sec => ({
        ...sec,
        topics: sec.topics.filter(t =>
          t.title.toLowerCase().includes(search.toLowerCase()) ||
          t.description.toLowerCase().includes(search.toLowerCase()) ||
          t.steps.some(s => s.text.toLowerCase().includes(search.toLowerCase()))
        ),
      })).filter(s => s.topics.length > 0)
    : sections

  const handleTopicClick = (id: string) => {
    setActiveTopic(activeTopic === id ? null : id)
  }

  const handleHighlight = (elementId: string) => {
    startSpotlight(elementId)
    closePanel()
  }

  // Trap scroll inside panel
  useEffect(() => {
    if (!isPanelOpen) return
    const el = panelRef.current
    if (!el) return
    const prevent = (e: WheelEvent) => e.stopPropagation()
    el.addEventListener('wheel', prevent, { passive: true })
    return () => el.removeEventListener('wheel', prevent)
  }, [isPanelOpen])

  if (!isPanelOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[150] bg-black/20 backdrop-blur-[1px]"
        onClick={closePanel}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        className="
          fixed right-0 top-0 h-full z-[160]
          w-full sm:w-[400px]
          bg-catalan-bg border-l border-catalan-border
          shadow-2xl flex flex-col
          animate-slide-in-right
        "
        style={{ animation: 'helpPanelSlide 0.25s cubic-bezier(.16,1,.3,1) forwards' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-catalan-border bg-catalan-surface">
          <div className="w-8 h-8 rounded-lg bg-catalan-primary/10 flex items-center justify-center text-catalan-primary font-bold text-sm">?</div>
          <div className="flex-1">
            <h2 className="font-bold text-catalan-text text-sm">Help & Guide</h2>
            <p className="text-xs text-catalan-textMuted">Press <kbd className="px-1 py-0.5 bg-catalan-hover rounded text-xs border border-catalan-border">?</kbd> to toggle</p>
          </div>
          <button
            onClick={closePanel}
            className="text-catalan-textMuted hover:text-catalan-text transition-colors text-xl leading-none p-1 rounded hover:bg-catalan-hover"
            aria-label="Close help panel"
          >
            ×
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-3 border-b border-catalan-border">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-catalan-textMuted text-sm"><EmojiIcon e="🔍" /></span>
            <input
              type="search"
              placeholder="Search help topics…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="
                w-full pl-9 pr-3 py-2 text-sm rounded-lg
                border border-catalan-border bg-catalan-surface
                text-catalan-text placeholder:text-catalan-textMuted
                focus:outline-none focus:border-catalan-primary focus:ring-1 focus:ring-catalan-primary/30
              "
              autoFocus
            />
          </div>
        </div>

        {/* Topics */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {filteredSections.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-4xl mb-3"><EmojiIcon e="🔍" /></p>
              <p className="text-sm text-catalan-textMuted">No help topics match "{search}"</p>
              <button onClick={() => setSearch('')} className="mt-2 text-xs text-catalan-primary hover:underline">Clear search</button>
            </div>
          ) : (
            filteredSections.map(section => (
              <SectionBlock
                key={section.id}
                section={section}
                activeTopicId={activeTopic}
                onTopicClick={handleTopicClick}
                onHighlight={handleHighlight}
              />
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-catalan-border bg-catalan-surface">
          <p className="text-xs text-catalan-textMuted text-center">
            Click <span className="font-semibold text-catalan-primary"><EmojiIcon e="🎯" /> Highlight in app</span> on any topic to see it in action
          </p>
        </div>
      </div>

      <style>{`
        @keyframes helpPanelSlide {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `}</style>
    </>
  )
}
