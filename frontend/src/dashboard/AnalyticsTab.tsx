// Analytics overview for supervisors — charts powered by Recharts
// No need to open external tabulation tool for quick insights

import { useState, useEffect, useCallback } from 'react'
import {
  PieChart, Pie, Cell,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import api from '@/lib/api'
import EmojiIcon from '@/components/EmojiIcon'

const COLORS = {
  primary: '#0ea5e9',
  green: '#10b981',
  orange: '#f59e0b',
  red: '#ef4444',
  purple: '#8b5cf6',
}

interface Form {
  id: string
  title: string
}

interface StatusCount {
  name: string
  value: number
  color: string
}

interface HeatmapDay {
  date: string
  count: number
  week: number
  dow: number
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="bg-catalan-surface border border-catalan-border rounded-xl p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-catalan-text">{title}</h3>
        {subtitle && <p className="text-xs text-catalan-textMuted mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  )
}

function buildHeatmapDays(): HeatmapDay[] {
  const days: HeatmapDay[] = []
  const today = new Date()
  for (let i = 83; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    const dateStr = d.toISOString().slice(0, 10)
    const week = Math.floor((83 - i) / 7)
    const dow = d.getDay()
    days.push({ date: dateStr, count: 0, week, dow })
  }
  return days
}

function heatColor(count: number, max: number): string {
  if (count === 0) return '#1e1e2e'
  const intensity = Math.min(count / Math.max(max, 1), 1)
  if (intensity < 0.25) return '#0c4a6e'
  if (intensity < 0.5) return '#0369a1'
  if (intensity < 0.75) return '#0284c7'
  return '#0ea5e9'
}

export default function AnalyticsTab({ forms }: { forms: Form[] }) {
  const [selectedForm, setSelectedForm] = useState('')
  const [statusCounts, setStatusCounts] = useState<StatusCount[]>([])
  const [heatmapDays, setHeatmapDays] = useState<HeatmapDay[]>(buildHeatmapDays)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async (formId: string) => {
    if (!formId) return
    setLoading(true)
    try {
      const [subsRes] = await Promise.allSettled([
        api.get(`/submissions/?form_id=${formId}&page_size=500`),
      ])

      if (subsRes.status === 'fulfilled') {
        const subs: Array<{ status: string; server_received_at?: string }> = subsRes.value.data?.items ?? subsRes.value.data ?? []
        const counts: Record<string, number> = {}
        subs.forEach(s => { counts[s.status] = (counts[s.status] ?? 0) + 1 })
        setStatusCounts([
          { name: 'Submitted', value: counts['synced'] ?? 0, color: COLORS.primary },
          { name: 'Flagged', value: counts['flagged'] ?? 0, color: COLORS.orange },
          { name: 'Approved', value: counts['approved'] ?? 0, color: COLORS.green },
          { name: 'Rejected', value: counts['rejected'] ?? 0, color: COLORS.red },
        ])

        const dayMap: Record<string, number> = {}
        subs.forEach(s => {
          if (s.server_received_at) {
            const d = s.server_received_at.slice(0, 10)
            dayMap[d] = (dayMap[d] ?? 0) + 1
          }
        })
        setHeatmapDays(prev => prev.map(d => ({ ...d, count: dayMap[d.date] ?? 0 })))
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (selectedForm) load(selectedForm)
  }, [selectedForm, load])

  useEffect(() => {
    if (!selectedForm && forms.length > 0) setSelectedForm(forms[0].id)
  }, [forms, selectedForm])

  const heatmapMax = Math.max(...heatmapDays.map(d => d.count), 1)
  const weeks: HeatmapDay[][] = []
  for (let w = 0; w < 12; w++) {
    weeks.push(heatmapDays.filter(d => d.week === w))
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <select
          value={selectedForm}
          onChange={e => setSelectedForm(e.target.value)}
          className="bg-catalan-hover border border-catalan-border rounded-lg px-3 py-2 text-sm text-catalan-text focus:outline-none focus:border-catalan-primary"
        >
          <option value="">Select a form…</option>
          {forms.map(f => <option key={f.id} value={f.id}>{f.title}</option>)}
        </select>
        {loading && <span className="text-xs text-catalan-textMuted animate-pulse">Loading…</span>}
      </div>

      {!selectedForm ? (
        <div className="text-center py-16 text-catalan-textMuted">
          <div className="text-4xl mb-2"><EmojiIcon e="📊" /></div>
          <p className="text-sm">Select a form to view analytics</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Status Breakdown */}
          <ChartCard title="Submission Status" subtitle="Breakdown by status">
            {statusCounts.every(s => s.value === 0) ? (
              <p className="text-sm text-catalan-textMuted text-center py-8">No submissions yet</p>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={statusCounts.filter(s => s.value > 0)}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {statusCounts.filter(s => s.value > 0).map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: '#1e1e2e', border: '1px solid #313244', borderRadius: 8 }}
                    labelStyle={{ color: '#cdd6f4', fontSize: 12 }}
                    itemStyle={{ fontSize: 12 }}
                  />
                  <Legend
                    iconType="circle"
                    iconSize={8}
                    formatter={v => <span style={{ color: '#6c7086', fontSize: 11 }}>{v}</span>}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          {/* 4. Daily Heatmap */}
          <ChartCard title="Daily Activity" subtitle="Last 12 weeks — darker = more submissions">
            <div className="overflow-x-auto">
              <div className="flex gap-1 pt-1">
                {weeks.map((week, wi) => (
                  <div key={wi} className="flex flex-col gap-1">
                    {Array.from({ length: 7 }).map((_, dow) => {
                      const day = week.find(d => d.dow === dow)
                      return (
                        <div
                          key={dow}
                          title={day ? `${day.date}: ${day.count} submissions` : ''}
                          style={{
                            width: 12,
                            height: 12,
                            borderRadius: 2,
                            backgroundColor: day ? heatColor(day.count, heatmapMax) : '#1e1e2e',
                          }}
                        />
                      )
                    })}
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-1 mt-3">
                <span className="text-xs text-catalan-textMuted">Less</span>
                {[0, 0.25, 0.5, 0.75, 1].map((v, i) => (
                  <div
                    key={i}
                    style={{ width: 12, height: 12, borderRadius: 2, backgroundColor: heatColor(v * heatmapMax, heatmapMax) }}
                  />
                ))}
                <span className="text-xs text-catalan-textMuted">More</span>
              </div>
            </div>
          </ChartCard>

        </div>
      )}
    </div>
  )
}
