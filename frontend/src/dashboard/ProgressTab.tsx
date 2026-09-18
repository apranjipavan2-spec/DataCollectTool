import { useState, useEffect } from 'react'
import api from '@/lib/api'
import { Card } from '@/components/ui'
import { useToast } from '@/lib/ToastContext'

interface Form { id: string; title: string }

interface DailyProgress {
  date: string
  total: number
  by_enumerator: { user_id: string; name: string; count: number }[]
  roster_targets: Record<string, number>
}

interface Trend {
  dates: string[]
  counts: number[]
}

export default function ProgressTab({ forms }: { forms: Form[] }) {
  const toast = useToast()
  const today = new Date().toISOString().slice(0, 10)
  const [selectedForm, setSelectedForm] = useState('')
  const [selectedDate, setSelectedDate] = useState(today)
  const [progress, setProgress] = useState<DailyProgress | null>(null)
  const [trend, setTrend] = useState<Trend | null>(null)
  const [loadingProgress, setLoadingProgress] = useState(false)
  const [loadingTrend, setLoadingTrend] = useState(false)

  const loadProgress = async () => {
    if (!selectedForm) return
    setLoadingProgress(true)
    try {
      const { data } = await api.get('/analytics/daily-progress', {
        params: { form_id: selectedForm, date: selectedDate },
      })
      setProgress(data)
    } catch {
      toast.error('Failed to load progress data')
    } finally {
      setLoadingProgress(false)
    }
  }

  const loadTrend = async () => {
    if (!selectedForm) return
    setLoadingTrend(true)
    try {
      const { data } = await api.get('/analytics/trend', {
        params: { form_id: selectedForm, days: 7 },
      })
      setTrend(data)
    } catch {
      toast.error('Failed to load trend data')
    } finally {
      setLoadingTrend(false)
    }
  }

  useEffect(() => {
    if (selectedForm) {
      loadProgress()
      loadTrend()
    }
  }, [selectedForm, selectedDate])

  const maxCount = trend ? Math.max(...trend.counts, 1) : 1
  const SVG_W = 600
  const SVG_H = 200
  const PAD_LEFT = 30
  const PAD_RIGHT = 10
  const PAD_TOP = 10
  const PAD_BOT = 30

  const trendPoints = trend
    ? trend.dates.map((_, i) => {
        const x = PAD_LEFT + (i / Math.max(trend.dates.length - 1, 1)) * (SVG_W - PAD_LEFT - PAD_RIGHT)
        const y = PAD_TOP + (1 - trend.counts[i] / maxCount) * (SVG_H - PAD_TOP - PAD_BOT)
        return `${x},${y}`
      }).join(' ')
    : ''

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap gap-3 items-end mb-4">
          <div>
            <label className="text-xs text-catalan-textMuted block mb-1">Form</label>
            <select
              value={selectedForm}
              onChange={e => setSelectedForm(e.target.value)}
              className="bg-catalan-hover border border-catalan-border rounded-lg px-3 py-2 text-sm text-catalan-text focus:outline-none focus:border-catalan-primary"
            >
              <option value="">Select form…</option>
              {forms.map(f => <option key={f.id} value={f.id}>{f.title}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-catalan-textMuted block mb-1">Date</label>
            <input
              type="date"
              value={selectedDate}
              onChange={e => setSelectedDate(e.target.value)}
              className="bg-catalan-hover border border-catalan-border rounded-lg px-3 py-2 text-sm text-catalan-text focus:outline-none focus:border-catalan-primary"
            />
          </div>
        </div>

        {!selectedForm && (
          <p className="text-sm text-catalan-textMuted text-center py-8">Select a form to view progress</p>
        )}

        {selectedForm && loadingProgress && (
          <div className="text-sm text-catalan-textMuted text-center py-8 animate-pulse">Loading…</div>
        )}

        {selectedForm && progress && !loadingProgress && (
          <div className="space-y-4">
            <div className="flex items-center gap-4 p-4 bg-catalan-hover rounded-lg">
              <div>
                <div className="text-3xl font-bold text-catalan-primary">{progress.total}</div>
                <div className="text-xs text-catalan-textMuted mt-0.5">Total submissions on {progress.date}</div>
              </div>
            </div>

            {progress.by_enumerator.length > 0 && (
              <div className="space-y-3">
                <div className="text-xs font-medium text-catalan-textMuted uppercase tracking-wider">Per Enumerator</div>
                {progress.by_enumerator.map(e => {
                  const target = progress.roster_targets[e.user_id]
                  const pct = target ? Math.min(100, Math.round((e.count / target) * 100)) : null
                  return (
                    <div key={e.user_id}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm text-catalan-text">{e.name}</span>
                        <span className="text-sm font-medium text-catalan-text">
                          {e.count}{target ? ` / ${target}` : ''}
                          {pct !== null && <span className="text-xs text-catalan-textMuted ml-1">({pct}%)</span>}
                        </span>
                      </div>
                      {pct !== null && (
                        <div className="h-2 bg-catalan-hover rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${pct >= 100 ? 'bg-catalan-success' : pct >= 50 ? 'bg-catalan-primary' : 'bg-catalan-warning'}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {progress.by_enumerator.length === 0 && (
              <p className="text-sm text-catalan-textMuted text-center py-4">No submissions on this date</p>
            )}
          </div>
        )}
      </Card>

      {selectedForm && (
        <Card title="7-Day Trend">
          {loadingTrend ? (
            <div className="text-sm text-catalan-textMuted text-center py-8 animate-pulse">Loading…</div>
          ) : trend && trend.counts.some(c => c > 0) ? (
            <div className="overflow-x-auto">
              <svg
                viewBox={`0 0 ${SVG_W} ${SVG_H}`}
                className="w-full"
                style={{ height: 200 }}
              >
                {[0, 0.25, 0.5, 0.75, 1].map(pct => {
                  const y = PAD_TOP + pct * (SVG_H - PAD_TOP - PAD_BOT)
                  const val = Math.round(maxCount * (1 - pct))
                  return (
                    <g key={pct}>
                      <line x1={PAD_LEFT} y1={y} x2={SVG_W - PAD_RIGHT} y2={y} stroke="currentColor" strokeOpacity={0.08} strokeWidth={1} />
                      <text x={PAD_LEFT - 4} y={y + 4} fontSize={9} textAnchor="end" fill="currentColor" opacity={0.4}>{val}</text>
                    </g>
                  )
                })}
                <polyline
                  points={trendPoints}
                  fill="none"
                  stroke="var(--catalan-primary, #0ea5e9)"
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                {trend.dates.map((d, i) => {
                  const x = PAD_LEFT + (i / Math.max(trend.dates.length - 1, 1)) * (SVG_W - PAD_LEFT - PAD_RIGHT)
                  const y = PAD_TOP + (1 - trend.counts[i] / maxCount) * (SVG_H - PAD_TOP - PAD_BOT)
                  return (
                    <g key={d}>
                      <circle cx={x} cy={y} r={3} fill="var(--catalan-primary, #0ea5e9)" />
                      <text x={x} y={SVG_H - 4} fontSize={8} textAnchor="middle" fill="currentColor" opacity={0.5}>
                        {d.slice(5)}
                      </text>
                    </g>
                  )
                })}
              </svg>
            </div>
          ) : (
            <p className="text-sm text-catalan-textMuted text-center py-8">No submissions in the last 7 days</p>
          )}
        </Card>
      )}
    </div>
  )
}
