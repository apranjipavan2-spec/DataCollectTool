import { useState, useEffect } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import Sidebar from '@/components/Sidebar'
import TopNav from '@/components/TopNav'
import api from '@/lib/api'
import { getNavItems } from '@/lib/navigation'

interface Point { ts: string; cpu_pct: number; mem_pct: number; mem_used_mb: number; mem_total_mb: number }
interface Stat { avg: number; peak: number }
interface Summary { cpu: Stat; mem: Stat; mem_total_mb: number; sample_count: number; window_start: string; window_end: string }
interface DayRow { date: string; cpu_avg: number; cpu_peak: number; mem_avg: number; mem_peak: number; samples: number }

const fmtTime = (d: string) => new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
const fmtDay = (d: string) => new Date(d).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' })

const sel = 'bg-catalan-surface border border-catalan-border rounded-lg px-3 py-2 text-sm text-catalan-text'

export default function SystemMetrics() {
  const [series, setSeries] = useState<Point[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [byDay, setByDay] = useState<DayRow[]>([])
  const [days, setDays] = useState(7)
  const [daySort, setDaySort] = useState<'date' | 'cpu_peak' | 'mem_peak'>('date')
  const [order, setOrder] = useState<'asc' | 'desc'>('desc')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    setLoading(true); setError('')
    api.get('/admin/monitor/system-metrics', { params: { days } })
      .then(r => { setSeries(r.data.series); setSummary(r.data.summary); setByDay(r.data.by_day) })
      .catch(() => setError('Failed to load system metrics. Try refreshing.'))
      .finally(() => setLoading(false))
  }, [days])

  const sortedDays = [...byDay].sort((a, b) => {
    const v = a[daySort] < b[daySort] ? -1 : a[daySort] > b[daySort] ? 1 : 0
    return order === 'asc' ? v : -v
  })

  // Thin the chart series client-side so very wide windows (7d = ~10k points) still render smoothly
  const chartData = series.length > 2000
    ? series.filter((_, i) => i % Math.ceil(series.length / 2000) === 0)
    : series

  return (
    <div className="flex h-screen bg-catalan-bg overflow-hidden">
      <Sidebar items={getNavItems('master_admin')} role="master_admin" />
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopNav title="System Resources" breadcrumbs={[{ label: 'System' }]} />
        <main className="flex-1 overflow-auto px-6 py-6 space-y-5">
          {error && (
            <div className="bg-catalan-error/10 border border-catalan-error/30 text-catalan-error text-sm rounded-xl px-4 py-3">{error}</div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <select value={days} onChange={e => setDays(Number(e.target.value))} className={sel}>
              {[[1, 'Last 24 hours'], [3, 'Last 3 days'], [7, 'Last 7 days']].map(([d, l]) =>
                <option key={d} value={d}>{l}</option>)}
            </select>
            {summary && (
              <span className="text-xs text-catalan-textMuted">
                {summary.sample_count.toLocaleString()} samples · 1/min · {fmtTime(summary.window_start)} → {fmtTime(summary.window_end)}
              </span>
            )}
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-24 text-catalan-textMuted text-sm">Loading…</div>
          ) : !summary ? (
            <div className="flex items-center justify-center py-24 text-catalan-textMuted text-sm">
              No samples yet — the collector takes a reading every minute, check back shortly.
            </div>
          ) : (
            <>
              {/* Summary cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="bg-catalan-surface border border-catalan-border rounded-xl px-4 py-3">
                  <p className="text-[11px] text-catalan-textMuted uppercase tracking-wide font-semibold">CPU · Average</p>
                  <p className="text-xl font-bold text-catalan-text mt-1">{summary.cpu.avg}%</p>
                </div>
                <div className="bg-catalan-surface border border-catalan-border rounded-xl px-4 py-3">
                  <p className="text-[11px] text-catalan-textMuted uppercase tracking-wide font-semibold">CPU · Peak</p>
                  <p className={`text-xl font-bold mt-1 ${summary.cpu.peak >= 90 ? 'text-catalan-error' : 'text-catalan-text'}`}>{summary.cpu.peak}%</p>
                </div>
                <div className="bg-catalan-surface border border-catalan-border rounded-xl px-4 py-3">
                  <p className="text-[11px] text-catalan-textMuted uppercase tracking-wide font-semibold">RAM · Average</p>
                  <p className="text-xl font-bold text-catalan-text mt-1">{summary.mem.avg}%</p>
                </div>
                <div className="bg-catalan-surface border border-catalan-border rounded-xl px-4 py-3">
                  <p className="text-[11px] text-catalan-textMuted uppercase tracking-wide font-semibold">RAM · Peak</p>
                  <p className={`text-xl font-bold mt-1 ${summary.mem.peak >= 90 ? 'text-catalan-error' : 'text-catalan-text'}`}>{summary.mem.peak}%</p>
                  <p className="text-[10px] text-catalan-textMuted mt-0.5">of {(summary.mem_total_mb / 1024).toFixed(1)} GB total</p>
                </div>
              </div>

              {/* Charts */}
              <div className="bg-catalan-surface border border-catalan-border rounded-xl p-5">
                <p className="text-sm font-semibold text-catalan-text mb-3">CPU %</p>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--tw-color-catalan-border, #e2e8f0)" />
                    <XAxis dataKey="ts" tickFormatter={fmtTime} minTickGap={60} tick={{ fontSize: 11 }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
                    <Tooltip labelFormatter={fmtTime} formatter={(v: number) => [`${v}%`, 'CPU']} />
                    <Line type="monotone" dataKey="cpu_pct" stroke="#0ea5e9" dot={false} strokeWidth={1.5} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div className="bg-catalan-surface border border-catalan-border rounded-xl p-5">
                <p className="text-sm font-semibold text-catalan-text mb-3">RAM %</p>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--tw-color-catalan-border, #e2e8f0)" />
                    <XAxis dataKey="ts" tickFormatter={fmtTime} minTickGap={60} tick={{ fontSize: 11 }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
                    <Tooltip labelFormatter={fmtTime} formatter={(v: number, n: string, p) => n === 'mem_pct' ? [`${v}% (${(p.payload.mem_used_mb / 1024).toFixed(1)} GB)`, 'RAM'] : [v, n]} />
                    <Legend />
                    <Line type="monotone" dataKey="mem_pct" name="RAM" stroke="#7c3aed" dot={false} strokeWidth={1.5} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Per-day breakdown: sort/filter */}
              <div className="bg-catalan-surface border border-catalan-border rounded-xl overflow-x-auto">
                <div className="flex items-center justify-between px-5 py-3 border-b border-catalan-border">
                  <p className="text-sm font-semibold text-catalan-text">Daily breakdown</p>
                  <div className="flex gap-2">
                    <select value={daySort} onChange={e => setDaySort(e.target.value as typeof daySort)} className={sel}>
                      <option value="date">Sort: Date</option>
                      <option value="cpu_peak">Sort: CPU peak</option>
                      <option value="mem_peak">Sort: RAM peak</option>
                    </select>
                    <button onClick={() => setOrder(o => (o === 'desc' ? 'asc' : 'desc'))} className={sel}>
                      {order === 'desc' ? '↓ Desc' : '↑ Asc'}
                    </button>
                  </div>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-catalan-textMuted border-b border-catalan-border">
                      {['Date', 'CPU Avg', 'CPU Peak', 'RAM Avg', 'RAM Peak', 'Samples'].map(h => (
                        <th key={h} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedDays.map(d => (
                      <tr key={d.date} className="border-b border-catalan-border last:border-0">
                        <td className="px-4 py-3 font-medium text-catalan-text whitespace-nowrap">{fmtDay(d.date)}</td>
                        <td className="px-4 py-3 text-catalan-textMuted">{d.cpu_avg}%</td>
                        <td className={`px-4 py-3 font-medium ${d.cpu_peak >= 90 ? 'text-catalan-error' : 'text-catalan-text'}`}>{d.cpu_peak}%</td>
                        <td className="px-4 py-3 text-catalan-textMuted">{d.mem_avg}%</td>
                        <td className={`px-4 py-3 font-medium ${d.mem_peak >= 90 ? 'text-catalan-error' : 'text-catalan-text'}`}>{d.mem_peak}%</td>
                        <td className="px-4 py-3 text-catalan-textMuted">{d.samples.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  )
}
