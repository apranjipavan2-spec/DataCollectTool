import { useState } from 'react'
import api from '@/lib/api'

const STYLES = [
  { key: 'progress', label: 'Progress', desc: 'Field program progress report for NGO/government' },
  { key: 'field_survey', label: 'Field Survey', desc: 'Research team survey report' },
  { key: 'medical', label: 'Medical', desc: 'Clinical/health data report (CONSORT/STROBE)' },
  { key: 'research', label: 'Research', desc: 'Academic research paper format' },
  { key: 'government', label: 'Government', desc: 'Official administrative report' },
  { key: 'ngo', label: 'NGO/Donor', desc: 'Impact report for donors' },
]

export default function FgWriter() {
  const [style, setStyle] = useState('field_survey')
  const [formTitle, setFormTitle] = useState('')
  const [dateRange, setDateRange] = useState('')
  const [sampleSize, setSampleSize] = useState('')
  const [tableData, setTableData] = useState('')
  const [chartDescriptions, setChartDescriptions] = useState('')
  const [customContext, setCustomContext] = useState('')
  const [reportMd, setReportMd] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  const generate = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.post('/ai/writer', {
        style,
        form_title: formTitle || 'Survey',
        date_range: dateRange,
        sample_size: parseInt(sampleSize) || 0,
        table_data: tableData,
        chart_descriptions: chartDescriptions,
        custom_context: customContext,
      })
      setReportMd(res.data.report_md || '')
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } }; message?: string }
      setError(err.response?.data?.detail || err.message || 'Generation failed')
    } finally {
      setLoading(false)
    }
  }

  const downloadDocx = async () => {
    try {
      const res = await api.post('/ai/writer/export-docx', {
        report_md: reportMd,
        title: formTitle || 'Report',
      }, { responseType: 'blob' })
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a')
      a.href = url
      a.download = `${formTitle || 'report'}.docx`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      setError('Word export failed')
    }
  }

  const copyMarkdown = async () => {
    await navigator.clipboard.writeText(reportMd)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="min-h-screen bg-catalan-bg p-6">
      <div className="max-w-4xl mx-auto space-y-6">

        <div>
          <h1 className="text-xl font-bold text-catalan-text">FG Writer — AI Report Generator</h1>
          <p className="text-sm text-catalan-textMuted mt-1">
            Paste your data, pick a style, and generate a professional report instantly.
          </p>
        </div>

        {/* Step 1: Setup */}
        <div className="bg-catalan-surface border border-catalan-border rounded-xl p-5 space-y-4">
          <h2 className="text-sm font-semibold text-catalan-text uppercase tracking-wider">Step 1 — Report Setup</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-catalan-textMuted block mb-1">Form / Study title</label>
              <input
                value={formTitle}
                onChange={e => setFormTitle(e.target.value)}
                placeholder="e.g. Maternal Health Survey 2025"
                className="w-full bg-catalan-hover border border-catalan-border rounded-lg px-3 py-2 text-sm text-catalan-text placeholder-catalan-textMuted focus:outline-none focus:border-catalan-primary"
              />
            </div>
            <div>
              <label className="text-xs text-catalan-textMuted block mb-1">Date range</label>
              <input
                value={dateRange}
                onChange={e => setDateRange(e.target.value)}
                placeholder="e.g. Jan 2025 – Mar 2025"
                className="w-full bg-catalan-hover border border-catalan-border rounded-lg px-3 py-2 text-sm text-catalan-text placeholder-catalan-textMuted focus:outline-none focus:border-catalan-primary"
              />
            </div>
            <div>
              <label className="text-xs text-catalan-textMuted block mb-1">Sample size</label>
              <input
                type="number"
                value={sampleSize}
                onChange={e => setSampleSize(e.target.value)}
                placeholder="e.g. 450"
                className="w-full bg-catalan-hover border border-catalan-border rounded-lg px-3 py-2 text-sm text-catalan-text placeholder-catalan-textMuted focus:outline-none focus:border-catalan-primary"
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-catalan-textMuted block mb-2">Report Style</label>
            <div className="flex flex-wrap gap-2">
              {STYLES.map(s => (
                <button
                  key={s.key}
                  onClick={() => setStyle(s.key)}
                  title={s.desc}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${
                    style === s.key
                      ? 'bg-catalan-primary text-catalan-bg border-catalan-primary'
                      : 'bg-catalan-hover text-catalan-text border-catalan-border hover:border-catalan-primary/50'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Step 2: Data */}
        <div className="bg-catalan-surface border border-catalan-border rounded-xl p-5 space-y-4">
          <h2 className="text-sm font-semibold text-catalan-text uppercase tracking-wider">Step 2 — Paste your data</h2>
          <div>
            <label className="text-xs text-catalan-textMuted block mb-1">
              CSV table or JSON data (from FG Analyzer or any tabulation tool)
            </label>
            <textarea
              value={tableData}
              onChange={e => setTableData(e.target.value)}
              rows={8}
              placeholder={"Paste CSV or JSON here…\n\nExample:\nDistrict,Surveyed,Complete,Incomplete\nNorth,120,98,22\nSouth,80,72,8"}
              className="w-full bg-catalan-hover border border-catalan-border rounded-lg px-3 py-2 text-sm text-catalan-text placeholder-catalan-textMuted focus:outline-none focus:border-catalan-primary font-mono resize-y"
            />
          </div>
        </div>

        {/* Step 3: Charts */}
        <div className="bg-catalan-surface border border-catalan-border rounded-xl p-5 space-y-4">
          <h2 className="text-sm font-semibold text-catalan-text uppercase tracking-wider">Step 3 — Describe your charts (optional)</h2>
          <textarea
            value={chartDescriptions}
            onChange={e => setChartDescriptions(e.target.value)}
            rows={3}
            placeholder="e.g. Bar chart: Enumerator A had 45 submissions, B had 32, C had 28. Line chart shows steady increase from Jan to Mar."
            className="w-full bg-catalan-hover border border-catalan-border rounded-lg px-3 py-2 text-sm text-catalan-text placeholder-catalan-textMuted focus:outline-none focus:border-catalan-primary resize-y"
          />
          <div>
            <label className="text-xs text-catalan-textMuted block mb-1">Additional context (optional)</label>
            <textarea
              value={customContext}
              onChange={e => setCustomContext(e.target.value)}
              rows={2}
              placeholder="Study background, special notes, target population, geography…"
              className="w-full bg-catalan-hover border border-catalan-border rounded-lg px-3 py-2 text-sm text-catalan-text placeholder-catalan-textMuted focus:outline-none focus:border-catalan-primary resize-y"
            />
          </div>
        </div>

        <button
          onClick={generate}
          disabled={loading}
          className="w-full py-3 rounded-xl bg-catalan-primary text-catalan-bg font-semibold text-sm hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {loading ? 'Generating report…' : '✨ Generate Report'}
        </button>

        {error && (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400">
            {error}
          </div>
        )}

        {reportMd && (
          <div className="bg-catalan-surface border border-catalan-border rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-catalan-text">Generated Report</h2>
              <div className="flex gap-2">
                <button
                  onClick={downloadDocx}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium border border-catalan-border text-catalan-text hover:border-catalan-primary/50 hover:text-catalan-primary transition-colors"
                >
                  Download Word
                </button>
                <button
                  onClick={copyMarkdown}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium border border-catalan-border text-catalan-text hover:border-catalan-primary/50 hover:text-catalan-primary transition-colors"
                >
                  {copied ? 'Copied!' : 'Copy Markdown'}
                </button>
              </div>
            </div>
            <textarea
              value={reportMd}
              onChange={e => setReportMd(e.target.value)}
              style={{ fontFamily: 'Georgia, serif', whiteSpace: 'pre-wrap' }}
              className="w-full min-h-[600px] bg-catalan-hover border border-catalan-border rounded-lg px-4 py-3 text-sm text-catalan-text focus:outline-none focus:border-catalan-primary resize-y leading-relaxed"
            />
          </div>
        )}

      </div>
    </div>
  )
}
