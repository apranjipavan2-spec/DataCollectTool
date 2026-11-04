/**
 * Public, read-only results page for a results share link (/results/:token).
 * Shows only server-computed totals — see backend services/results_aggregate.py.
 */
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import axios from 'axios'

interface Cell { label: string; count: number | null; pct: number | null; suppressed: boolean }
interface Question { label: string; type: string; answered: number | null; suppressed: boolean; options: Cell[] }
interface Results {
  form_title: string
  label: string | null
  generated_at: string
  expires_at: string | null
  min_cell: number
  total: number | null
  total_suppressed: boolean
  by_day: (Cell & { date: string })[]
  by_enumerator: Cell[]
  questions: Question[]
}

function Bars({ cells }: { cells: Cell[] }) {
  return (
    <ul className="space-y-1.5">
      {cells.map(c => (
        <li key={c.label} className="grid grid-cols-[minmax(0,10rem)_1fr_4.5rem] items-center gap-2 text-sm">
          <span className="truncate text-gray-700" title={c.label}>{c.label}</span>
          <span className="h-3 rounded bg-gray-100 overflow-hidden" aria-hidden="true">
            {!c.suppressed && <span className="block h-full bg-indigo-500" style={{ width: `${c.pct ?? 0}%` }} />}
          </span>
          <span className="text-right tabular-nums text-gray-900">
            {c.suppressed ? '<5' : `${c.count} · ${c.pct}%`}
          </span>
        </li>
      ))}
    </ul>
  )
}

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-gray-200 rounded-xl p-4 sm:p-5">
      <h2 className="text-base font-semibold text-gray-900">{title}</h2>
      {sub && <p className="text-xs text-gray-500 mt-0.5 mb-3">{sub}</p>}
      {!sub && <div className="mb-3" />}
      {children}
    </section>
  )
}

export default function PublicResultsPage() {
  const { token } = useParams<{ token: string }>()
  const [data, setData] = useState<Results | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    axios.get(`/api/v1/public/results/${token}`)
      .then(r => setData(r.data))
      .catch(err => setError(err?.response?.status === 404
        ? 'This results link has expired or been turned off.'
        : 'Could not load results. Please try again later.'))
  }, [token])

  if (error) return <main className="min-h-screen grid place-items-center p-4 text-gray-700">{error}</main>
  if (!data) return <main className="min-h-screen grid place-items-center p-4 text-gray-500">Loading results…</main>

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-6 sm:py-10">
      <div className="max-w-3xl mx-auto space-y-4">
        <header>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">{data.form_title}</h1>
          <p className="text-sm text-gray-500 mt-1">
            {data.label ? `${data.label} · ` : ''}
            Updated {new Date(data.generated_at).toLocaleString('en-IN')}
            {data.expires_at ? ` · link valid until ${new Date(data.expires_at).toLocaleDateString('en-IN')}` : ''}
          </p>
          <p className="text-xs text-gray-500 mt-2">
            Totals only. No individual responses or personal details are shown; any number below {data.min_cell} appears as &quot;&lt;{data.min_cell}&quot;.
          </p>
        </header>

        <Section title="Responses">
          <p className="text-3xl font-bold tabular-nums text-gray-900">{data.total_suppressed ? `<${data.min_cell}` : data.total}</p>
        </Section>

        {data.by_day.length > 0 && (
          <Section title="Responses by day">
            <Bars cells={data.by_day.map(d => ({ ...d, label: new Date(d.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) }))} />
          </Section>
        )}

        {data.by_enumerator.length > 0 && (
          <Section title="Responses by field team member" sub="Team members are numbered, not named.">
            <Bars cells={data.by_enumerator} />
          </Section>
        )}

        {data.questions.map(q => (
          <Section key={q.label} title={q.label}
                   sub={q.suppressed ? `Fewer than ${data.min_cell} answers — hidden.` : `${q.answered} answered${q.type === 'multiple_choice' ? ' · more than one choice allowed' : ''}`}>
            {!q.suppressed && <Bars cells={q.options} />}
          </Section>
        ))}

        <footer className="text-center text-xs text-gray-400 pt-4">Powered by FieldGovern</footer>
      </div>
    </main>
  )
}
